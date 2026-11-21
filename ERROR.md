# frc-train-review - 錯誤記錄

此檔案記錄本專案特有的錯誤（通用錯誤請記錄到 `~/.claude/ERROR_LOG.md`）

---

## 2026-04-22（第 16 次 session）RKNN (RK3588 INT8) 轉換踩坑紀錄

### E34：Windows git-bash 路徑轉譯吃掉 `/mnt/d/` prefix

**情境**：在 Windows 端想從 git-bash 呼叫 WSL 腳本：
```bash
wsl bash /mnt/d/FRC/frc-train-review/_export_rknn_onnx.sh
# → 實際 WSL 收到的路徑是 C:/Program Files/Git/mnt/d/FRC/frc-train-review/_export_rknn_onnx.sh
# → bash: ... No such file or directory
```

**原因**：git-bash（MSYS2 / MinGW）有路徑自動轉譯機制（MSYS_ARG_CONV_EXCL）：看到 `/` 開頭的 argument 會當作 POSIX 路徑、嘗試轉成 Windows 路徑。`/mnt/d/...` 在 git-bash 眼中是「要從 git-bash 根目錄（`C:/Program Files/Git`）找 `mnt/d/...`」，於是 prepend 了 git-bash 安裝路徑。WSL 本身認得 `/mnt/d/`、但 argument 已經被 git-bash 污染掉才進到 wsl。

**解決**：把整個命令包進 bash string，避免 git-bash 看到頂層 `/mnt/d/` argument：
```bash
wsl bash -c "bash /mnt/d/FRC/frc-train-review/_export_rknn_onnx.sh"
```

bash string 內部的 path 是 bash 自己 parse，git-bash 只看到 `-c` 後面是 string、不做 path 轉譯。

**預防**：
1. 用 `wsl bash -c "..."` 而非 `wsl bash ...`，所有 WSL 操作走 string mode
2. 或改從 PowerShell 呼叫 wsl（PowerShell 不做 path 轉譯）
3. 確認 argument 有沒有被污染的快速測試：`wsl bash -c 'echo "$1"' -- /mnt/d/test`，若印出 `C:/Program Files/Git/mnt/d/test` 就是踩到

**備註**：git-bash 通用行為、非本專案特有；但轉 RKNN 這條 pipeline 來回 Windows↔WSL 頻繁切換，踩這個坑機率高。未來別的專案若也從 git-bash 呼叫 WSL 會撞同樣問題。

---

### E35：WSL2 Ubuntu 24.04 bare install 缺 pip / venv / unzip

**情境**：WSL 裝完 Ubuntu 24.04、`wsl bash -c "pip --version"` → `pip: command not found`。改 `python3 -m venv rknn` → `The virtual environment was not created successfully because ensurepip is not available`。想解 zip 檔 → `unzip: command not found`。

**原因**：Ubuntu 24.04 minimal image（WSL default）預設沒裝 pip / venv ensurepip / unzip，只有 `python3` 本身。`apt install python3-pip` / `python3-venv` 可解、但使用者 WSL sudo 有密碼（非 passwordless sudo）、互動式輸入密碼在這種自動化 script 場景下很卡。

**解決**：裝 miniconda（不需 sudo、不需 apt）：
```bash
wsl bash -c "curl -o /tmp/miniconda.sh https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh && bash /tmp/miniconda.sh -b -p \$HOME/miniconda3"
```

miniconda 自帶 python + pip + conda 可開 env，繞過 apt 層。zip 解壓用 Python zipfile：
```python
import zipfile
with zipfile.ZipFile('file.zip') as z: z.extractall('./dest')
```

**預防**：
1. WSL bare install 後第一件事 check `which pip python3 unzip git`，不在就決定走 conda 還是要求使用者手動 `apt install` 加 sudo
2. 把「WSL 環境準備」列成 CLAUDE.md 或某個 onboarding 文件的 checklist（本 repo 考慮放在 `docs/rknn-deploy.md`，若後續系統化）
3. 未來 session 開始要 install WSL deps 前先 `wsl bash -c "sudo -n true 2>/dev/null && echo passwordless || echo needs-password"` 判斷 sudo 模式

**備註**：WSL Ubuntu 官方 image 版本選擇問題，非本專案特有；但 RKNN 轉換場景特別依賴 pip + Python 生態，這個坑在本專案會被放大。

---

### E36：WSL I/O error / `Wsl/Service/CreateInstance/E_FAIL` 連 python binary 本身都壞

**情境**：並行跑大型 pip install + git clone 時 WSL 突然大量錯誤：
```
OSError: [Errno 5] Input/output error: '/home/user/miniconda3/envs/rknn/bin/python'
wsl: Wsl/Service/CreateInstance/E_FAIL
```

python binary 本身都讀不到、conda env 損毀、甚至 `wsl` 指令本身也回錯。

**原因**：WSL2 的 VHDX 虛擬硬碟在高 I/O 並行負載下會卡（Windows 層的 Hyper-V 轉譯限制）、有時 `wslservice.exe` crash 需要重啟。症狀通常：
- 同時跑 2+ 條重 I/O（pip install / git clone / build）
- `/tmp` 或 conda env 在 WSL 虛擬硬碟上、不是 `/mnt/` 掛載的 Windows 分區
- 長時間跑（30+ 分鐘）VM 記憶體累積

**解決**：
```bash
# 1. Windows 端重啟 WSL
wsl --shutdown
# 2. 過 10 秒重新啟動（conda env 通常還在、VHDX 沒破壞）
wsl bash -c "conda activate rknn && python -c 'import torch; print(torch.__version__)'"
# 3. 之後並行改 sequential、大 install 一次一條
# 4. 設 TMPDIR 到 $HOME 而非 /tmp
export TMPDIR=$HOME/tmp
mkdir -p $TMPDIR
```

**預防**：
1. 大 pip install（特別是 `rknn-toolkit2`、`torch`、`ultralytics` 這種動輒 GB 級）一次跑一條、別並行
2. 大 git clone（`ultralytics_yolo11` + `rknn_model_zoo` 加起來數百 MB）分開跑
3. 定期 `wsl --shutdown` 釋放 VM 記憶體（每個大 phase 結束）
4. 若看到 `Input/output error` on file that should exist、先試 `wsl --shutdown` 再判斷是不是真壞（多半不是）

**備註**：Windows 11 + WSL2 的 VHDX + 高 I/O 並行通用限制，非本專案特有；但 RKNN 環境建置需要大量 install，這個坑被放大。未來別的專案做大 install 也可能撞到。

---

### E37：`setuptools 81+` 把 `pkg_resources` 拆成獨立 package，rknn-toolkit2 仍依賴

**情境**：建好 conda env 後 import rknn：
```python
from rknn.api import RKNN
# → ModuleNotFoundError: No module named 'pkg_resources'
```

conda 明明裝了 setuptools、卻找不到 `pkg_resources`。

