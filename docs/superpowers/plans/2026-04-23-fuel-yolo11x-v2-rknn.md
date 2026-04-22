# Fuel yolo11x v2 + RKNN 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用最新 1342 張資料集重訓 fuel-only yolo11x、強化 online augmentation、產 RK3588 INT8 + FP16 兩版 RKNN 供機器人 A/B 實測

**Architecture:** 三 stage pipeline — (1) Colab notebook 訓練、(2) WSL airockchip export 重新匯出 3-tail ONNX、(3) rknn_model_zoo convert.py 各跑一輪 INT8/FP16。Session 16/17 的 WSL conda env `rknn`、既有 `_export_rknn_onnx.sh` / `_prepare_calib_and_convert.sh` / `_verify_rknn_vs_onnx.py` 完全重用，本次只新增 master driver + 擴充 convert 腳本支援 FP16。

**Tech Stack:** Ultralytics 8.3+ / PyTorch CUDA / Colab T4 / airockchip/ultralytics_yolo11 fork / rknn-toolkit2 2.3.2 / WSL2 Ubuntu + conda / bash

**參考文件:**
- Spec: `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md`
- 既有 WSL 腳本: `_export_rknn_onnx.sh` / `_prepare_calib_and_convert.sh` / `_verify_rknn_vs_onnx.py`（repo 根目錄、git untracked）
- Session 16 FINDINGS: `FINDINGS.md` CCC-1 ~ CCC-5
- Session 17 FINDINGS: `FINDINGS.md` CCC-6 ~ CCC-8

---

## File Structure（要新增 / 修改的檔案）

| 路徑 | 動作 | 責任 | 進 repo |
|---|---|---|---|
| `train_fuel_yolo11x_v2.ipynb` | 新增 | Colab 訓練 notebook，強化 augmentation | ✅ |
| `_prepare_calib_and_convert.sh` | 修改 | 改指向新 zip、拆 prepare + 產 INT8 + FP16 | ❌ (git untracked) |
| `_train_v2_to_rknn.sh` | 新增 | WSL master driver（串全部 stage 2/3） | ❌ (git untracked) |
| `PROGRESS.md` | 修改 | session 18 紀錄 | ✅ |
| `FINDINGS.md` | 可能修改 | 若有新發現才加 DDD-1 | ✅ |

**不動：**
- `_export_rknn_onnx.sh`（session 16 寫好、airockchip export 固定邏輯）
- `_verify_rknn_vs_onnx.py`（session 16 寫好、INT8 cos 驗證邏輯足用；FP16 驗證改看 convert.py build log 即可）
- `train_fuel_yolo11x.ipynb`（session 14 原版、保留作 fallback）
- `train_robot_model.py`（CLAUDE.md 明示絕對不動）

---

## Phase 1: Colab Notebook（Claude 寫、Claude commit）

### Task 1: Create `train_fuel_yolo11x_v2.ipynb`

**Files:**
- Create: `D:\FRC\frc-train-review\train_fuel_yolo11x_v2.ipynb`
- Base: `D:\FRC\frc-train-review\train_fuel_yolo11x.ipynb`（複製結構）

**做法：**複製現有 notebook 的 23 個 cell，改以下 5 處即可：

- [ ] **Step 1: 讀 base notebook（全部 23 cells）**

Read `D:\FRC\frc-train-review\train_fuel_yolo11x.ipynb` 全部內容（注意 notebook 約 200 行、要用 Read tool 不帶 limit 或 offset=0 + 足夠 limit 讀完整）。

- [ ] **Step 2: 準備 v2 notebook 內容（修 5 處）**

相對 base notebook，改這 5 個 cell：

| Cell | 原內容 | v2 改為 |
|---|---|---|
| cell-0 (markdown) | 標題 `v11x` | 加 `(v2, 1342 imgs, 強化 augmentation)` |
| cell-7 (params) | `ZIP_PATH = '.../FRC-2026-04-18-auto.zip'` | `ZIP_PATH = '/content/drive/MyDrive/frc-train/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip'` |
| cell-7 (params) | `RUN_NAME = 'frc_fuel_yolo11x'` | `RUN_NAME = 'frc_fuel_yolo11x_v2'` |
| cell-14 (markdown) | `1088 張` | `1342 張` |
| cell-15 (train) | 只傳基本參數 | 新增 augmentation 參數（見下） |