**原因**：setuptools 從 81.0.0 開始把 `pkg_resources` 從內建 module 拆成獨立 `setuptools-pkg-resources` package（見 [setuptools changelog](https://setuptools.pypa.io/en/latest/history.html#v81-0-0)）。升版 rationale 是「`pkg_resources` 本來就是 deprecated、該改用 `importlib.resources`」，但很多舊 package 還沒遷移、rknn-toolkit2 2.3.2 就是其中之一、仍 `import pkg_resources`。新版 setuptools（81+）裝起來後 `pkg_resources` 不存在、rknn import 就炸。

**解決**：降版：
```bash
pip install 'setuptools<80'
# 實測 79.0.1 OK
```

或補裝 pkg_resources（但更麻煩、且不保證 API 相容）。

**預防**：
1. 裝任何 legacy Python package 時（開發時間 < 2024-Q3）要檢查是否用 `pkg_resources`，可 `grep -rn "import pkg_resources"` 於 site-packages
2. 本 repo `_export_rknn_onnx.sh` 的 env setup 段已 hardcoded `setuptools<80`、未來升 rknn-toolkit2 時先試新 setuptools 能不能 work、不能再降回
3. PyPI 上任何「2024 年前的 package」都值得這樣防禦

**備註**：setuptools 81 的移除決定是 Python 生態事件、非本專案特有，但 rknn-toolkit2 正好踩到。未來 `~/.claude/ERROR_LOG.md` 可考慮補「舊 package import pkg_resources 報錯」的通用條目。

---

### E38：`onnx 1.18+` 移除 `onnx.mapping` module，rknn.load_onnx 仍依賴

**情境**：env 修好 pkg_resources 後、load ONNX：
```python
rknn.load_onnx('./best.onnx')
# → AttributeError: module 'onnx' has no attribute 'mapping'
```

**原因**：onnx 1.18.0 release note 明確寫「Removed `onnx.mapping` module; use `onnx.helper` instead」。但 rknn-toolkit2 2.3.2 內部 `import onnx; onnx.mapping.TENSOR_TYPE_TO_NP_TYPE` 這類用法沒遷移。新版 onnx（1.18+）裝上去就炸。

**解決**：
```bash
pip install 'onnx<1.18'
# 實測 onnx==1.17.0 OK
```

**預防**：
1. 凡是 2024 Q3 之前開發的 onnx-related package 都要降 onnx 版本、pin 到 1.17.x
2. 升 rknn-toolkit2 時同步檢查 onnx 版本相容性、看新版 release note 有無提到支援 onnx 1.18+
3. 可在 `_export_rknn_onnx.sh` 的 env setup 段加 `onnx==1.17.0` hardcoded 版本

**備註**：ONNX 生態升版事件、非本專案特有；但對做模型轉換的工作流影響大。未來別的專案用 rknn / openvino / tensorrt 轉 ONNX 可能撞到、可考慮升級到 `~/.claude/ERROR_LOG.md`。

---

### E39：`torchvision>=0.9.0` 自動把 torch 升到 2.11，跟 rknn-toolkit2 要求的 `torch<=2.4.0` 衝突

**情境**：env 手動裝完 torch 2.4.0、跑 `pip install torchvision` 後：
```
Successfully installed torch-2.11.0 torchvision-0.20.0
```

torch 從 2.4.0 變 2.11.0、rknn-toolkit2 直接炸：
```
ImportError: rknn-toolkit2 requires torch<=2.4.0, got 2.11.0
```

**原因**：torchvision 0.20.0 的 `install_requires` 寫 `torch>=2.11.0`、pip 沒辦法同時滿足「rknn 要 <=2.4.0」與「torchvision 要 >=2.11.0」、預設優先滿足後裝的 torchvision 把 torch 升上去。

**解決**：force-reinstall 一次性 pin：
```bash
pip install --force-reinstall torch==2.4.0 torchvision==0.19.0 \
  --extra-index-url https://download.pytorch.org/whl/cpu
```

關鍵：torchvision 0.19.0 的 install_requires 是 `torch==2.4.x`、兩版綁一起。裝 torchvision 0.19.0 會自動鎖 torch 2.4.x、不再升版。

**預防**：
1. 裝 torch 生態的 package 時、**永遠連 torchvision / torchaudio 版本一起 pin**（三個版本號綁定關係、PyTorch 官方有表）
2. 不要先 `pip install torch`、再 `pip install torchvision` 分兩步、會踩升版
3. 用 `--extra-index-url https://download.pytorch.org/whl/cpu` 明確指定 cpu wheel，避免 CUDA 版 wheel（WSL 沒 CUDA runtime）誤裝

**備註**：PyTorch 生態版本綁定通用規則、非本專案特有；但對做轉換的工作流（特別是 CPU-only 轉換環境）影響大。

---

### E40：`numpy 2.x` 被 force-reinstall torch 時順帶裝上、rknn-toolkit2 要求 `<=1.26.4`

**情境**：E39 解掉後、跑：
```python
rknn.build(...)
# → TypeError: Cannot interpret '0.0' as a data type (numpy 2.x ABI)
# 或
# → RuntimeError: module compiled against API version 0x10 but this version of numpy is 0x11
```

numpy 又升了。

**原因**：pip force-reinstall torch 時會根據 torch 2.4.0 的 `install_requires: numpy` 裝最新 numpy（目前 2.2.6）、但 rknn-toolkit2 的 compiled C extension 是用 numpy 1.x ABI 編譯、跟 numpy 2.x ABI 不相容。這是 numpy 2.0 的 breaking change（ABI 變更）、任何 numpy 1.x 編譯的 C extension 遇到 numpy 2.x 都炸。

**解決**：裝完 torch 後立即壓回 numpy：
```bash
pip install numpy==1.26.4
```

或在 force-reinstall 時同步帶 numpy：
```bash
pip install --force-reinstall torch==2.4.0 torchvision==0.19.0 numpy==1.26.4 \
  --extra-index-url https://download.pytorch.org/whl/cpu
```

**預防**：
1. 任何 C extension heavy 的 package（rknn-toolkit2 / opencv / scipy / cython-based）要確認 numpy ABI 相容、通常 numpy 2.x 發表後一年內都要 pin 1.26.x
2. env setup 末段跑一次 `python -c "import numpy; print(numpy.__version__)"` 確認沒被升
3. 凡是 `pip install --force-reinstall` 某個 torch 相關 package、都可能順帶升 numpy、下一步立即檢查

**備註**：numpy 2.0 ABI breakage 是 Python 生態大事件（2024 年 Q2）、影響大量 C extension package、非本專案特有。未來 1–2 年還會踩、可考慮升級到 `~/.claude/ERROR_LOG.md`。

---

### E41：RKNN simulator 不吃 `load_rknn` — 必須走 `load_onnx + build + init_runtime(None)`

**情境**：轉完 `best.rknn` 後想用 simulator 驗證 INT8 output：
```python
rknn = RKNN()
rknn.load_rknn('./best.rknn')
rknn.init_runtime(target=None)
# → RKNN model that loaded by 'load_rknn' not support inference on the simulator,
#   please set 'target' first!
```

錯誤訊息要求指定 target（實體板子），但本機沒板子、只能走 simulator。

**原因**：rknn-toolkit2 的 `.rknn` 檔是 hardware-specific binary、含針對 NPU 的最佳化 kernel、不含 simulator 需要的 graph 中間狀態 metadata。`load_rknn` → `init_runtime(target=None)` 這條路在 API 設計上就不支援、是 hard block。simulator 必須從 ONNX source 開始、讓 toolkit 在 build 過程中保留 simulator 需要的 metadata。

**解決**：驗證時每次重做 quantization：
```python
rknn = RKNN()
rknn.config(target_platform='rk3588', quantized_dtype='asymmetric_quantized-8', ...)
rknn.load_onnx(model='./best.onnx')
rknn.build(do_quantization=True, dataset='./calibration.txt')  # ~1 min
rknn.init_runtime(target=None)  # simulator OK
rknn.inference(...)
```

200 張校正集、build 約 1 分鐘。每次驗證成本可接受。

**預防**：
1. 本專案 `_verify_rknn_vs_onnx.py` 已走這條路、下次有類似驗證需求直接重用
2. API 誤解陷阱：rknn-toolkit2 文件對 `load_rknn` vs `load_onnx` 的差異沒講清楚、實際差很大。凡是要跑 simulator 的場景、無腦走 load_onnx 路徑、不要試 load_rknn
3. 若未來有實體 RK3588 板子、可改 `target='rk3588'` 接實體驗證（`load_rknn + target=...` 這條路 OK、只是 simulator 不支援）

**備註**：rknn-toolkit2 API 特有限制、非業界通例（TensorRT / OpenVINO 的 serialized engine file 多半能走 simulator），但一旦理解就是固定限制、不會踩第二次。詳見 FINDINGS CCC-3。

---

## 2026-04-19（第 12 次 session）submit fast-path 造成「Illegal submit from under_review」與 queue counter drift

### E33：submit route 的 batch-level fast-path 跳過 annotated 中繼 → 打破 queue filter 與 editor readOnly 兩條 invariant

**情境**：標註者（annotator）在 batch 已 partial-promote（batch.state = under_review）的情況下繼續標圖、按 S 送出，遇到兩個症狀：
1. 偶爾跳 alert「送出失敗（圖片 jydr02）：Illegal submit from under_review。請回到佇列找這張重標/重送。」
2. 按 S 後畫面左上 queue counter 從 `3/374` 變 `3/373`（total 減 1、idx 不動），而不是預期的 `3/374 → 4/374`

使用者回報「之前標註到一半時有點擊過『送出目前進度給審核』」，這是 partial-promote 的觸發點。

**根因**：`web/app/api/images/[id]/submit/route.ts` 在 session 8 commit `59a0f07` 加的 fast-path：
```ts
const batchPromoted = img.batch.state === 'under_review';
newState = batchPromoted ? 'under_review' : 'annotated';
```
原意是 batch 已送審後新 submit 圖可 trickle 給 reviewer，但同時破壞兩條 pre-existing invariant：
- `web/app/(protected)/annotate/[imageId]/page.tsx:30` 的 annotator queue filter 只收 `assigned/needs_rework/annotated`，**不含 under_review**
- `web/app/(protected)/annotate/[imageId]/editor.tsx:43` 的 readOnly 檢查只認 annotated，**不含 under_review**

症狀 2 對應：fast-path 把圖直寫 under_review → queue filter 下次排除這張 → `images.length` -1、`idx` 不動 → counter drift。
症狀 1 對應：editor 不把 under_review 當 readOnly → 使用者用瀏覽器返回或貼 URL 回到該張 under_review 圖後按 S → server state machine 擋 `under_review → *`（包括 `→ under_review` — fast-path 原本只放寬 `assigned → under_review`）→ 400 「Illegal submit from under_review」 → client `alert()`。

**修法**：commit `194d0d6`。三檔：
1. `submit/route.ts`：移除 fast-path 與 `batchPromoted`。submit 永遠 `assigned → annotated`（`needs_rework → under_review` resubmit 分支保留給 session 11 reject-all 的反向 flip，邏輯獨立）。update stale comment 反映唯一合法 under_review 來源是 resubmit
2. `editor.tsx`：`readOnly = (state === 'annotated' || state === 'under_review')`；按鈕三分（annotated 解鎖重標 / under_review 已送審核靜態文字 / 其他 Submit）；防禦性補強，就算 legacy 資料還有 under_review 圖，editor 也不會再觸發 illegal submit
3. `tests/integration/annotations.test.ts`：regression test「keeps submits as annotated after partial-promote flipped batch to under_review」

push origin master、Vercel auto-deploy 觸發。

**預防**：
1. **寫跨 state fast-path 之前列 invariant checklist**：不只改 state machine，還要檢查所有 list / filter queries、UI readOnly 條件、notification triggers、audit records 有沒有跟新 state 同步。本例是 batch-level state 決定 image-level transition，下游 image-level filter / UI 沒同步 → bug
2. **fast-path 優化的 ROI 檢查**：優化跨越多少個 layer？每個 layer 的維護成本？使用者實際行為模式是否真的需要這個 shortcut？本例 trickle 送審 UX 價值低於維持 invariant 的成本，直接 revert 比擴充 invariant 便宜
3. **rare-path test coverage**：只在特定前置 state 才觸發的 path（例如「batch 已 under_review」），bug 會潛伏久才爆，test 必須 explicit 覆蓋
4. **使用者回報「按 S 後計數器不對」這類症狀**：優先懷疑「某條路徑讓某個 row 從 filter 條件中掉出」，queue filter 三態允收清單是第一個嫌疑地點
5. **legacy 資料清理 policy**：fast-path 在 prod 跑期間產生的 under_review 圖保留不回滾（intent 明確是送審、reviewer 照審即可），只修未來路徑

**備註**：session 8 的 fast-path 初衷沒錯（partial-promote 後 reviewer 要看到 trickle 圖），錯在只改 state machine 不改 queue filter 與 editor readOnly。跨 layer invariant 維護的教訓見 FINDINGS ZZ。列本專案 E33；不擴散到通用 ERROR_LOG（跨專案教訓已在 FINDINGS ZZ「跨 layer invariant」捕捉）

---

## 2026-04-19（第 11 次 session）YOLO export 500「響應體物件不應受到干擾或鎖定」

### E32：`@vercel/blob` v2 `put(stream)` 非 multipart 路徑 retry 撞到 undici ReadableStream consumed

**情境**：使用者在 project 頁按「Download zip」匯出 710 張已 approve 的 YOLO dataset。Client 跳紅色 toast 顯示 `響應體物件不應受到干擾或鎖定`（Chrome auto-translate 中文版），F12 Network 看到 `POST /api/projects/[id]/export` 500。小 batch（100 張以下）同一條路徑從來沒事。

**根因**：`web/app/api/projects/[id]/export/route.ts:132` 呼叫
```ts
await put(key, stream, { access: 'public', contentType: 'application/zip', addRandomSuffix: false, token: ... });
```
沒帶 `multipart: true`。`@vercel/blob` v2 在 `requestApi` 層用 `async-retry` 做 HTTP 重試（`node_modules/@vercel/blob/dist/chunk-WLMB4XQD.js:575, 658`；`VERCEL_BLOB_RETRIES` 預設 10）。非 multipart 路徑直接把整個 `ReadableStream` 當 `fetch(uploadUrl, { body: stream })` 的 body（`chunk-WLMB4XQD.js:1226`）。710 張 zip 邊組邊上傳較慢，第一次 PUT 撞 Vercel edge timeout / 中斷後 retry 想重用同一 stream、但 stream 已被 undici 消耗 → throw `The response body object should not be disturbed or locked`。錯誤冒回 export route 外層 catch block → 500。

**修法**：commit `2623dfb`。`put()` 加 `multipart: true`。multipart 模式（`uncontrolled.ts` 的 `uncontrolledMultipartUpload`）從 stream 讀 chunk 切成 parts，每個 part 獨立 PUT + 獨立 retry；失敗 part 不需要重讀整條 stream，不會碰到 disturbed/locked。這是 Vercel Blob 官方對大檔 streaming 的建議。

**預防**：
1. 任何以 `ReadableStream` 為 body 且走 `@vercel/blob` `put()` 的 endpoint，一律加 `multipart: true`，不要只在「檔案大的時候才加」 — 小檔也沒壞處，大檔 retry 才救命
2. 更通用：**任何「stream body + 外層 HTTP retry」組合都有 disturbed/locked 風險**。自己寫 client 也要確認 retry 前有 fresh stream（例如用 factory function 產生新 stream），不要假設能重用
3. 「小 batch 過、大 batch 炸」的 bug 症狀大多是「某條 fast path 在大資料時才被觸發的 retry / timeout / streaming 路徑有問題」。debug 時先問「small case 走哪條 code path、large case 走哪條」
4. 錯誤訊息被 browser auto-translate 後別 Google 翻譯版 — 先用原文（undici + next.js + 「disturbed or locked」）搜、命中率高很多

**備註**：`@vercel/blob` + undici + async-retry 三方互動產生的 edge case，非本專案業務邏輯，但 API 使用姿勢 bug。詳見 FINDINGS YY。不擴散到通用 ERROR_LOG（跨專案教訓已在 FINDINGS YY「大檔 streaming upload 一律用 multipart」捕捉）

---

## 2026-04-19（第 9 次 session）partial-promote 空送審產生 0-image batch

### E31：`updateMany` count=0 仍 flip batch.state → reviewer dashboard 多出 0 images 空 batch

**情境**：標註者在還沒標完、自己身上 0 張 `annotated` 的狀況下按下「送出目前進度給審核」→ prod Neon 上 batch `標註者-1` state 被改成 `under_review`、但 113/114 張 image 仍停在 `assigned`。reviewer dashboard 跑 `_count.images where state='under_review'` query，看到 `FRC 視覺 2026-04-18 (auto) — 標註者-1 (0 images)`。之後標註者繼續標並 submit，session 8 的 submit route 新邏輯「batch 已 under_review → 跳過 annotated 中繼直寫 under_review」被踩中，image 被跳狀態、batch 內混雜 `assigned` + `under_review`，畫面更亂。audit log 留下 `batch.promote by 標註者 payload={"promotedImages":0}` 鐵證。

**根因**：`web/app/api/batches/[id]/promote/route.ts`（session 8 `59a0f07` 新檔）
```ts
const { count } = await tx.image.updateMany({
  where: { batchId, state: 'annotated' },
  data: { state: 'under_review' },
});
if (batch.state === 'in_annotation') {
  await tx.batch.update({ data: { state: 'under_review' } });
}
```
count=0 是合法 Prisma result（沒 row 符合 where、不 throw），但 container flip 的 guard 只問「batch state 是否允許 transition」、沒問「child update 到底改了幾 row」。空 promote 因此仍然改動 batch.state。

**修法**：commit `fcfc0ae`。`updateMany` 後立刻 `if (count === 0) throw new HttpError(400, '目前沒有已標註的圖可送審')`；batch flip 放到 count>0 分支後。前端 `editor.tsx:278` 的 `setStatus(msg)` 直接把錯誤訊息秀給 annotator，體感足夠，未加 UI disable。push 後 Vercel auto-deploy。

**資料修復**（prod Neon，via `web/scripts/_fix-batch-yan.ts --apply`）：
- batch `標註者-1` state `under_review` → `in_annotation`
- 那 1 張被跳狀態 image 在修復前已被 reviewer approve、保留 approved
- 113 張 assigned image 回標註者佇列

**預防**：
1. 任何「先 bulk-update child rows、再根據某前置 state flip container」的 endpoint，container flip 的 guard **必須同時**包含（a）container state 允許 transition（b）child bulk update `count > 0`。只問 a 不問 b 會讓「client 誤觸但實際沒東西可改」的 request 對 container 留下副作用
2. 新增「跨 state fast-path」（例如本專案的「batch 已 under_review → image 直寫 under_review 跳中繼」）會放大任何錯誤 flip 的爆炸半徑 — 前置條件的 precondition 必須收緊到不接受任何 allowed-but-wrong 狀態
3. 未來類似 UX（partial-reject、bulk-approve 等）寫 checklist 時，一律先列 count=0 case 怎麼 handle
4. 診斷類 script 留在 `web/scripts/_*.ts`（未 commit，延續 session 7 慣例），之後撞到狀態詭異 batch 可直接 `_diag-batch.ts` 快速看全貌

**備註**：非技術障礙、純 server-side edge case 的 precondition bug。列本專案 E31；不擴散到通用 ERROR_LOG（跨專案教訓已在 FINDINGS UU「bulk update count=0 guard」捕捉）

---

## 2026-04-18（第 6 次 session，續 2）按一次 ← / → 跳超多張

### E26：`keydown` handler 沒擋 `e.repeat` → 按住方向鍵 OS 以 ~30Hz 連發 → `router.push` 疊很多次

**情境**：標註者反應「按一次方向鍵會一次往後超級多張照片」。實際是輕按卡幾毫秒 OS 就當你按住、啟動 key repeat，一秒內 30 次 keydown 全 enqueue `router.push(nextId)`。

**根因**：`web/app/(protected)/annotate/[imageId]/editor.tsx` 的 ←/→ nav useEffect 的 handler 沒判 `e.repeat`。Windows 預設 key-repeat delay ~500ms、rate ~30/s，輕微按住就觸發。第一次 keydown 觸發 `router.push` → 新頁還沒 mount 之前，同一個 handler 已經吃到第 2、3、4... 個 keydown，全部 `router.push` 相同的 nextId；navigations 在 Next.js App Router 會以串行方式執行，但 prefetch 機制讓它們「跳得很快」，加上期間 prevId/nextId 透過重 render 換成下一組，下下頁也被 queue 走。結果就是一按就飛超多張。

主 shortcut handler（S / Delete / 數字 / Ctrl+Z）同樣沒擋 repeat，按住 S 會連續打 submit POST、按住 Delete 會連刪等，雖然後端有 state machine 擋住但還是浪費 request + 製造混亂 status。

**修法**：commit `fbd5b27`。兩支 `useEffect` 的 handler 最前面都加 `if (e.repeat) return;`（nav handler 另外加 `e.preventDefault()` 避免預設行為）：
```ts
if (e.repeat) {
  e.preventDefault();
  return;
}
```
要求使用者「離鍵再按」才算一次操作。單按多次（快速點擊）仍然各自觸發，符合預期。

**預防**：
1. 任何觸發「導航 / POST / 不可逆操作」的 keyboard handler，**預設必加 `e.repeat` guard**。視覺類（純狀態更新、沒 side effect）可以不加
2. 即使 handler 很薄（router.push + 一個 fetch），別以為「按一下就是一次」— OS 跟 browser 的 key repeat 是標配，不信邪就會像這次
3. 寫 keyboard shortcut 的 checklist 加三個問：是否 input/textarea？是否 repeat？是否要 preventDefault？

**備註**：
- 跟 E23（setState updater 內 deref ref）有點像，都是「看似只觸發一次、實際被 framework 連續呼叫多次」— 一個來自 React concurrent、一個來自 OS key repeat。之後 interactive code review 要主動檢查類似 assumption 是否成立
- 純 UX bug，不列通用 ERROR_LOG；但「keyboard handler 必擋 e.repeat」是跨專案都適用的教訓

---

## 2026-04-18（第 6 次 session，續）「save failed 重登就好」與「無法返回上一張」

### E24：JWT maxAge = 1h + annotate 頁不切頁 → 1 小時後 autosave / submit 全炸「save failed」

**情境**：標註者連續標了一小時以上，按 S 或 autosave 觸發 `/api/images/[id]/annotations` PATCH → footer 顯示「save failed」→ 重新 Google 登入後同一頁直接又能存。斷斷續續發生在多位標註者。

**根因**：兩個因子疊加：
1. `web/lib/auth.ts:7` 原本 `session: { strategy: 'jwt', maxAge: 60 * 60 }`（1 小時）
2. annotate 頁的 flow 是「連續存同一頁 + 同一 imageId + 不切頁」— 整段時間沒有任何 request 會觸發 Auth.js jwt callback 執行，JWT 不會 rotate，到期就是到期
3. `/api/images/[id]/annotations` PATCH 用 E12 老 pattern `throw Object.assign(new Error('Unauthenticated'), { status: 401 })`，Next.js App Router framework 把 throw 吞成 **500 空 body**，client 只看到 `!res.ok` → setStatus('save failed')，不知是 auth 問題

重登之所以好用：重新 Google SSO → 拿到新 JWT cookie → PATCH 就通。但使用者不知發生什麼事，只感受到「系統無預警壞掉，重登就好」。

**修法**：commit `11ae026`。
1. `web/lib/auth.ts`：`maxAge` 從 `60 * 60` 改 `60 * 60 * 24 * 30`（30 天，對齊 Auth.js 預設）
2. `annotations/route.ts`、`submit/route.ts`、`signed-url/route.ts` 三個常在標註 flow 撞到的 route，全部把 `throw` 遷成 `NextResponse.json({ error }, { status })`（延續 E12 的遷移進度）
3. editor client 端：PATCH / submit 收到 401 → setStatus「session expired — redirecting…」+ `window.location.href = '/login'`，不再靜默「save failed」

**預防**：
1. 凡是「使用者可能長時間停在同一頁、沒換頁 trigger」的 flow（標註、長表單、editor 類），JWT maxAge 至少設到使用者一次連續 session 上限的 10 倍；或另外在 client 端加 heartbeat 定時 ping `/api/auth/session` 強制 rotate。本案選前者（maxAge 30 天）較簡單
2. E12 遷移進度檢查：`grep -rn "throw Object.assign(new Error" app/api` — 下次看到還有殘留就一併遷
3. Client 端看到 PATCH/POST 失敗，status text 一律 include server 回傳的 `error` 欄位（透過 `res.json().then(j => j.error)`），不要只印通用「failed」

**備註**：屬本專案 Auth.js 設定 + E12 pattern 複合效應，不列通用 ERROR_LOG；但「長駐頁面的 JWT 設太短」是通用陷阱，未來別的專案若有 editor 類 UI 可回來看這條

---

### E25：Queue 過濾漏掉 `annotated` 狀態 → 送出後無法返回上一張

**情境**：標註者送出圖 #1 後跳到 #2，按 ←（或前一張按鈕）想回到 #1 修改，沒反應。

**根因**：`web/app/(protected)/annotate/[imageId]/page.tsx` 原本 queue 查詢：
```ts
state: { in: ['assigned', 'needs_rework'] }
```
送出後圖 #1 的 state 變 `annotated` → 掉出 queue → `prevId = queueIds[currentIdx - 1]` 永遠 undefined → ← 鍵 early return 不動作。使用者心智模型是「它還在我的 queue 裡，我還沒讓 reviewer 看」但我們的 data model 把它當成「已交出」→ UX mismatch。

**修法**：commit `11ae026`。
1. Queue filter 加 `annotated`：`state: { in: ['assigned', 'needs_rework', 'annotated'] }`
2. `editor.tsx` 判 `readOnly = (imageState === 'annotated')`，autosave + flush + delete/undo/class keyboard 全 skip；S 鍵不送出
3. Footer 按鈕 readOnly 時顯示「解鎖重標」→ POST 新 `/api/images/[id]/unsubmit` → state `annotated` → `assigned` → `router.refresh()` 回到可編輯模式
4. state machine 新增 `unsubmit` transition（僅允許 `annotated → assigned`；`under_review` / `approved` / `needs_rework` 都擋下，保證 reviewer 已介入的圖不會被拉回）

**預防**：
1. 設計 queue filter 時，要用「使用者認知這張圖還是不是他的」而非「資料庫 state 狀態機的某個子集」。本案 state 除了 `approved` / `under_review`，其他都該列在 queue 裡讓使用者看到
2. state machine 新增 transition 時，對應的 UI 觸發點（keyboard / 按鈕）+ server route 要同步加，寫 checklist

**備註**：嚴格說是 UX 缺陷，不算 bug。但使用者實際操作回報「無法返回」所以算壞體驗。不列通用 ERROR_LOG

---

## 2026-04-18（第 6 次 session）標註者拖動畫面時 Editor 整棵 unmount（panState ref null in setState updater）

### E23：`Cannot read properties of null (reading 'panX')` — setState updater 內 deref ref，React 19 concurrent 重跑時 ref 已被 mouseup 清掉

**情境**：標註者在 `/annotate/[imageId]` 按右鍵或中鍵拖動畫面 pan 視角，Edge 瀏覽器跳出黑底 `This page couldn't load / Reload / Back` 的 navigation 失敗畫面（不是我們的 error.tsx）。DevTools Console 印：
```
Uncaught TypeError: Cannot read properties of null (reading 'panX')
    at (AnnotationCanvas chunk):...
    at useState / az / aR / aL ...
```
不只一名標註者遇到，持續發生在 pan 操作。

**根因**：`web/components/annotation/AnnotationCanvas.tsx:216-223` 的 mousemove pan 分支寫法：
```tsx
if (panState.current) {
  const dx = e.evt.clientX - panState.current.startX;
  const dy = e.evt.clientY - panState.current.startY;
  setVp((cur) => ({
    ...cur,
    pan: { x: panState.current!.panX + dx, y: panState.current!.panY + dy },
    //        ^ 在 setState updater 內 deref ref
  }));
  return;
}
```
三個條件同時成立就炸：
1. React 19 concurrent rendering 允許 functional updater **被延後或重複執行**（render 被中斷 / 重排時）
2. `mouseup` handler（同檔 `:273`）同步把 `panState.current = null`
3. 若 mousemove 的 `setVp` 排進 queue 後，React 還沒跑完 updater 時 mouseup 已跑完 → React 之後才叫 updater → deref null → throw

錯誤發生在 render phase（不是 event handler），沒 error boundary 擋 → React 把整棵 Editor unmount → client 畫面空白 → Edge 認定 navigation 失敗、顯示 fallback UI。這也解釋為何看起來像「page couldn't load」而不是一般的 React error 紅屏。

**修法**：commit `ce10603`。把 ref 值先 snapshot 到 local `const base`，updater 只讀 closure：
```tsx
if (panState.current) {
  const base = panState.current;
  const dx = e.evt.clientX - base.startX;
  const dy = e.evt.clientY - base.startY;
  setVp((cur) => ({
    ...cur,
    pan: { x: base.panX + dx, y: base.panY + dy },
  }));
  return;
}
```

**預防**：
1. **絕對不要在 `setState(cur => ...)` updater 內 deref `ref.current`**（或任何會被別條路徑同步 mutate 的可變狀態）。React 18/19 concurrent 規則不保證 updater 跑幾次 / 何時跑，closure 進 updater 前先 snapshot
2. 未來寫 Konva / Canvas interactive state 機器時，event handler 與 React 狀態之間的橋樑要用 **local const snapshot → 傳入 updater**
3. 本 codebase 其他 `setState` updater 掃過一次，目前沒有同類 pattern（只此一處）；新增 canvas 功能時 review 重點

**備註**：
- 嚴格說是 React 19 concurrent rendering 行為，上一代 React 18 sync mode 機率低但仍可能觸發
- Edge 的 `This page couldn't load` fallback 在這類「render phase 爆但無 error boundary」情境等同於「tab 掛了」視覺訊號，下次看到類似畫面優先懷疑 render-phase throw
- 不列通用 ERROR_LOG（反例過於專案特定：Konva pan + panState ref pattern），但「updater 不 deref ref」這個教訓值得日後跨專案引用

---

## 2026-04-18（第 4 次 session，深夜）import 上雲 + DB 安全防護期專案特有錯誤

### E20：`BlobError: storage quota exceeded` — Hobby 1GB 上限對 dataset import 不夠

**情境**：`npx tsx web/scripts/import-per-owner.ts ...` 跑到第 2312 imgs 時 throw `BlobError: This blob store has exceeded the storage quota for your team plan`，整個 import script 中斷。前面 2311 imgs 已成功上傳到 Blob + 寫入 DB row，後續 ~1500 imgs 全停。

**根因**：Vercel Blob Hobby plan 限 1GB account-wide storage（不是 monthly bandwidth）。FRC 視覺資料集單張 ~400KB × 3775 imgs ≈ 1.5GB，從第一次 import 就會撞牆。Pipeline 沒有 pre-flight check 預估容量。

**修法**：升 Pro $20/mo 100GB → import script 用 resume mode（`--project-id=<existing>`）繼續跑，自動 skip 已存在 batches → 完成剩餘 ~1500 imgs。

**預防**：
1. Import script 啟動時 `console.log` 預估總容量，跟 Blob plan quota 比對給 warning
2. CLAUDE.md 標註 Blob plan 為 Pro，新人 onboarding 不要誤回 Hobby
3. （未來）import 前先 `vercel blob list --prefix frc-annotation/projects` 計算當前用量

---

### E21：tsx CJS 不支援 top-level await — 包進 `main()` async function

**情境**：寫 `web/scripts/check-db.ts` / `inspect-project.ts` / `delete-batch.ts` 時直接在檔案頂層 `await prisma.$queryRaw\`...\`` → 跑 `npx tsx scripts/X.ts` 報 `Top-level await is currently not supported with the "cjs" output format`。

**根因**：`web/` 的 `tsconfig.json` `module: commonjs`（Next.js 16 用 SWC 不影響，但 tsx 走 esbuild 採信 tsconfig），CJS 規範不允許 top-level await。Next.js app code 走 ESM 沒事，scripts 用 tsx 直跑會回到 CJS。

**修法**：把所有 await 包進 async main 並 catch：
```ts
async function main() {
  const rows = await prisma.$queryRaw`...`;
  // ...
}
main().catch((e) => { console.error(e); process.exit(1); });
```

**預防**：所有 `web/scripts/*.ts` 統一 `main()` pattern，不要再寫 top-level await（即使將來換 module format 也保險）。

---

### E22：Neon production DB 被 `prisma db push` 誤砸 — 三層防護避免復發

**情境**：之前 session 在 dev 機器跑 `npx prisma db push` 試 schema 改動，當下 `DATABASE_URL` 指向 Neon production main branch，整個 prod schema 被覆蓋（drop + re-create tables），所有資料瞬間消失。後來靠 Neon PITR (point-in-time recovery) 復原，但這種事不能再發生。

**根因**：
1. `web/.env` 的 `DATABASE_URL` 預設指向 prod（給 production runtime 用）
2. tsx scripts 跟 Prisma CLI 都讀同一個 `.env`，沒有環境區隔
3. `prisma db push` 是 destructive，預設不 prompt 確認

**修法（三層防護）**：
1. **Dev branch 隔離**：`web/.env.local`（高優先順序覆蓋 `.env`）把 `DATABASE_URL` host 換成 Neon dev branch (`<已移除>`)，所有 local script 自動跑 dev branch
2. **Runtime 警告**：`web/scripts/check-db.ts` 印當前 host + 高亮警告，每次跑 schema 相關 script 前先跑這個
3. **Written rule**：`web/CLAUDE.md` 加 DB 安全章節，列出 prod 禁止指令清單（`prisma db push`、`prisma migrate reset`、無 WHERE 的 `DELETE`/`UPDATE`），唯一允許的 schema 變更流程是「dev branch 試 → migration file → prod migrate deploy」，附 Neon PITR 復原連結

**預防**：
1. 任何 destructive Prisma 指令一律先 `tsx scripts/check-db.ts` 確認 host
2. 將來考慮加 `package.json` script wrapper，自動拒絕 host 含 `<已移除>`（prod endpoint）的 destructive 操作
3. CI / CD 不允許 production 環境跑 `db push`，只跑 `migrate deploy`

**備註**：Neon PITR 救得回，但 downtime + 資料一致性風險高（標註者 in-flight 的進度可能掉）。Dev branch 是 free tier 就能開的功能，沒有藉口不用。

---

## 2026-04-18（第 2 次 session，下午）auto-annotation pipeline Stage 2–4 實戰期專案特有錯誤

### E14：`cv2.imwrite` 在 Windows 非 ASCII 路徑 silently 失敗 — 影響中文 owner 的抽幀

**情境**：`python auto_pipeline.py preprocess` 跑完沒報任何錯誤，`preprocess_state.json` 顯示各 owner 處理完成張數，但實際 check `datasets/frc-vision-raw/processed/{隊友A,隊友B,隊友C,隊友D}/images/` 資料夾完全是空的。英文名的隊友（ASCII 路徑）與純靜態照片走 PIL 的 owner（隊友E / 隊友F）資料夾都有檔案。

**根因**：OpenCV 在 Windows 的檔案 IO 用 C-stdio (`fopen`)，Windows `fopen` 只接受 ANSI code page（本機是 cp950），non-ASCII 路徑被 MBCS 轉換失敗 → `fopen` 回 NULL → `cv2.imwrite` 回 False 但 **不拋例外**、不 log。Pipeline 只檢查「`VideoCapture` 讀影片成功、`imwrite` 被呼叫過」兩件事，沒檢查 `imwrite` 的回傳值，於是 state file 樂觀地記錄「完成了」但 disk 沒產物。

`cv2.VideoCapture` 本身沒事（走 FFmpeg backend，Unicode path 正常），導致問題集中在 write 端，很難從 symptom 直接推回根因 — 直覺會懷疑影片本身壞、HEIC 解碼壞，不會懷疑寫檔。

**修法**：commit 待 push（本 branch 尚未 commit，見 PROGRESS.md Session 2026-04-18 下午）。`auto_pipeline.py` 的 `extract_frames_1fps` + `cmd_preview` 把所有 `cv2.imwrite` 改成 `encode + write_bytes`，`cv2.imread` 改成 `np.fromfile + imdecode`：
```python
# Before:
cv2.imwrite(str(out_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])

# After:
ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
assert ok
Path(out_path).write_bytes(buf.tobytes())
```
Rerun preprocess 前手動清 `preprocess_state.json` + 各 owner `source.json` 裡「outputs 指向不存在檔案」的 8 筆壞紀錄（留下 793 筆有效），避免 resume 跳過應該重跑的項目。

**預防**：
1. 所有 cv2 file IO 的 write 必須檢查回傳值或改用 `encode + write_bytes` pattern（推薦後者，語意清楚）
2. Pipeline 的 state 寫入前增加 `out_path.exists()` assertion — 寫 state 前必驗檔案真的在 disk 上
3. 中文 / 日文 / 韓文 owner / filename 是未來訓練場景常態，不是 edge case。任何新 IO code 都要在 non-ASCII 路徑上測過
4. 相關技術細節見 FINDINGS.md 發現 EE

**備註**：專屬 Windows + opencv-python 的行為，Linux / macOS 不會撞到（POSIX 檔案 API 直接收 bytes，無 code page 轉換）。所以在 Linux CI 上 test 永遠會 pass，錯誤只在 production 用戶的 Windows 機器觸發 — 這類 OS-specific trap 本地環境必須實測。

---

### E15：Gemini API 呼叫全失敗 HTTP 400 `API_KEY_INVALID` — 原來貼的是 OAuth access token 不是 API key

**情境**：Stage 3 annotate 啟動，每一個 request 都回 `HTTP 400 { "error": { "code": 400, "message": "API key not valid. ...", "status": "INVALID_ARGUMENT" } }`。原本以為是新 key quota 沒生效 / 模型名稱錯 / Prompt JSON schema 錯。

**根因**：使用者從 `gcloud` 或類似 OAuth 流程拿到一個看起來很長的 token（`AQ.<已移除>...` 開頭），誤以為那是 API key 貼進 `GEMINI_API_KEY`。實際上：
- **Gemini API key** 必為 `AIzaSy` 開頭 + 39 chars + `[A-Za-z0-9_-]`，從 https://aistudio.google.com/app/apikey 產生，不過期
- **OAuth access token** 常見 `AQ.` / `ya29.` 開頭，長度不固定（>100 chars），含 `.` 等特殊字元，用 `Authorization: Bearer` header 送、1 小時過期

兩者 API 不 interchangeable — Gemini API 在 `?key=` query 或 `x-goog-api-key` header 期望 API key，收到 OAuth token 一律 reject 為 invalid key，錯誤訊息沒告訴你是 format 錯還是 revoked。

**修法**：使用者重新從 https://aistudio.google.com/app/apikey → "Create API key" 產生一把 `<已移除>`，`export GEMINI_API_KEY=AIzaSy...` 後 pipeline 一次跑通 2518 張 0 error。

**預防**：
1. `auto_pipeline.py` 讀 `GEMINI_API_KEY` 時加字首 / 長度檢查：若不是 `AIzaSy` 開頭或非 39 chars，直接 SystemExit 並提示正確產生方式 — 本 session 尚未加，建議下次改 pipeline 時順手補
2. 在 onboarding doc 明確區分兩種 token 的外觀 + 產生路徑（見 FINDINGS.md 發現 FF 的對照表）
3. 當 API 回 `API_KEY_INVALID` 時，第一反應是檢查 key 字首，不要先懷疑 model name / schema — 後兩者會有更具體的錯誤訊息（`404 NOT_FOUND` / `400 INVALID_ARGUMENT: response_schema ...`）

**備註**：不只本專案，未來任何用 Gemini API 的 script 都會踩這個坑。是否要升級到 `~/.claude/ERROR_LOG.md` 當通用條目可考慮，但本次先記本地。

---

### E16：Stage 4 產出的 batch.zip 全部超 200 MB，web 上傳被拒 — cap 算錯 base

**情境**：Stage 4 package 跑完產 8 個 batch.zip，大小 219 MB–471 MB，上傳 web 的 `/api/batches/[id]/finalize` 前端直接擋（blob upload 就會 413 / 對 zip size 做 client-side check）。

**根因**：`auto_pipeline.py cmd_package` 的切 batch 邏輯用 `cap_bytes = MAX_UNCOMPRESSED_BYTES * 0.9 = 450 MB` 估算上限。但 `web/lib/zip-validator.ts` 實際上有兩個獨立 cap：
- `MAX_COMPRESSED_BYTES = 200 MB` — zip 檔本體 size 上限，**先檢查**
- `MAX_UNCOMPRESSED_BYTES = 500 MB` — 所有 entry 解壓後總和，後檢查

Web 拒絕點在前者，後者只是 zip bomb 防線。Pipeline 誤把後者當主 cap → 切太大 → zip 檔本體 ≈ raw bytes 總和（因 JPEG 壓不動 deflate，見 FINDINGS 發現 GG）→ 實際 zip 輕鬆破 200 MB。

**修法**：
1. `cap_bytes = int(MAX_COMPRESSED_BYTES * 0.9) = 180 MB`（留 10% buffer 吸收 zip central directory overhead + 切 batch 的離散誤差）
2. `ZIP_DEFLATED` 改 `ZIP_STORED` — JPEG 壓不動，deflate 純浪費 CPU。STORED 下 compressed ≈ uncompressed，`cap_bytes` 用 raw size 累加估算即直覺對齊
3. Wipe `batches/` 整個重跑 → 16 batches，最大 188.8 MB，全部 pass

**預防**：
1. Pipeline 側硬編 web 端常數（`200 MB` / `500 MB` / `500 imgs` / `20 MB per file`）— 若未來 web 提升限制，pipeline 要同步抬。考慮：
   - 抽出 `web/lib/zip-validator.ts` 的常數到一個 json 檔，pipeline 跟 web 都讀
   - 或建一個 `/api/config/limits` endpoint，pipeline 啟動時 fetch
   - 目前限制值穩定，硬編可接受 — 但變更時兩邊要對齊
2. 有多個 cap 時，先確認**哪個 cap 會先拒絕**（web finalize 順序：blob.size → unzip → entry count → per-entry size → uncompressed sum）。pipeline 估算對齊最先觸發的 cap，不是最後的
3. 這種 test-the-wrong-cap 類 bug 很難靠 unit test 抓到（需要 web + pipeline 整合），未來類似情境（匯出 / 匯入 契約）都要 end-to-end 至少跑一次真實 payload

**備註**：
- `MAX_COMPRESSED_BYTES = 200 MB` 的設定理由是 Vercel Blob + Postgres row size + client download UX 綜合考量（詳情查 `web/lib/zip-validator.ts` 的 comment 或 M3 spec）
- 本 bug 也反映一個 cross-repo boundary 的文件問題：web 端的 constraint 沒公告給 pipeline 作者，全靠源碼挖 — 或許 web 端可以在 `/api/batches/[id]/finalize` 的錯誤 response 明確列出違反的 limit + 當前值 + 上限，讓 pipeline 作者 debug 不用讀 web source

---

## 2026-04-17 (第 7 次 session) onboarding 跳轉 + reject preset 期專案特有錯誤

### E13:首次登入輸入名字後卡在 `/onboarding/name`，沒跳轉到 dashboard

**情境**:新使用者第一次 Google SSO 登入 → 被 proxy redirect 到 `/onboarding/name` → 輸入中文名字 → 按「儲存」→ 頁面沒變化,仍停在 `/onboarding/name`。但 hard refresh 後就會跳到 dashboard。

**根因**:三個機制交互:
1. `name-form.tsx` PATCH `/api/me/display-name` 成功 → DB 寫入 `User.displayNameSetAt = now()`
2. 接著 `await useSession().update()` — 意圖觸發 Auth.js jwt callback 重跑、rotate cookie
3. 最後 `router.push('/')` — client-side nav,經 `proxy.ts` 的 `auth()` gate

問題在步驟 2:**next-auth v5 beta.31 的 `update()` 不保證當場 rotate JWT cookie**。client-side 可能只更新記憶體 session object,cookie 還是舊的（`hasDisplayName === false`）。步驟 3 的 `router.push` 經 proxy auth() gate 時讀到 stale cookie → proxy redirect 回 `/onboarding/name` → 使用者看到「按儲存後沒變化」。

**修法**:commit `6767a05`。`web/app/(protected)/onboarding/name/name-form.tsx` 移除 `useSession` + `useRouter` 依賴,PATCH 成功後直接 `window.location.href = '/'`。完整頁面導航讓瀏覽器重新送 request → proxy auth() 的 jwt callback 從 DB 讀最新 `displayNameSetAt` → rotate cookie → proxy 看到 `hasDisplayName === true` → 放行。

```tsx
// 前:
const { update } = useSession();
const router = useRouter();
// ...
await fetch('/api/me/display-name', { ... });
await update();
router.push('/');

// 後:
// 無 useSession、無 useRouter
await fetch('/api/me/display-name', { ... });
window.location.href = '/';
```

**預防**:凡是「server 改 DB session state 後前端要即時反映」的流程,優先用 `window.location.href` 而非 `router.push + useSession().update()`。除非 next-auth 升到 stable 且測過 `update()` 可靠。

**備註**:詳細技術分析見 FINDINGS.md 的 Finding Z（next-auth v5 beta.31 update 不穩定）+ Finding AA（Next.js 16 proxy 預設 Node.js runtime,Prisma 在 jwt callback 可用）。

---

## 2026-04-17 (第 3 次 session) step-up-only authz + UI 補完期專案特有錯誤

### E10：`/admin` 等 layout-only 目錄沒 `page.tsx` → 404

**情境**：使用者以 admin 步驟通過 step-up 後進 `/admin` 想看總覽,回 404。但 `/admin/members` 有料可看。

**根因**：Next.js App Router 要求每個 URL segment 有 `page.tsx` 才 routable。`web/app/(protected)/admin/` 目錄下只有 `layout.tsx`（StepUpGuard wrapper）+ 子目錄 `members/`,不構成 `/admin` 本身的路由。子路由 `/admin/members` 能走是因為 `members/page.tsx` 存在。

**修法**：新增 `web/app/(protected)/admin/page.tsx`：
```tsx
import { redirect } from 'next/navigation';
export default function AdminIndex() { redirect('/admin/members'); }
```
Commit `79da235`。

**預防**：每個有子路由的 segment 都要問「這個 segment 本身的 URL 要做什麼？」— 若無意義則放 `redirect()` 到 canonical 子頁,不要讓它默默 404。這是 App Router footgun — 目錄裡有東西（`layout.tsx`）看起來就該 work,結果不行。

**備註**：專屬 App Router 結構設計,但這種「layout 有但 page 沒有 → 404」的陷阱也可能出現在別處（例如 `/projects/[id]/batches` 若有 layout 沒 page）,未來新增 layout 時要順手檢查。

---

### E11：`/admin/members` 白名單登入閘門拿掉後顯示不出新登入 user

**情境**：admin 進 `/admin/members`,只看到自己 + 預先埋進 whitelist 的幾筆。任何已用 Google 登入過但沒 pre-add 到 whitelist 的隊友完全隱形。

**根因**：`admin/members/page.tsx` 的查詢以 `whitelist.findMany()` 為主表,join User by email。白名單 sign-in gate 拿掉後（commit `092d745`）,`signIn` callback 對未知 email fallback 為 `role='annotator'` 建 User row,但**不**同時建 EmailWhitelist row。於是：
- whitelist 有 row → 顯示（seeded admin）
- whitelist 沒 row 但 User 有 row → **被主表 join 邏輯排除,看不到**

這個 query 之前對是因為 whitelist 本身就是 sign-in gate,invariant 是「每個 User 必有 whitelist」— 現在這個 invariant 沒了。

**修法**：commit `00b6fce`。翻轉主表方向：
- `User.findMany()` 為主,join `EmailWhitelist` 為 optional
- 分兩區：「已登入 (N)」（所有 User,並顯示 whitelist role drift）+「預訂白名單 (N)」（僅在有 whitelist row 但無對應 User 時顯示）

**教訓**：當兩表的關係從「必 join」變成「可 join」（invariant 放鬆），`findMany` 的主表選擇可能整個反了。要主動搜 codebase 每個 `findMany` on 受影響的表,檢查 join 方向。這次是搜不出來的（commit 時沒看出 `/admin/members` 的 query 假設依賴 whitelist sign-in gate invariant）,下次做類似 invariant 變更要加 checklist。

**副作用（意外收穫）**：新版「已登入」區塊同時讓 E4 的 L1 drift（whitelist role 變但 User.role 沒同步）終於可見,amber `{role}（未同步）` 提醒 admin。

---

### E12：Next.js route handler `throw` 在 production 被吞成空 body 500

**情境**：使用者上傳 batch 到 finalize 時錯誤訊息只顯示「finalize failed:」後面空白。server log 雖記了 detail,但 client 無法自助 debug。

**根因**：`throw Object.assign(new Error('...'), { status: 400 })` 這個 pattern 在 Next.js App Router route handler 沒有被 framework serialize。`throw` 會冒到 Next.js 的 error boundary → 統一成 500 空 body,不管你掛了什麼 status。`{ status }` 只是 Error 上的 ad-hoc property,framework 不看。

**修法**：commit `72500df`。所有失敗分支改 `return NextResponse.json({ error: msg }, { status })`;外層 try/catch 吸未預期錯誤；client 端改 `await response.json().then(j => j.error)` 讀 detail；finalize 特定地把 classes mismatch 的 `expected=[...] got=[...]` 塞到 error message。

**遺留**：其他 route（approve / reject / submit / assign）仍用 throw pattern,下次碰到時遷移。

**預防**：新寫 route handler 時強制用 return + NextResponse.json。可考慮加 ESLint 自訂 rule 或 code review checklist:「route handler 內不得有 `throw` 超過最外層 try/catch」。

**備註**：
- FINDINGS 發現 O 有完整技術討論
- Next.js 16 App Router 官方 idiom 就是 return,不是 throw — 不是 bug 是 framework philosophy。只是我們寫 route 時習慣 throw 錯誤所以撞到

---

## 2026-04-16 M3 finalize 遇到的專案特有問題

### E1：Batch finalize 在 server 端 fetch 任意 URL → SSRF 風險

**情境**：`/api/batches/[id]/finalize` 會拿 client 回傳的 `zipUrl` 去 `fetch()`。若沒限制 host，攻擊者可讓 server 去打內網或 metadata endpoint。

**修法**：驗 `new URL(zipUrl).hostname` 必須結尾於 `.public.blob.vercel-storage.com` 或 `.blob.vercel-storage.com`，其餘一律 reject。

**備註**：記在本地而非通用，因為 allow-list 是 Vercel Blob 專案綁定，沒跨專案共用性。

---

### E2：ZIP 路徑 edge case —— Windows drive / null byte / control char

**情境**：`fflate` parse 出來的 filename 若是 `C:\foo.jpg` 或含 `\0` / `\x01-\x1f`，寫 disk 或傳 blob pathname 時會炸。

**修法**：`lib/zip-validator.ts` 新增三條 reject rule：
- match `/^[A-Za-z]:[\\/]/`（Windows drive prefix）
- 含 `\x00`
- 含 `[\x00-\x1f]` control char

**備註**：`..` 目錄穿越早就擋了，這三條是 fuzz 補強，專屬本專案的 zip import 流程。

---

### E3：Image content-type 用副檔名判斷不可信

**情境**：若有人上傳 `foo.jpg` 內容其實是 PNG（或可執行檔），下游渲染/儲存會錯。

**修法**：`lib/blob.ts sniffImageMime(bytes)` 讀前 4–12 bytes 的 magic：
- `89 50 4E 47` → `image/png`
- `FF D8 FF` → `image/jpeg`
- `52 49 46 46 .. .. .. .. 57 45 42 50` → `image/webp`
- 其他一律 reject

---

### E4：白名單 role 改了，既有 User.role 不同步（L1 backlog）

**情境**：admin 把 `whitelistEntry.role` 從 `annotator` 改成 `final_reviewer`，但該 user 下次登入走 `signIn` callback 時，DB 裡 `User.role` 不會自動跟著改（upsert 只在首次建立時寫 role）。

**目前狀態**：未修，列為 L1 backlog。workaround：手動改 `User.role` 或該 user 重註冊。

**備註**：不是嚴重 bug，admin 面板可補一個 "sync role from whitelist" 按鈕解決。

---

## 2026-04-17 Step-up auth 實作期專案特有錯誤

### E5：Vitest 檔案層 FK 殘留 —— `admin-api-stepup.test.ts` 炸一次後拖垮全部

**情境**：連續跑 `pnpm test` 有機率 10 failed across 6 files，單檔跑又過。案情：按字母排序最前的 `admin-api-stepup.test.ts` 的 `beforeAll` 跑 `user.deleteMany` 時被前一輪 crash 殘留的 `AuditLog` FK 擋 → 這檔本身的 `beforeAll` 失敗 → 後續檔案進去時 DB 殘渣更多 → 連鎖。

**根因**：Neon pooled connection + Prisma 7 不保證 session-level rollback 的殘留能被下一個 vitest worker 看見。`fileParallelism: false`（M7.7 已設）只排除 race，但不能清前一輪的孤兒 row。

**修法**：新增 `web/tests/helpers/clean-db.sql`，手動執行：
```bash
pnpm dlx dotenv-cli -e .env -- prisma db execute --file tests/helpers/clean-db.sql
```
TRUNCATE CASCADE 全部業務表 + auth 相關表，RESTART IDENTITY 重設 serial。

**備註**：
- 只在症狀出現時手動跑，不進 `globalSetup`（會拖慢每輪）
- 專案特有：Prisma schema 的表名清單寫死在 SQL 裡，跨專案不可攜
- 若未來此症狀反覆出現，應考慮 `globalSetup` hook 做一次性 reset

---

### E6：Plan-vs-reality drift —— 明細前撲後繼中間會卡的 5 處 signature 不符

**情境**：執行 2026-04-16 寫的 three-interfaces-step-up plan 時，subagent 按 plan 字面實作屢屢撞到既有 codebase convention 不符，不得不 patch。

**修法摘要**：
| Plan 假設 | 實際 codebase | Patch 方向 |
|---|---|---|
| `withTestSession` helper | 不存在，convention 是 `__setFakeSession` | 測試改 call `__setFakeSession` |
| `writeAudit({ action, userId, ... })` object-arg | 既有 `lib/audit.ts` 是 positional `writeAudit(action, userId, meta)` | route handlers 改用 positional |
| Upstash rate limit spec-compliant | Plan 漏 10-min 鎖（只有 5/min slide window） | I1 patch 加上 10-min lock-out（fixed window on denial） |
| `/api/admin/whitelist` | 實際是 `/api/admin/users`（M1.6 命名）| plan 與 test path 全改 |
| `/api/batches/[id]/export` | 實際是 `/api/projects/[id]/export` | plan 與 test path 全改 |
| Plan 改 `/review/page.tsx` | 檔案不存在（M6 只有 tray 在 dashboard） | 新建 page.tsx |
| `next-auth.d.ts` 新建 | M1 已存在（augment `id` + `role`） | extend 不 overwrite |

**後續措施**：
- 每次 plan 跑完一個 phase 就在 plan doc 底部寫 "amendment note"，避免 drift 累積
- Subagent prompt 要加「**不要假設檔案存在，先 ls + read**」的 tripwire

**備註**：算是「寫 plan 時 context 不足」的通用 risk，但清單具體對應本專案特有 path/signature，列本地而非 `~/.claude/ERROR_LOG.md`。

---

### E7：`unstable_update()` + server route 的 race window（先前 spec 階段已修，留此存檔）

**情境**：回顧 2026-04-16 第 5 次 session 規劃時曾試過用 Auth.js v5 的 `unstable_update()` 從 `/api/auth/stepup` server route 主動更新 JWT 塞 step-up 狀態。實作時驗證：`update()` 在 server route 呼叫完後，**同一個 request 的後續邏輯看得到舊 token**，要下一次 request 才生效 → 使用者若「按下按鈕、立刻又點下一個按鈕」會擊中 race window。

**修法**：改用獨立 HMAC-signed httpOnly cookie（見 FINDINGS.md 發現 H），完全與 Auth.js JWT 解耦，server 寫 cookie 同一個 response 就帶走，下一個 request 必讀到。

**備註**：專屬 Auth.js v5 + Next.js 16 server route 的行為；其他 framework 不見得有此 race。這段踩雷已在 spec 階段處理、實作階段沒再觸發，純記錄存檔避免未來有人回去試同一條路。

---

## 2026-04-17 (第 2 次 session) 短收尾期專案特有錯誤

### E8：Google sign-in 回 "Access Denied / You do not have permission to sign in"

**情境**：使用者 Gmail 登入 `https://frc-annotation.vercel.app`，選完帳號後 Google 顯示 AccessDenied。這是 Auth.js 的 `signIn` callback 回 `false` 時 Google OAuth 看到的標準錯誤。

**根因**：`web/lib/auth.ts` 的 `signIn` callback 查 `prisma.emailWhitelist.findUnique({ where: { email } })`，找不到就 `return false`。使用者明確要求「不要有白名單限制，讓全部人可進」，這個 gate 本身就是走錯方向。

**修法**：`web/lib/auth.ts:9-14` 改為「白名單找不到 → fallback `role = 'annotator'`」：
- 白名單仍保留作為「指定某些 email 為 admin / final_reviewer」的晉升機制（role override）
- 沒在白名單裡的 Gmail 依然可登入，只是預設 role 為 `annotator`
- Commit `092d745`

**安全論證**：reviewer / admin 頁面仍有 step-up 密碼（`<已移除>` / `<已移除>`）擋著，加上 `requireStepUp` 在 API route 層的雙重保護，開放 annotator 門檻 ≠ 開放 reviewer / admin 操作。

**預防**：今後若真要重新加登入限制，建議改為 role-based gate（例如「未知 email 鎖在 `/pending-approval` 頁」）而不是 `signIn` callback return false 把人擋在 Google 端 — 後者會讓使用者看到 Google 的 AccessDenied 完全不知道是自家平台的事。

**備註**：專屬本專案的 RBAC 設計選擇，不列通用 ERROR_LOG。

---

### E9：Vercel auto-deploy "No Next.js version detected" —— monorepo 子目錄 rootDirectory 未設

**情境**：push 到 master 觸發 Vercel auto-deploy（接 GitHub 後）失敗：
```
Skipping build cache since Package Manager changed from "pnpm" to "npm"
Error: No Next.js version detected. Make sure your package.json has "next"
in either "dependencies" or "devDependencies". Also check your Root Directory
setting matches the directory of your package.json file.
```

**根因**：Vercel project 的 Root Directory 設定為 `.`（repo 根），但 Next.js 在 `web/` 子目錄。`vercel git connect` 不會把 CLI working directory 設為 rootDirectory，所以接完 GitHub 後 auto-deploy 預設在 repo root 跑 build，根目錄只有 Python pipeline 沒有 `package.json`。

之前 CLI `vercel deploy --prod --yes` 從 `web/` 跑都 OK，是因為 CLI 直接打包 local 檔案上傳、不讀 project 的 rootDirectory。

**修法**：
```bash
# 查 project id
vercel project inspect frc-annotation
# 讀 CLI auth token（Windows）
cat "$APPDATA/com.vercel.cli/Data/auth.json"
# PATCH rootDirectory
curl -X PATCH https://api.vercel.com/v9/projects/<已移除> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"web"}'
# 重跑失敗的 deploy
vercel redeploy <failed-deployment-url> --target production
```

**預防**：未來跑 `vercel git connect` 後，下一步固定做 `vercel project inspect <name>` 檢查 `rootDirectory` 欄位。monorepo 子目錄結構必 PATCH 設對，不要等 auto-deploy 壞掉才發現。

**備註**：
- 細節見 FINDINGS.md 發現 L（含完整 API 範例與 token 位置）
- 專屬本專案的 monorepo 結構（repo root = Python pipeline、`web/` = Next.js），不列通用 ERROR_LOG；但 "`vercel git connect` 不寫 rootDirectory" 這件事是 Vercel CLI 的通用行為，如果未來撞到類似情況可考慮補進 `~/.claude/ERROR_LOG.md`

---

## 2026-04-18 (第 7 次 session) auto pipeline 增量 import 期專案特有錯誤

### E27：Repack 重命名 sub-batch 時，per-batch-name skip 造成 data loss 或 duplicate

**情境**：import v1 跑 `隊友-1` 這個新 batch 時，把裡面 63+ 張圖傳進去，但這些 stem 早就在舊 `隊友` batch 裡。DB 結果：同一個 stem 出現在兩個 batch、owner duplicate 分派。v2 改用 batch name skip 後，又反過來把整個 `隊友-1` 整包 skip 掉 → 新增的 image 漏進。

**根因**：`repack_per_owner.py` 採 wipe + 全重建 + greedy bin-pack 策略。Owner 檔案變多時 greedy split 會把「原本 1 個 batch `foo`」重切為 `foo-1` + `foo-2`。Batch name 不是 stable identity、image stem 才是。Import 若以 batch name 當 skip / dedupe key，兩條路都錯：
- 「batch name 存在 → skip」：漏建新 batch 或漏 upload 新 image
- 「batch name 不存在 → 全 create」：既有 stem 被重傳一次 → duplicate

**修法**：`web/scripts/import-per-owner.ts` 開頭用 project-wide stem Set 當 skip key：
```ts
const globalExisting = await prisma.image.findMany({
  where: { projectId, batch: { projectId } },
  select: { blobPath: true },
});
const globalExistingFilenames = new Set(
  globalExisting.map((i) => stripExt(decodeURIComponent(path.basename(i.blobPath))))
);
// 之後每一張 upload 前：
if (globalExistingFilenames.has(stem)) skip();
```
Batch 仍以 name 做 findFirst + create，找得到就 append image、找不到就 create fresh；dedupe 粒度永遠是 stem。

**預防**：任何做增量 sync 的 script 都要先問「我的 stable identity 是什麼」。如果上游有 wipe+rebuild 策略（repack 就是），identity 一定不能是上游的容器 name，要下到最小原子單位（這 case 是 image stem）。

**備註**：專屬 repack_per_owner + import-per-owner 這條 pipeline；不列通用 ERROR_LOG，但「stable identity 要選對粒度」是通用教訓，FINDINGS.md 發現 PP 有完整論述。

---

### E28：Vercel Blob 把中文檔名 URL-encode，導致 cross-process stem-level skip 比對失敗

**情境**：E27 修法 v3 跑起來後，中文 owner（如 `隊友`）的 image 仍然每次 import 都當新的再傳一輪，只有 ASCII owner（英文名的隊友）正確 skip。Dry-run debug print 才發現兩邊 stem 根本不同字串。

**根因**：`vercel/blob` 的 `put({ pathname: '...隊友...' })` 回傳 url 是 `%E9%9A%8A%E5%8F%8B...`，儲存到 `Image.blobPath` 是 URL-encoded。但 zip entry name 是原生 UTF-8 中文。`path.basename(blobPath)` 拿到的 stem 是 `%E9%9A%8A%...__foo`、zip 側的 stem 是 `隊友__foo`，Set.has() 永遠 false。

**修法**：比對前先 `decodeURIComponent`：
```ts
const stem = stripExt(decodeURIComponent(path.basename(blobPath)));
```
ASCII-only owner 走 `decodeURIComponent` 是 no-op，不影響既有邏輯。

**預防**：
- 未來任何一處用 `blobPath` 跟「原生 filename」比對的地方都要 decode。grep `path.basename.*blobPath` 檢查其他 route 有沒有同樣陷阱
- Test fixture 刻意放一個非 ASCII filename（如 `測試__frame_0001.jpg`），否則這類坑只在 production 炸

**備註**：專屬本專案 + Vercel Blob put() 行為，不列通用 ERROR_LOG。FINDINGS.md 發現 QQ 有完整論述。

---

### E29：Neon pooled WebSocket 在長時間 bulk INSERT 下斷線

**情境**：import v4 跑 94 秒後 process exit，錯誤 `Error: Connection terminated unexpectedly`；v5 改 concurrency 4 重跑，33 秒後又掛。中間沒有明顯模式（不是固定筆數、不是固定 batch），純時間觸發。

**根因**：`DATABASE_URL` 預設走 Neon 的 pooler endpoint（`ep-xxx-pooler.neon.tech`）+ pgbouncer transaction mode + WebSocket，為 serverless short-lived request 設計。長駐 script 做大量 INSERT（上千筆）會撞到下列其中之一：pgbouncer 的 transaction-mode 連線時間上限、Neon 對 pooler WebSocket 的 idle timeout、或 WebSocket frame 累積上限。任何一個踩到，連線就 reset，Prisma adapter 沒有自動重連。

**修法**：import script 最前面（`lib/db` import **之前**）swap env：
```ts
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}
// 然後才 import('@/lib/db')
```
配合 concurrency 8 → 4 保險。v6 乾淨跑完 4909 張 image 沒再斷。

**預防**：
- Neon 官方建議：serverless → pooled；long-running / migration / batch job → unpooled。寫長駐 script 時預設走 unpooled
- `lib/db.ts` 內的 Prisma adapter 是 module load 時 snapshot env 的，swap 必須在 import 之前。用 dynamic import 也可
- 若 script 非常長（> 30 分鐘），還要考慮加 retry + exponential backoff 的 wrapper，但目前 unpooled 已撐過 4909 筆，暫無需要

**備註**：本專案特有（用 Neon + WebSocket adapter）；不列通用 ERROR_LOG，但「serverless DB 有 pooled/unpooled 兩 endpoint，長駐 script 要選對」是 Neon / Supabase / Vercel Postgres 通用模式，未來撞到類似情況可往 ERROR_LOG 搬。FINDINGS.md 發現 RR 有完整論述。

---

### E30：Import script 中斷後殘留 `state=unassigned` orphan image，重跑沒被收拾

**情境**：v3 跑到一半被 Ctrl+C 中斷。重跑 v4 時 dry-run check 顯示某些 batch 裡有 `state=unassigned` 的 image（應該全是 `assigned`），script 沒清掉這些 orphan。

**根因**：import 流程是「create Image with `state=unassigned` → ... → 最後 updateMany to `assigned`」。中斷發生在兩步之間時 orphan 永遠停在 unassigned。v3 原本的 updateMany scope 是「這一輪 create 出的 imageIds」：
```ts
await prisma.image.updateMany({
  where: { id: { in: imageIdsFromThisRun } },
  data: { state: 'assigned' },
});
```
這個 scope 完全無法 heal previous run 的 orphan。

**修法**：scope 改成 batchId-wide + state filter：
```ts
await prisma.image.updateMany({
  where: { batchId: batch.id, state: 'unassigned' },
  data: { state: 'assigned', assignedTo: ownerId, assignedAt: new Date() },
});
```
重跑 N 次結果一致（idempotent write），自動清掉 previous run 留下的 orphan。

**預防**：
- 長駐 script 的 recovery write 要設計成「以目標狀態為 where condition」，不以「這一輪生成的 id list」當 scope
- 另一個選擇是加 `createdAt >= runStart` 條件限縮，但目前 state machine 沒有其他合法 unassigned case，batch-wide updateMany 是最簡方案
- 若未來 state machine 擴增「reviewer 手動 unassign」之類 transition，要回來重新審視這個 where condition 會不會誤動到合法 unassigned

**備註**：本專案 state machine 特有，不列通用 ERROR_LOG。FINDINGS.md 發現 SS 有完整論述。