cell-15 新的 `model.train(...)` 呼叫：

```python
from ultralytics import YOLO

model = YOLO(MODEL)
results = model.train(
    data=str(data_yaml),
    epochs=EPOCHS,
    imgsz=IMGSZ,
    batch=BATCH,
    project=str(RUNS_DIR / 'detect'),
    name=RUN_NAME,
    exist_ok=True,
    device=0,
    patience=20,
    verbose=True,
    # 強化 online augmentation (spec §4.4)
    hsv_h=0.02,
    hsv_s=0.8,
    hsv_v=0.6,
    degrees=15,
    translate=0.2,
    scale=0.6,
    shear=3.0,
    perspective=0.0005,
    flipud=0.0,
    fliplr=0.5,
    mosaic=1.0,
    mixup=0.15,
    copy_paste=0.3,
)
```

- [ ] **Step 3: 寫 v2 notebook 檔案**

用 Write tool 寫完整的 `train_fuel_yolo11x_v2.ipynb`。確保 JSON structure 合法（Jupyter notebook schema）。

- [ ] **Step 4: 驗證 notebook 可解析（靜態）**

```bash
python -c "import json; d=json.load(open('/d/FRC/frc-train-review/train_fuel_yolo11x_v2.ipynb')); print(f'cells={len(d[\"cells\"])}, nbformat={d[\"nbformat\"]}')"
```

Expected: 印出 `cells=<N>, nbformat=4`（N 應該跟 base notebook 一樣、大約 23–24；若 parse 失敗會 raise JSONDecodeError）。

- [ ] **Step 5: Commit**

```bash
git add train_fuel_yolo11x_v2.ipynb
git commit -m "feat(train): add fuel yolo11x v2 notebook with strengthened augmentation

- Targets new 1342-image dataset (session 17 auto-export)
- Online augmentation: hsv_v=0.6 degrees=15 copy_paste=0.3 mixup=0.15
- Preserves session 14 base notebook for fallback
- Per spec 2026-04-23-fuel-yolo11x-v2-rknn-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: 使用者 Colab 訓練（HUMAN GATE，~3-4 小時）

### 🛑 HUMAN_GATE_1: 執行 Colab 訓練

**使用者要做的事（Claude 不能代勞）：**

1. **上傳 zip 到 Google Drive**
   - 把 `D:\FRC\frc-train-review\FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip`（1.15 GB）上傳到 Drive：
     `MyDrive/frc-train/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip`

2. **開 Colab 跑 notebook**
   - 開 `train_fuel_yolo11x_v2.ipynb`（GitHub 連 Colab，或手動上傳）
   - Runtime → Change runtime type → **T4 GPU**（免費版夠用 @ imgsz=640、batch=8）
   - Runtime → Run all
   - **保持瀏覽器開著**（免費 T4 idle disconnect）
   - 預估 3–4 小時

3. **前 5 epoch 監控 augmentation 是否過激**
   - 檢查 `/content/runs/detect/frc_fuel_yolo11x_v2/train_batch0.jpg`（Ultralytics 自動存）
   - 如果看到 loss 爆高（> 10）或 NaN、或 train_batch 圖太詭異（copy_paste 把 fuel 貼到奇怪位置），**手動中斷 + 降 augmentation 重跑**（具體降法見 spec §4.4 fallback）

4. **訓練結束後檢查驗收基準**
   - 看 `metrics.json` 或 notebook final print：
     - `mAP50 ≥ 0.90`（session 14 baseline 0.954）
     - `mAP50-95 ≥ 0.65`（session 14 baseline 0.746）
   - 若達標 → 繼續 Phase 3
   - 若未達標 → 停、回報 Claude 分析原因

5. **下載產物**
   - 從 Drive `MyDrive/frc-train/runs/frc_fuel_yolo11x_v2-<timestamp>/weights/best.pt` 下載到 `C:\Users\USER\Downloads\best_v2.pt`
   - 同時下載 `metrics.json`（方便 Claude 對照）

**使用者回報 Claude：**
- `metrics.json` 內容（貼上來即可）
- 確認 `best_v2.pt` 已在 `C:\Users\USER\Downloads\`

---

## Phase 3: WSL RKNN 轉換腳本（Claude 寫）

### Task 2: 修改 `_prepare_calib_and_convert.sh` 支援新 zip + 雙 dtype

**Files:**
- Modify: `D:\FRC\frc-train-review\_prepare_calib_and_convert.sh`
- Original (session 16) 只指向舊 zip、只產 INT8；v2 要指向新 zip、同時產 INT8 + FP16

- [ ] **Step 1: 讀原檔**

Read `D:\FRC\frc-train-review\_prepare_calib_and_convert.sh` 全部。

- [ ] **Step 2: 改 ZIP 路徑 + 目錄名（避免覆蓋 session 16 calib）**

用 Edit tool 改：

```bash
# 舊
ZIP=/mnt/d/FRC/frc-train-review/FRC-2026-04-18-auto--yolo-2026-04-19T16-03-52-656Z.zip
WORK=/home/rick/rknn-work
DS=$WORK/calib_images
```

```bash
# 新
ZIP=/mnt/d/FRC/frc-train-review/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip
WORK=/home/rick/rknn-work
DS=$WORK/calib_images_v2
CALIB_TXT=$WORK/calibration_v2.txt
```

對應的 `"$WORK/calibration.txt"` 全部改為 `"$CALIB_TXT"`（3 處），`"$DS"` 在內嵌 python 的路徑字串統一引用變數。

- [ ] **Step 3: 擴充 convert 段、產 INT8 + FP16 兩版**

原 section `=== [3] run convert.py ===` 只有一次 convert.py。改成：

```bash
echo ""
echo "=== [3a] convert INT8 (rk3588 i8) ==="
cd $HOME/rknn-work/rknn_model_zoo/examples/yolo11/python
python convert.py $WORK/best.onnx rk3588 i8 $WORK/best_v2_rk3588_int8.rknn 2>&1 | tee $WORK/convert_int8.log | tail -40

echo ""
echo "=== [3b] convert FP16 (rk3588 fp) ==="
# FP16 不需 calibration（DATASET_PATH ignored）
python convert.py $WORK/best.onnx rk3588 fp $WORK/best_v2_rk3588_fp16.rknn 2>&1 | tee $WORK/convert_fp16.log | tail -40

echo ""
echo "=== [4] outputs ==="
ls -la $WORK/best_v2_rk3588_*.rknn 2>&1

echo ""
echo "=== [5] FP16 build log op-fallback check ==="
# 若出現 'fallback' 或 'not support' 在 FP16 log 代表有 op 掉到 CPU 會慢
if grep -iE "fallback|not support" "$WORK/convert_fp16.log"; then
    echo "⚠️ FP16 有 op fallback，請回報 Claude"
else
    echo "✅ FP16 全圖 NPU path"
fi
```

- [ ] **Step 4: 語法檢查**

```bash
bash -n D:/FRC/frc-train-review/_prepare_calib_and_convert.sh
```

Expected: 無輸出（syntax OK）。

### Task 3: 新增 `_train_v2_to_rknn.sh` master driver

**Files:**
- Create: `D:\FRC\frc-train-review\_train_v2_to_rknn.sh`

這支 driver 把「匯入 best.pt → airockchip export → prepare cal + convert INT8/FP16 → simulator 驗證 → 複製到 Downloads」串起來。

- [ ] **Step 1: 寫 driver 內容**

```bash
#!/bin/bash
# master driver for session 18 v2 pipeline
# 先決條件：best_v2.pt 已存在 /mnt/c/Users/USER/Downloads/best_v2.pt
set -e
source $HOME/miniconda3/etc/profile.d/conda.sh
conda activate rknn
export TMPDIR=$HOME/tmp

WORK=/home/rick/rknn-work
REPO=/mnt/d/FRC/frc-train-review
SRC_PT=/mnt/c/Users/USER/Downloads/best_v2.pt

# 0. 預檢
if [ ! -f "$SRC_PT" ]; then
    echo "❌ $SRC_PT 不存在。請先從 Colab 下載 best.pt 並改名為 best_v2.pt"
    exit 1
fi

# 1. 備份 session 16 的 best.pt / best.onnx，放新模型進 WORK
echo "=== [0] backup session 16 artifacts and copy new best_v2.pt ==="
if [ -f "$WORK/best.pt" ] && [ ! -f "$WORK/best_v1_session16.pt" ]; then
    cp "$WORK/best.pt" "$WORK/best_v1_session16.pt"
    cp "$WORK/best.onnx" "$WORK/best_v1_session16.onnx" 2>/dev/null || true
    cp "$WORK/best.rknn" "$WORK/best_v1_session16_int8.rknn" 2>/dev/null || true
    echo "  backed up session 16 .pt/.onnx/.rknn"
fi
cp "$SRC_PT" "$WORK/best.pt"
echo "  copied new best_v2.pt -> $WORK/best.pt"

# 2. airockchip export → 3-tail ONNX (覆蓋 best.onnx)
echo ""
echo "=== [1] airockchip export (best.pt -> best.onnx) ==="
bash "$REPO/_export_rknn_onnx.sh"

# 3. prepare cal_v2 + convert INT8 + FP16
echo ""
echo "=== [2] prepare calib_v2 + convert INT8 + FP16 ==="
bash "$REPO/_prepare_calib_and_convert.sh"

# 4. simulator 驗證 (沿用 session 16 的腳本，驗 INT8 vs ONNX)
echo ""
echo "=== [3] simulator INT8 cos verification ==="
python "$REPO/_verify_rknn_vs_onnx.py" 2>&1 | tee $WORK/verify_v2.log

# 5. 複製兩版 rknn 到 Windows Downloads
echo ""
echo "=== [4] copy products to Windows Downloads ==="
cp "$WORK/best_v2_rk3588_int8.rknn" /mnt/c/Users/USER/Downloads/
cp "$WORK/best_v2_rk3588_fp16.rknn" /mnt/c/Users/USER/Downloads/
ls -la /mnt/c/Users/USER/Downloads/best_v2_rk3588_*.rknn

echo ""
echo "✅ 完成。產物："
echo "  C:\\Users\\USER\\Downloads\\best_v2_rk3588_int8.rknn"
echo "  C:\\Users\\USER\\Downloads\\best_v2_rk3588_fp16.rknn"
echo ""
echo "驗證 log: $WORK/verify_v2.log / convert_int8.log / convert_fp16.log"
```

- [ ] **Step 2: 語法檢查**

```bash
bash -n D:/FRC/frc-train-review/_train_v2_to_rknn.sh
```

Expected: 無輸出。

- [ ] **Step 3: 不 commit（_ 前綴 local-only、git 已 untrack）**

確認：
```bash
git status --short | grep _train_v2
```

Expected: `?? _train_v2_to_rknn.sh`（untracked，不進 repo）

---

## Phase 4: 使用者 WSL 執行（HUMAN GATE，~20 分鐘）

### 🛑 HUMAN_GATE_2: WSL 執行轉換

**前置條件：**
- Phase 2 通過，`C:\Users\USER\Downloads\best_v2.pt` 存在

**使用者要做的事：**

1. **開 WSL terminal，cd 到 repo 根**
   ```bash
   cd /mnt/d/FRC/frc-train-review
   ```

2. **執行 master driver**
   ```bash
   bash _train_v2_to_rknn.sh 2>&1 | tee session18_rknn.log
   ```
   預估時間 ~20 分鐘（airockchip export 2min、INT8 convert 10min、FP16 convert 1min、verify 2min、copy）

3. **檢查輸出驗收**

   - **Export OK**：看到 `~/rknn-work/best.onnx` 新產生（應 ~217 MB）
   - **INT8 convert OK**：看到 `best_v2_rk3588_int8.rknn`（應 ~62 MB）
   - **FP16 convert OK**：看到 `best_v2_rk3588_fp16.rknn`（應 ~120 MB）、FP16 build log 顯示 `✅ FP16 全圖 NPU path`
   - **Simulator cos 驗證**：`verify_v2.log` 末段（`[RKNN simulator INT8]` 段落）應該看到 9 個 output（`out[0]` ~ `out[8]`，3 scales × 3 outputs/scale）的 cos similarity：
     - **6 個**「class / score-sum」類 output：`cos > 0.99`（INT8 對分類 robust）
     - **3 個**「bbox DFL」類 output（session 16 CCC-5 記錄過哪幾個）：`cos 0.7 ~ 0.95`（DFL 對 INT8 敏感、這是正常範圍）
     - 若每個 output 都 > 0.99 反而要警覺（代表 simulator 沒真正跑 INT8）；若有 output 掉到 < 0.5 要回報
   - **最終 Downloads 兩個 .rknn 檔存在**

4. **回報 Claude**
   - 貼 `session18_rknn.log` 末段（~50 行）
   - 列出 `C:\Users\USER\Downloads\best_v2_rk3588_*.rknn` 兩檔大小

**失敗處置：**
- airockchip export 失敗 → 查 session 16 ERROR.md E34–E41
- INT8 bbox DFL cos < 0.7 → 可能 calibration 集不代表性；回報 Claude 決定是否切 `quantized_algorithm='mmse'`
- FP16 build log 有 fallback warning → 回報 Claude 分析哪些 op 掉到 CPU

---

## Phase 5: 收尾（Claude 做）

### Task 4: 更新 `PROGRESS.md` 新增 Session 18

**Files:**
- Modify: `D:\FRC\frc-train-review\PROGRESS.md`（line 1 標題之後、line 3 的 session 17 之前插入）

- [ ] **Step 1: 寫 session 18 entry（符合 PROGRESS.md 的 5-Question Reboot Check 格式）**

內容骨架（實際填入要等使用者回報 metrics 與板端實測前的準備）：

```markdown
## Session: 2026-04-23（第 18 次）

### 主題
Session 16/17 RKNN 部署完成後，使用者決定用最新 1342 張資料集重訓 fuel-only yolo11x、
直接上機器人測試。本次做完整 spec + plan + pipeline，經 brainstorming 確定四大設計點：
(a) fuel-only、(b) Ultralytics online augmentation（不是 offline）、
(c) Colab 免費 T4 + imgsz=640 + batch=8（鏡頭不支援 960）、(d) RKNN 產 INT8 + FP16 兩版供板上 A/B。
交付：`train_fuel_yolo11x_v2.ipynb` + WSL master driver `_train_v2_to_rknn.sh`
+ 擴充 `_prepare_calib_and_convert.sh` 支援新 zip 雙 dtype。

### 執行模式
brainstorming → writing-plans → subagent/inline execution。
Augmentation 強化：hsv_v=0.6、degrees=15、copy_paste=0.3、mixup=0.15；
flipud=0 保留（fuel 有重力方向）。WSL env / airockchip fork / rknn-toolkit2 2.3.2 全部沿用 session 16。

### 完成項目
1. **`train_fuel_yolo11x_v2.ipynb`** — Colab notebook（fuel-only、1342 張、50 epochs、T4、強化 augmentation）
2. **`_prepare_calib_and_convert.sh`（修改）** — 改指向新 zip、同時產 INT8 + FP16
3. **`_train_v2_to_rknn.sh`（新增）** — WSL master driver 串全 stage 2/3
4. **Spec**: `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md`
5. **Plan**: `docs/superpowers/plans/2026-04-23-fuel-yolo11x-v2-rknn.md`
6. **使用者產物**（若 Phase 2+4 都完成）:
   - `best_v2.pt` / `best_v2.onnx`（Colab）
   - `best_v2_rk3588_int8.rknn` + `best_v2_rk3588_fp16.rknn`（板上 A/B 用）
   - [貼 metrics.json mAP50/mAP50_95 實際數字]
   - [貼 simulator cos 驗證數字]

### 修改檔案
- 新增 `train_fuel_yolo11x_v2.ipynb`（repo）
- 新增 `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md`
- 新增 `docs/superpowers/plans/2026-04-23-fuel-yolo11x-v2-rknn.md`
- 修改 `_prepare_calib_and_convert.sh`（git untracked、local-only）
- 新增 `_train_v2_to_rknn.sh`（git untracked、local-only）
- 修改 `PROGRESS.md`（本 entry）

### 設計決策
（詳見 spec §4.4 / §5 與 plan Phase 說明，關鍵摘要：）
- **Online augmentation 而非 offline**：Ultralytics 內建參數就是 continuous sampling、每 epoch 都不同，等效 67,100 次不同變換；zero 磁碟成本、無 data leakage 風險
- **flipud=0**：fuel 有重力方向、上下翻會教錯先驗
- **copy_paste=0.3**：對 FRC 場景（每張 1~3 顆 fuel）能模擬場上堆積
- **Calibration 重抽（新 1342 張 → 200 張）**：讓 INT8 看到真實最新分佈
- **imgsz=640（不是 spec 原擬的 960）**：使用者鏡頭硬體限制

### Git commits（本次 session）
- [TBD] `feat(train): add fuel yolo11x v2 notebook with strengthened augmentation`
- [TBD] `docs: fuel yolo11x v2 + RKNN (INT8+FP16) design spec` (已 commit)
- [TBD] `docs: session 18 v2 pipeline implementation plan`
- [TBD] `docs: session 18 v2 RKNN complete`（最終結案）

### 下一步
1. **使用者板端實測**：兩版 .rknn 上機器人、同場景比 FPS + 遮擋偵測率 + OBJ_THRESH 建議值
2. **Session 17 遺留**：若 FP16 救回 session 17 INT8 偵不到的遮擋 fuel → 改用 FP16 為主；若兩版都差不多 → 確認是資料問題、走 session 15 主線累積 reject 反饋
3. **若量化策略要再優化**：試 `quantized_algorithm='mmse'` 或 hybrid quantization（session 17 CCC-6/CCC-8 備案）

### 阻礙
- Phase 2 / Phase 4 需使用者執行（Colab 3-4 hr、WSL 20 min），等待中
- 實機效能與量化精度需板端實測決定路線

### 5-Question Reboot Check
1. **做什麼?** 用最新 1342 張資料集重訓 fuel-only yolo11x、強化 augmentation、產 RK3588 INT8 + FP16 兩版 RKNN 上機器人。
2. **進度?** Spec + Plan + 三支腳本就緒；使用者執行中（Phase 2/4 human gate）。
3. **下一步?** 等使用者 Colab 跑完 → 下載 best_v2.pt → WSL 執行 driver → 回報結果。
4. **阻礙?** 使用者側執行阻塞（訓練 3-4 hr + WSL 轉換 20 min）。
5. **關鍵檔案?**
   - `train_fuel_yolo11x_v2.ipynb` — Colab 主 notebook
   - `_train_v2_to_rknn.sh` / `_prepare_calib_and_convert.sh` / `_export_rknn_onnx.sh` / `_verify_rknn_vs_onnx.py` — WSL 轉換腳本全套
   - `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md` — 設計決策
   - `docs/superpowers/plans/2026-04-23-fuel-yolo11x-v2-rknn.md` — 實作序列
   - `FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip` — 訓練資料（1342 張）

---

```

- [ ] **Step 2: 實際寫入（插在 line 3 之前）**

用 Edit tool，`old_string = "# frc-train-review - 進度追蹤\n\n## Session: 2026-04-22（第 17 次）"`，`new_string = "# frc-train-review - 進度追蹤\n\n## Session: 2026-04-23（第 18 次）\n\n...[上面完整 entry]...\n\n---\n\n## Session: 2026-04-22（第 17 次）"`。

注意：只在 Phase 4 完成、拿到使用者回報數字後才填完整。初次寫入可先放骨架 + 標 `[使用者實測回填]` placeholder，最終收尾時再補。

- [ ] **Step 3: Commit（最終收尾）**

```bash
git add train_fuel_yolo11x_v2.ipynb PROGRESS.md docs/superpowers/plans/2026-04-23-fuel-yolo11x-v2-rknn.md
git commit -m "docs: session 18 v2 RKNN complete (fuel-only yolo11x + INT8+FP16)

- Strengthened augmentation notebook ran in Colab
- WSL pipeline produces INT8 + FP16 RKNN for on-robot A/B
- mAP: [填入使用者回報] / simulator cos: [填入使用者回報]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5 (optional): 更新 FINDINGS.md

如果 Phase 2/4 過程中遇到**新技術發現**（非 session 16/17 已記錄的），加 DDD-1 條目。否則跳過。

典型會記的情境：
- copy_paste=0.3 對 FRC fuel 場景實測效果（mAP 提升幅度）
- mAP50 實際數值 vs session 14 baseline 的對比（如果 augmentation 有顯著影響）
- FP16 cos similarity 實測數值（補 session 17 缺的驗證數據）

若無新發現，此 task 跳過、直接結案。

---

## 最終驗收（Claude 確認、Phase 5 完成後）

- [ ] `train_fuel_yolo11x_v2.ipynb` 在 repo 且 git 已 commit
- [ ] `docs/superpowers/specs/...design.md` + `plans/...plan.md` 都在 repo 且 commit
- [ ] 使用者回報 mAP50 ≥ 0.90、mAP50-95 ≥ 0.65（spec §4.6 驗收基準）
- [ ] 使用者回報兩檔 `best_v2_rk3588_int8.rknn` + `best_v2_rk3588_fp16.rknn` 存在 Downloads
- [ ] 使用者回報 INT8 simulator cos 通過（class > 0.99、bbox DFL > 0.7）
- [ ] 使用者回報 FP16 build log 無 fallback warning
- [ ] PROGRESS.md session 18 entry 數字欄位都填了（不留 [使用者實測回填]）
- [ ] 最終結案 commit

---

## Quick Reference

### 產物路徑總表

| 產物 | 位置 |
|---|---|
| Colab 中間產物 | Drive `MyDrive/frc-train/runs/frc_fuel_yolo11x_v2-<ts>/` |
| `best_v2.pt` | `C:\Users\USER\Downloads\best_v2.pt` |
| `best_v2.onnx` | `C:\Users\USER\Downloads\best_v2.onnx`（備份） |
| WSL airockchip 中間產物 | `~/rknn-work/best.pt` / `best.onnx` / calib_images_v2/ |
| INT8 RKNN | `C:\Users\USER\Downloads\best_v2_rk3588_int8.rknn` |
| FP16 RKNN | `C:\Users\USER\Downloads\best_v2_rk3588_fp16.rknn` |
| 轉換 log | `~/rknn-work/convert_int8.log` / `convert_fp16.log` / `verify_v2.log` |

### 執行序列（人機分工）

```
[Claude]  Task 1      寫 Colab notebook
[Claude]  commit 1    feat(train): v2 notebook
  ↓
[USER]    HUMAN_GATE_1  Colab 訓練 3–4hr → best_v2.pt
  ↓
[Claude]  Task 2      改 _prepare_calib_and_convert.sh（新 zip + 雙 dtype）
[Claude]  Task 3      新寫 _train_v2_to_rknn.sh
  ↓
[USER]    HUMAN_GATE_2  WSL 執行 driver 20min → 兩檔 .rknn
  ↓
[Claude]  Task 4      更新 PROGRESS.md session 18 + 填實測數字
[Claude]  commit 2    docs: session 18 complete
  ↓
[USER]    板端實機測試 → 決定 session 19 走什麼路線
```
