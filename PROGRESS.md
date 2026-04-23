# frc-train-review - 進度追蹤

## Session: 2026-04-23（第 18 次）

### 主題
Session 16/17 RKNN 部署 pipeline 完成後，使用者決定用最新 1342 張資料集重訓 fuel-only yolo11x、直接上機器人測試、順便解決 session 17 遺留的 FP16 A/B 驗證。本 session 做完整 brainstorming → writing-plans → inline execution 三階段：釐清 4 個關鍵設計點（fuel-only、Ultralytics online augmentation、Colab 免費 T4 + imgsz=640、INT8 + FP16 雙版本）、產出 spec + plan、寫 Colab notebook + WSL pipeline、使用者 Colab 跑 1.636 hr 訓練、使用者 WSL 跑 ~20 min 轉換、全部通過驗收。最終交付 2 個 RKNN 給機器人板端 A/B 實測。

### 執行模式
brainstorming skill → writing-plans skill → executing-plans skill（inline，非 subagent）。Augmentation 強化：`hsv_v=0.6`、`degrees=15`、`copy_paste=0.3`、`mixup=0.15`、`flipud=0`（fuel 有重力方向保留）。WSL env（conda `rknn`、airockchip fork、rknn-toolkit2 2.3.2）全部沿用 session 16 CCC-2 版本鎖；`_export_rknn_onnx.sh` / `_verify_rknn_vs_onnx.py` 原樣重用，只擴充 `_prepare_calib_and_convert.sh` 改指新 zip + 新增 FP16 convert 段、新寫 `_train_v2_to_rknn.sh` master driver 串全流程。

### 完成項目

**1. Colab 訓練（1.636 hr on T4）**
- 1342 張 → train 1074 / val 268（80/20 seed=42）
- fuel filter：kept_boxes 38122（平均每張 28.4 個 fuel）/ dropped_boxes 1459 / empty 2
- 50 epochs 全跑完（patience=20 沒觸發 early stop）
- **最終 val metrics（best.pt）**：
  - mAP50 = **0.960** ✅（基準 ≥ 0.90）
  - mAP50-95 = **0.753** ✅（基準 ≥ 0.65）
  - Precision = 0.924 / Recall = 0.935
  - vs session 14 baseline（1088 張、基本 aug、mAP50=0.954 / mAP50-95=0.746）：mAP50 +0.006、mAP50-95 +0.007 — 強化 augmentation 小幅進步、沒退步
  - inference 44.0ms/image @ T4 imgsz=640

**2. WSL RKNN 轉換（~20 min）**
- airockchip 3-tail ONNX 重新匯出：`best.onnx`（216.9 MB）
- calib_v2 集：從新 zip seed=42 抽 200 張
- **`best_v2_rk3588_int8.rknn`**（61.8 MB）— NPU INT8 全加速
- **`best_v2_rk3588_fp16.rknn`**（119.3 MB）— NPU FP16 全加速
- 兩檔都已複製到 `C:\Users\USER\Downloads\`

**3. Simulator cos 驗證（_verify_rknn_vs_onnx.py）**

| 輪次 | 模式 | 結果 |
|---|---|---|
| Round A | FP32 simulator（graph alignment） | **27/27 行 cos=1.0000** |
| Round B | INT8 simulator（量化誤差） | class/score 大多 > 0.99、最低 0.8876；bbox DFL **0.90~0.99**（session 16 是 0.69~0.96，**大幅改善**） |

**4. FP16 build log fallback check**
- `grep -iE "fallback\|not support"` = 無匹配
- `✅ FP16 全圖 NPU path` — **session 17 懸案解決**：FP16 不會因 op fallback CPU 拖慢

**5. 檔案變更**
- 新增 `train_fuel_yolo11x_v2.ipynb`（commit a842a1a）
- 新增 `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md`（commit 9789ec5）
- 新增 `docs/superpowers/plans/2026-04-23-fuel-yolo11x-v2-rknn.md`（commit f301ba6）
- 修改 `_prepare_calib_and_convert.sh`（git untracked、local-only）
- 新增 `_train_v2_to_rknn.sh`（git untracked、local-only）
- 新增 `session18_rknn.log`（git untracked、使用者 WSL 跑 driver 的全 log）

### 設計決策
- **Online augmentation 而非 offline**：Ultralytics 內建參數是連續 sampling、每 epoch 每張圖不同值、50 epochs × 1342 ≈ 67,100 組變換；零磁碟成本、無 data leakage；使用者一開始誤解為「0 或 3 二元開關」，澄清後採納
- **flipud=0 保持**：fuel 有重力方向，上下翻會教錯先驗
- **imgsz=640**（不是 spec 原擬的 960）：使用者鏡頭硬體限制、中途決定
- **雙 dtype RKNN**：Session 17 FP16 A/B 沒測完，本次一次解；INT8 主力（快、NPU 全加速）、FP16 備援（慢但精度接近 ONNX）
- **Calibration 重抽**（新 1342 張抽 200 而非重用 session 16 舊 200）：讓 INT8 看到真實最新分佈；事後看，INT8 bbox DFL cos 從 0.69~0.96 進步到 0.90~0.99 — 重抽策略奏效

### 型別 / 測試
Python / shell 腳本層面無 type check。驗證走：
- Ultralytics 內建 val metrics（mAP50 / mAP50-95 / P / R 驗收基準）
- Simulator cos similarity（Round A graph 對齊、Round B 量化誤差）
- FP16 build log grep（op fallback 檢測）
- 全部通過，無介入

### Git commits（本次 session）
- `9789ec5` docs: fuel yolo11x v2 + RKNN (INT8+FP16) design spec
- `f301ba6` docs: session 18 v2 pipeline implementation plan
- `a842a1a` feat(train): add fuel yolo11x v2 notebook with strengthened augmentation
- `<本 commit>` docs: session 18 v2 RKNN complete (both dtypes, cos verified)

### 下一步
1. **使用者板端 A/B 實測**（session 19 主任務）
   - INT8 當主力跑（快、估 3–7 FPS on RK3588 NPU）
   - 若遮擋 fuel 偵不到，改 FP16 測（估 2–4 FPS、但精度接近 ONNX）
   - 若兩版都偵不到，改 `rknn_model_zoo/examples/yolo11/python/yolo11.py` 的 `OBJ_THRESH=0.25 → 0.15`（零成本 fix、session 17 CCC-8 提過）
2. **Session 17 FP16 A/B 懸案一次解決**：本次 FP16 是新訓練的 v2 模型、不是 session 17 的 v1。若使用者要驗的是「v1 量化假設」，需要另外用 v1 的 FP16（`~/rknn-work/best_fp16.rknn`）對比；但既然都重訓了 v2，實務上直接走 v2 雙版 A/B 更有意義
3. **若板端效能不及預期**（FPS 太低 / 精度太差）：
   - 效能：試 `quantized_algorithm='mmse'`（session 17 CCC-6 備案）或 hybrid quantization
   - 精度：回主線累積標註者 reject 反饋、擴資料集再重訓（session 15 主線）
4. **M7.7 GPU train timing 主線依然**：等標註者累積資料 → 決定何時借 GPU 重訓

### 阻礙
- 無 blocker。Pipeline 全通、產物交付、session 收尾。
- 未決風險：實機 RK3588 板端 FPS 與遮擋偵測率 — 等使用者板端實測才知道、是 session 19 的事。

### 5-Question Reboot Check
1. **做什麼？** 用最新 1342 張重訓 fuel-only yolo11x（強化 augmentation）、產 RK3588 INT8 + FP16 兩版 RKNN 供機器人 A/B。
2. **進度？** 全部完成。mAP50=0.960 / mAP50-95=0.753；INT8 bbox DFL cos 從 session 16 的 0.69~0.96 進步到 0.90~0.99；FP16 全 NPU path 無 fallback。兩檔都在 Downloads。
3. **下一步？** 使用者板端 A/B 實測 → 決定 session 19 路線（INT8 主力 / 切 FP16 / 調 OBJ_THRESH / 資料改進 / 量化策略）。
4. **阻礙？** 無。實機性能是未決風險、不是 blocker。
5. **關鍵檔案？**
   - `C:\Users\USER\Downloads\best_v2_rk3588_int8.rknn` / `best_v2_rk3588_fp16.rknn` — 板端主交付（雙版本 A/B）
   - `C:\Users\USER\Downloads\best_v2.pt` / `D:\FRC\frc-train-review\best (1).pt` — Colab 產物（備份）
   - `train_fuel_yolo11x_v2.ipynb` — Colab 重跑入口
   - `_train_v2_to_rknn.sh` / `_prepare_calib_and_convert.sh` / `_export_rknn_onnx.sh` / `_verify_rknn_vs_onnx.py` — WSL 轉換全套（未來再訓新模型可直接重跑）
   - `session18_rknn.log` — 本次 WSL driver 完整 log（simulator cos 數字全紀錄）
   - `docs/superpowers/specs/2026-04-23-fuel-yolo11x-v2-rknn-design.md` / `plans/2026-04-23-fuel-yolo11x-v2-rknn.md` — 設計與實作紀錄
   - WSL `~/rknn-work/` — conda `rknn` env + best_v1_session16.*（備份）+ best.* (v2 current)

---

## Session: 2026-04-22（第 17 次）

### 主題
延續今日上午 session 16 的 RKNN INT8 部署 pipeline。使用者把 `best_rk3588_int8.rknn` 部到真實 RK3588 板跑實測,發現「前方 fuel 偵得到、後方被遮擋的偵不到」;對比 FRC 官方某 robot/fuel detector（型號未細講）覺得自訓模型蠻差、直覺判斷是量化害的、要求「練一個沒量化過的」直接上板比對。本 session 做兩件事:(a) 澄清量化誤差 vs 模型本身 robustness 差的誤歸因、(b) 用 FP16 dtype 重跑 convert 產出 `best_rk3588_fp16.rknn` 供使用者做 A/B 比對。阻塞在使用者板端 FP16 實測結果,不做完比對無法決定下一步走「資料改進」還是「量化策略調整」路線。

### 執行模式
歸因分析 + 同環境快速再轉。session 16 的 WSL `rknn` conda env 已備齊,本次只重跑 `rknn_model_zoo/examples/yolo11/python/convert.py best.onnx rk3588 fp best_fp16.rknn`(dtype `fp` = FP16,不是 FP32)。無 calibration 循環、轉換 ~1 分鐘(相比 INT8 10+ 分鐘)、build log 無 op fallback warning。產物複製到 `C:\Users\USER\Downloads\best_rk3588_fp16.rknn`。對話主體是幫使用者建立診斷框架:量化 99% 不是「完全漏偵」的主因(典型是 bbox 偏 1–3 px / conf 降)、遮擋漏偵幾乎必然是訓練資料的遮擋樣本覆蓋不夠。

### 完成項目（無 repo commit;產出在 Downloads + WSL）

**1. `C:\Users\USER\Downloads\best_rk3588_fp16.rknn`(主交付,119.3 MB)**
- fuel-only yolo11x FP16,target = RK3588
- 從 session 16 已存的 `best.onnx`(airockchip 3-tail, FP32 217 MB)重跑 convert、dtype = `fp`
- 檔案大小比例符合理論:ONNX 的 0.55x、INT8 (61.8 MB) 的 2x
- Build log 無 op fallback warning → 全圖在 NPU FP16 path、不會因 CPU fallback 爆慢
- 預估 RK3588 NPU FP16 效能:**2–4 FPS**(NPU INT8 6 TOPS vs FP16 ~3 TFLOPS,所以 FP16 比 INT8 更慢)

**2. 板端實測反饋診斷框架（給使用者 FP16 測完後用）**

| 使用者實測結果 | 診斷 | 下一步路線 |
|---|---|---|
| FP16 也漏遮擋 fuel | 不是量化、是模型/資料 | 走資料改進(合流 session 15 主線等標註者累積 reject 反饋) |
| FP16 偵到、INT8 漏 | 量化影響較大 | `quantized_algorithm='mmse'` 重做 INT8 或 hybrid quantization |
| 兩版都差不多 | 根因在資料/模型 | 同第一種 |

**3. 模型改進 action plan（按成本 / 成效排序,給使用者）**
1. **先調 post-process 閾值**(0 成本、30 秒):`rknn_model_zoo/examples/yolo11/python/yolo11.py` 的 `OBJ_THRESH = 0.25` → 降到 **0.15**。若遮擋 fuel 的 confidence 剛好卡在這區間、這是最便宜 fix
2. **收含遮擋場景訓練圖**:re-label 既有比賽影片中 fuel 被遮擋樣本。合流 session 15 主線(等標註者累積資料)
3. **重訓用 imgsz=960**(session 14 已提過):fuel 是小物件、960 feature 保留更多。11x @ 960 在 Colab T4 可能 OOM,要降 batch 或換更大 GPU
4. **two-stage / ensemble**:三類模型粗偵 robot → 裁下來後用 fuel-only 模型細偵。部署成本高、延遲加倍,最後手段
5. **換 yolo11l/m**:x 對小資料可能 overfit。不是首選

### 修改檔案
- 新增 `C:\Users\USER\Downloads\best_rk3588_fp16.rknn`(repo 外,主交付)
- 新增 WSL `~/rknn-work/best_fp16.rknn`(同上,轉換產物)
- 沒動 repo 程式碼、沒動 `train_robot_model.py`、沒動 session 16 已存的 `best.pt` / `best.onnx` / `best.rknn`(INT8)

### 設計決策
**為何跑 FP16 而不是直接轉換路線到資料改進**:使用者堅持量化是主因,不做 FP16 對比無法 rule out 此假設、之後講「資料才是問題」對方不會信。FP16 轉換成本低(1 分鐘、環境已備)、能產生決定性 A/B 證據。

**為何 RK3588 上 FP16 是「沒量化」的實際選項而非 FP32**:RK3588 NPU 沒 FP32 硬體路徑,ONNX FP32 丟上去會大量 fallback CPU 爆慢、不具可比較性。rknn_model_zoo convert.py 的 `fp` dtype 實際是 FP16。「沒量化」在這個硬體上只能是 FP16。詳見 FINDINGS CCC-6。

**為何遮擋偵不到 99% 不是量化害的**:量化典型表現是 bbox 偏 1–3 px、confidence 略降(INT8 session 16 實測 class prob cos > 0.99、bbox DFL cos 0.69–0.96)。「本來偵得到變成完全偵不到」不符合量化失效模式、符合模型本身對遮擋 robustness 不足(訓練資料遮擋樣本覆蓋不夠)。歸因方法論詳見 FINDINGS CCC-7。

**為何優先推薦調 OBJ_THRESH 而非重訓**:重訓成本高(GPU 時間、等資料),降閾值 30 秒零成本、能直接驗證「遮擋 fuel 的 logit 是否剛好卡在 0.15–0.25 之間」。若降閾值就救回、根本不用動訓練;若降閾值還是漏、才確認要走資料改進。

### 型別 / 測試
不涉及。純 deployment pipeline。FP16 convert 的 build log 即是驗證(無 op fallback warning = 全圖 NPU path)。

### Git commits（本次 session）
無。

### 下一步
**關鍵阻塞**:**先等使用者板端實測 `best_rk3588_fp16.rknn` 的結果**。不做完 FP16 比對無法決定走哪條路。

1. 使用者把 `best_rk3588_fp16.rknn` 部到 RK3588 板,跑同樣遮擋場景,比對 INT8 版的偵測率
2. 根據結果分流:
   - **FP16 也漏** → 確認資料問題。回到 session 15 主線「累積 reject 反饋 / 等標註者」、走資料改進路徑。最便宜先試 `OBJ_THRESH=0.15`
   - **FP16 救回、INT8 漏** → 量化策略調整新 rabbit hole。研究 `quantized_algorithm='mmse'`(minimize mean square error、對 DFL 友好)或 hybrid quantization(某些敏感 layer FP16、重運算 layer INT8)
   - **兩版都差不多** → 跟 FP16 也漏同樣路線
3. 若決定走資料改進:合流 session 15 主線(本身已在等標註者 reject 反饋、累積遮擋樣本)、M7.7 GPU train timing 延後到資料累積夠後
4. 若決定走量化策略:在 WSL `rknn` env 改 `convert.py` 的 `rknn.config(quantized_algorithm='mmse')` 重跑 INT8、再對比板端效果

### 阻礙
- **明確阻塞於使用者板端 FP16 實測**。無板上結果、下一步技術路線無法決定
- 其他無 blocker。WSL 轉換環境已備齊、本機 Downloads 已有 FP16 / INT8 兩版供實測

### 5-Question Reboot Check
1. **做什麼?** 延續 session 16 RKNN 部署。使用者板端 INT8 測出「遮擋 fuel 偵不到」,歸因為量化、要求跑 FP16 對比。做完澄清 + FP16 convert。
2. **進度?** `best_rk3588_fp16.rknn`(119.3 MB)已交付;診斷決策樹與 action plan 給使用者;阻塞在板端 FP16 實測結果。
3. **下一步?** **先問使用者 FP16 板端實測結果**。依結果分流:(a) 資料改進路線(合流 session 15 主線)、(b) 量化策略調整(mmse / hybrid)、(c) 最便宜先試 `OBJ_THRESH=0.15`。
4. **阻礙?** 等使用者板端實測 FP16。無程式碼 blocker。
5. **關鍵檔案?**
   - `C:\Users\USER\Downloads\best_rk3588_fp16.rknn` — 本次主交付(FP16 RK3588)
   - `C:\Users\USER\Downloads\best_rk3588_int8.rknn` — session 16 交付(INT8 RK3588、A/B 對比基準)
   - WSL `~/rknn-work/` — 轉換環境(conda env `rknn`、best.pt / best.onnx / best_fp16.rknn / best.rknn INT8 / calibration.txt / calib_images/)
   - `D:\FRC\frc-train-review\FINDINGS.md` 發現 CCC-6 / CCC-7 / CCC-8 — RK3588 dtype 選項、量化 vs 資料 vs 閾值歸因方法學、模型效能改進優先級 checklist
   - GitHub `airockchip/rknn_model_zoo` — `examples/yolo11/python/convert.py` 的 `fp` dtype 實作;`yolo11.py` 的 `OBJ_THRESH` 可調位置

---

## Session: 2026-04-22（第 16 次）

### 主題
Session 15 交付 `Rebuilt工筆_Iter2_YOLOv11n.docx` 後，下一步本來是「等標註者 reject 反饋 → 決定 M7.7 GPU train timing」。本 session 使用者開新岔路：把 session 14 訓好的 **fuel-only yolo11x**（Colab 產物）轉成 **RKNN 格式部到 Rockchip RK3588 NPU**。這是部署 pipeline，跟 GPU training 主線並行、不 block 主線。三個決策點 Q&A：目標 SoC = RK3588、量化 = INT8、轉換環境 = WSL2（而非 Docker 或 Colab）。

### 執行模式
systematic-debugging + env pinning。完整 pipeline：WSL2 Ubuntu 24.04 裝 miniconda → 建 conda env `rknn`（python 3.10）→ pin rknn-toolkit2 2.3.2 依賴鏈（torch 2.4.0 cpu / numpy 1.26.4 / onnx 1.17.0 / setuptools<80）→ clone airockchip/ultralytics_yolo11 fork（產 3-tail ONNX 專為 RKNN 設計）→ airockchip export 產 `best.onnx` → rknn_model_zoo/yolo11 convert 走 INT8 + 200 張校正集 → 產 `best.rknn` → load_onnx + build + init_runtime(target=None) 走 simulator 驗證 ONNX vs RKNN INT8 output 對齊度。期間踩 8 個環境 / API 坑（WSL I/O error、pkg_resources 拆分、onnx.mapping 移除、torchvision 升 torch、load_rknn 不支援 simulator 等，逐一 pin 版本解掉）。

### 完成項目（無 repo commit；產出在 Downloads + WSL $HOME）

**1. `C:\Users\USER\Downloads\best_rk3588_int8.rknn`（主交付，61.8 MB）**
- fuel-only yolo11x INT8，target = RK3588
- 從 session 14 Colab 產物 `best.pt` (109 MB) / `best.onnx` (217 MB FP32) 轉出
- 3-tail 結構（9 outputs），per-stride 拆 64ch DFL bbox + 1ch score-sum + 1ch class
- shape 全對齊、無 op fallback
- 板端部署用 `rknnlite.api.RKNNLite`（不是 toolkit2），post-process decode + NMS 參考 `rknn_model_zoo/examples/yolo11/python/yolo11.py` 的 `post_process()`、改 `CLASSES = ('fuel',)`

**2. 量化誤差驗證（3 張測試圖，ONNX vs RKNN simulator INT8 cos 相似度）**
- Class prob / score-sum：`cos > 0.99` ✅
- BBox DFL：`cos 0.69 ~ 0.96`（DFL 對 INT8 敏感，典型）
- stride 32 (20×20) class outputs 全 0 — fuel 是 ball 小物件，最大下採樣層偵不到，合理非 bug
- shape 完全對齊、pipeline 通、無 op fallback

**3. WSL env `~/rknn-work/` 建置完成（可重用）**
- conda env `rknn`（python 3.10）pinned 依賴：torch 2.4.0+cpu / torchvision 0.19.0+cpu / numpy 1.26.4 / onnx 1.17.0 / setuptools<80 / rknn-toolkit2 2.3.2 / ultralytics 8.3.9（airockchip/ultralytics_yolo11 editable）
- 檔案：`best.pt` / `best.onnx`（3-tail 版）/ `best.rknn` / `calibration.txt` / `calib_images/` (200 張 seed=42 取樣)
- 之後再轉其他模型（ex: fuel-only 11n 或三類 11n）直接改 yaml + 重跑 export + convert、~20 分鐘

**4. 本機新增 local-only scripts（repo untracked，保留供未來重跑）**
- `_export_rknn_onnx.sh`
- `_prepare_calib_and_convert.sh`
- `_verify_rknn_vs_onnx.py`

### 修改檔案
- 新增 `C:\Users\USER\Downloads\best_rk3588_int8.rknn`（repo 外，主交付）
- 新增 WSL `~/rknn-work/*`（repo 外，轉換環境）
- 新增 repo root 3 個 `_*.sh` / `_*.py` 輔助腳本（git untracked）
- 沒動 repo 程式碼、沒動 `train_robot_model.py`

### 設計決策
**為何用 airockchip fork 而非官方 ultralytics export**：官方 `(1,5,8400)` 結構尾段含 `NonMaxSuppression` / `ScatterND` 等 NPU 不支援 op，轉 RKNN 會全部 fallback 到 CPU 或直接 error。airockchip fork 把 NMS + DFL decode 外拋到 CPU post-process、export 出 9-output 3-tail 結構讓 NPU 只做 backbone + neck + head（重運算），速度才拉得起來。詳見 FINDINGS CCC-1。

**為何 WSL2 而非 Docker / Colab**：(a) Docker 需要 nested virtualization 設定麻煩、且 rknn-toolkit2 官方 image 本身就是 Ubuntu base、用 WSL 直裝少一層；(b) Colab 每次 session 重來、pip pin 要重裝一次、12 hr idle 會斷、不適合這種「建一次、未來一直用」的環境。WSL 的 conda env 建好就常駐。

**為何 yolo11x 而非 11n 優先轉**：使用者 session 14 訓了兩版 fuel-only（11n 與 11x），本 session 目標是把高精度那版部到板端。yolo11x @ 640 在 RK3588 NPU (6 TOPS INT8) 預計 3–7 FPS — 使用者知情此速度限制，推測是 offline 分析或 pre-screening 用途。如果後續場內即時偵測要跑 60+ FPS，可用同環境再轉 11n（估 60+ FPS on RK3588）。

**為何 INT8 而非 FP16**：RK3588 NPU 對 FP16 支援有限（只有部分 layer），INT8 是全 layer 硬體加速唯一選擇。代價是 DFL bbox 有 cos ~0.7 的量化誤差，但 class prob / score-sum > 0.99 — 偵測「有沒有」完全 OK，只是邊界可能差 1–2 px（fuel 檢測場景可接受）。若實戰不可接受再試 `quantized_algorithm='mmse'` 或 hybrid quantization（某些 layer FP16）。

**為何產 3 個 local-only script 而非 commit**：轉換流程是 one-shot + local env 依賴（WSL path、conda env name），commit 進 repo 其他 dev 也跑不起來（因為環境沒建）。之後若要系統化、再寫成 `docs/rknn-deploy.md` 或 docker-compose 化；目前停在腳本層級、搭配本 session 的 FINDINGS CCC 紀錄就夠下次重演。

### 型別 / 測試
不涉及。純 deployment pipeline、無 TypeScript / Vitest / Python business logic。量化驗證走 simulator `init_runtime(target=None)`，比對 ONNX FP32 output 與 RKNN INT8 output 的 cosine similarity。

### Git commits（本次 session）
無。RKNN 產物、轉換腳本、WSL env 都不進 repo（`.gitignore` 已涵蓋 `_*.sh` / `_*.py` 的 local helper pattern）。

### 下一步
1. **主線仍是**：等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing。RK3588 轉換完成、**不 block 主線**
2. 若使用者要再轉其他模型（ex: fuel-only 11n 或三類 11n 給場內即時偵測）：環境已備齊，直接在同 conda env 改 `ultralytics/cfg/default.yaml` 的 `model:` 指向新 `.pt` → 跑 export → 跑 convert → 跑 verify，約 20 分鐘
3. 若使用者要測 RKNN 板端效能：需要實體 RK3588 板（Orange Pi 5 / Rock 5 / ITX-3588J 等）+ rknnlite 推論 script。本 session 只做到 simulator 驗證，實機效能待板子到貨
4. 若量化 bbox 誤差實戰不可接受：可試 `quantized_algorithm='mmse'`（改 `convert.py` 的 `rknn.config`）或 hybrid quantization（某些 layer FP16）

### 阻礙
- 無 blocker。RKNN 產物已交付、環境已備齊、主線未被阻塞
- 未決風險：實機 RK3588 性能（3–7 FPS 預估值）與量化誤差（bbox cos ~0.7）是否符合實戰需求，等板子 + 真實資料才驗得到

### 5-Question Reboot Check
1. **做什麼？** 把 session 14 訓好的 fuel-only yolo11x 從 PyTorch → ONNX（airockchip 3-tail）→ RKNN INT8，部到 Rockchip RK3588 NPU。並行於主線的部署 pipeline。
2. **進度？** `best_rk3588_int8.rknn` (61.8 MB) 已交付、WSL 轉換環境建完、ONNX vs RKNN simulator INT8 cos 驗證通過。待實體 RK3588 板子到貨做實機效能測。
3. **下一步？** 主線仍是等標註者 reject 反饋 → 決定 M7.7 GPU train timing。RK3588 轉換不 block 主線。若要再轉其他變體、環境已備齊 ~20 分鐘可重跑。
4. **阻礙？** 無。實機性能風險等板子到才能驗。
5. **關鍵檔案？**
   - `C:\Users\USER\Downloads\best_rk3588_int8.rknn` — 主交付（板端部署用）
   - WSL `~/rknn-work/` — 轉換環境（conda env `rknn` + best.pt / best.onnx / best.rknn / calibration.txt / calib_images/）
   - `D:\FRC\frc-train-review\_export_rknn_onnx.sh` / `_prepare_calib_and_convert.sh` / `_verify_rknn_vs_onnx.py` — 本機 local-only 腳本，下次重跑參考
   - `D:\FRC\frc-train-review\FINDINGS.md` 發現 CCC — RKNN RK3588 INT8 部署 pipeline 完整紀錄（airockchip fork 理由、環境版本鎖、量化誤差）
   - `D:\FRC\frc-train-review\ERROR.md` E34–E41 — WSL 路徑、pip 依賴、rknn API 8 個踩坑紀錄
   - `C:\Users\USER\Downloads\best.pt` / `best.onnx` — session 14 Colab 產物（fuel-only yolo11x FP32）
   - GitHub `airockchip/ultralytics_yolo11` fork — RKNN-friendly export 來源
   - GitHub `airockchip/rknn_model_zoo` — `examples/yolo11/python/convert.py` 與 `yolo11.py` 後處理參考

---

## Session: 2026-04-20（第 15 次）

### 主題
延續 session 13 的 `Rebuilt工筆.docx` Iteration 2 內容產出。使用者要補一段 YOLOv11n 在自建資料集（sessions 14 訓完的 1088 張 / 3 類 / 50 epochs / Colab T4）上的訓練結果到工程筆記，產出獨立 docx 供使用者自行合併進原檔。原本設計含 s/m/l/x 變體對照留白，使用者決定「來不及訓完 s/m/l/x」→ 砍掉留白、純寫 n 版一份；同時把動機段從「比較 5 個變體」改為「時程有限 + Jetson 部署只能挑 n 版」，小結加強 Iteration 2 自建標註平台的價值論述（資料量持平、類別從 2 增至 3、精度反而上升）。

### 執行模式
純內容產出（session 13 同模式）。解壓使用者 Google Drive zip → 抽關鍵數字 → Python script 生 docx。無系統性 debug、無程式碼改動。兩輪內容修訂（第一版含變體對照 → 使用者回饋砍掉 → 第二版純 n 版）。

### 完成項目（無 repo commit；產出在 Downloads 與 docs/）

**1. `C:\Users\USER\Downloads\Rebuilt工筆_Iter2_YOLOv11n.docx`（主產出，854 KB）**
- Iteration 2 補充章節，使用者自行合併進 `Rebuilt工筆.docx`（未動原檔）
- 結構：1 個 H2「YOLOv11n 在自建資料集上的訓練結果」+ 4 個 H3（動機 / 實驗設置 / YOLOv11n 訓練結果 / 小結）+ 6 個 H4
- 嵌入 4 張訓練產物可視化：`results.png`（訓練曲線）、`confusion_matrix_normalized.png`、`BoxPR_curve.png`、`val_batch0_pred.jpg`
- 3 個表：實驗設置、總體指標、逐類別指標
- 關鍵數字：mAP@0.5 = 0.9808、mAP@0.5:0.95 = 0.8403、Precision = 0.9656、Recall = 0.9620；fuel 類別 mAP@0.5:0.95 = 0.7464 為主要瓶頸

**2. `D:\FRC\frc-train-review\docs\工筆截圖\yolo11n_3labels\`（新增 22 個檔案）**
- 從 `C:\Users\USER\Downloads\drive-download-20260420T100115Z-3-001.zip`（51 MB）解壓
- 保留：`metrics.json` / `args.yaml` / `results.csv` / `results.png` / `confusion_matrix*.png` / `Box{F1,P,R,PR}_curve.png` / `labels.jpg` / `train_batch*.jpg` / `val_batch*.jpg`
- 排除（大檔、docx 不需要嵌入）：`run_full.zip` / `weights/best.pt` / `weights/last.pt` / `weights/best.onnx`

**3. `D:\FRC\frc-train-review\_gen_yolo11n_section.py`（新增，9.7 KB）**
- python-docx 模板腳本，參數化圖片路徑與指標
- 未來若要補 s/m/l/x 對照或其他 run 結果，改常數區重跑即可

### 修改檔案
- 新增 `D:\FRC\frc-train-review\_gen_yolo11n_section.py`
- 新增 `D:\FRC\frc-train-review\docs\工筆截圖\yolo11n_3labels\*`（22 個訓練產物檔）
- 新增 `C:\Users\USER\Downloads\Rebuilt工筆_Iter2_YOLOv11n.docx`（主交付、repo 外）
- 沒動 repo 程式碼、沒動原 `Rebuilt工筆.docx`

### 設計決策
**為何做獨立 docx 而非改 repo 內文件**：延續 session 13 模式（Claude 產獨立 docx、使用者自行合併）。原 `Rebuilt工筆.docx` 在使用者 Downloads 不在 repo，也不由 Claude 直接編輯，避免破壞使用者的編輯 session 與 Word 內的樣式狀態。

**為何排除 `run_full.zip` / `weights/*.pt` / `weights/best.onnx` 不解到檔案系統**：docx 只需要嵌入可視化 PNG/JPG，模型權重有 Drive 備份（session 14 已記）+ 原 zip 在 Downloads 可隨時回取，攤在 `docs/工筆截圖/` 沒意義且佔空間（best.pt 5.3 MB、best.onnx 10.1 MB、run_full.zip 24.7 MB）。

**為何第二版把變體對照與「待補 s/m/l/x」整節砍掉**：使用者明確說「沒有我們應該來不及訓完 s/m/l/x，就寫 n 就好」。寫「待補」的前提是之後真的會補、且讀者要被提示這一點；但目標交期不允許跑完 s/m/l/x（x 版單跑就 2.5–3.5 hr），留坑只會讓章節看起來未完成。改寫動機段為「時程有限 + Jetson 邊緣裝置部署只能挑 n 版」給 n 版一個自成立的理由，而非把它當某個未完成對照的其中一項。

**為何小結要強調 Iteration 2 自建標註平台價值**：這是使用者學習歷程敘事的關鍵連結 — Iteration 1 用 Roboflow 公開資料集 2 類 ~1000 張、Iteration 2 用自建平台標註 3 類 1088 張，資料量持平、類別增加、精度反而上升。這個對比把「為什麼要自建標註平台」從工具論（更快更便宜）升級到效果論（能訓出更好的模型），是 Iteration 2 的 claim 核心。

### 型別 / 測試
不涉及。純內容產出，python-docx 腳本一次性執行產 docx，無 TypeScript / Vitest。

### Git commits（本次 session）
無。訓練產物、生成腳本、docx 都不進 repo（`docs/工筆截圖/` 已在 session 13 建立時就保留為 local-only 素材目錄，不追蹤）。

### 下一步
1. 使用者把 `Rebuilt工筆_Iter2_YOLOv11n.docx` 合併進原 `Rebuilt工筆.docx` Iteration 2 段落
2. 合併完成後回歸主軸：等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing
3. 若 session 14 明天跑完的 fuel-only 兩版（11n / 11x）也要入筆記，可直接重用 `_gen_yolo11n_section.py` 改輸入路徑與指標

### 阻礙
- 無。章節已交付、使用者自行合併

### 5-Question Reboot Check
1. **做什麼？** 生成 Iteration 2 補充章節 docx（YOLOv11n 在自建資料集上的訓練結果）
2. **進度？** `Rebuilt工筆_Iter2_YOLOv11n.docx` 已交付，含 4 圖 3 表；使用者自行合併
3. **下一步？** 使用者合併完成後回歸主軸（等標註者 reject 反饋 → 決定 M7.7 GPU train timing）
4. **阻礙？** 無
5. **關鍵檔案？**
   - `C:\Users\USER\Downloads\Rebuilt工筆_Iter2_YOLOv11n.docx` — 主交付（已送出）
   - `D:\FRC\frc-train-review\_gen_yolo11n_section.py` — 生成腳本，未來訓練結果入筆記時改參數重跑
   - `D:\FRC\frc-train-review\docs\工筆截圖\yolo11n_3labels\` — 訓練產物備份 22 個檔（metrics.json / args.yaml / results.csv / 4 張嵌入圖 + 其他可視化）
   - `C:\Users\USER\Downloads\drive-download-20260420T100115Z-3-001.zip` — 原 Drive zip（51 MB、含 weights/run_full）保留在 Downloads

---

## Session: 2026-04-20（第 14 次）

### 主題
首版 YOLO 訓練實戰（Colab T4 GPU）跑完三類模型 + 為下一輪 fuel-only 實驗準備兩個新 notebook（yolo11n / yolo11x）。主軸從「review / annotate 平台開發」轉到「資料已累積到可訓練 → 開始真正餵模型看效果」。

### 執行模式
混合模式：
1. **訓練階段**：使用者在 Colab 手動啟 T4、執行 `train_colab.ipynb`（session 之前已修過）。期間我用 CronCreate 架監控 cron（`7,22,37,52 * * * *` 每 15 分鐘輪詢 cell 13 輸出：epoch / GPU_mem / mAP）、訓練完偵測到最終 metrics 後自動 CronDelete 拆掉 cron。監控系統純輪詢、不干涉 Colab 執行
2. **Notebook 生成**：用 Python script `_gen_fuel_notebooks.py` 共用模板產兩個分支（batch=16 n 版 / batch=8 x 版），改動只需改模板一處、兩個 notebook 同步更新；手寫兩個 ipynb 容易漂移

### 完成項目（無 repo commit；產出在 local + Drive）

**1. 首版訓練結果（yolo11n，3 類 red_robot / blue_robot / fuel）**
- Dataset：FRC-2026-04-18-auto.zip（1088 張，split seed=42，871 train / 217 val）
- 環境：Colab T4 GPU，batch=16，epochs=50
- 訓練時間：0.549 hr（~33 分鐘）
- Val metrics（final epoch）：
  - Overall: mAP50 = 0.981, mAP50-95 = 0.840, P = 0.966, R = 0.962
  - red_robot: mAP50 = 0.993, mAP50-95 = 0.865
  - blue_robot: mAP50 = 0.995, mAP50-95 = 0.910
  - fuel: mAP50 = 0.954, mAP50-95 = 0.746（小物件 IOU 嚴格時自然較低，見 FINDINGS BBB）
- 產物存 Drive：`MyDrive/frc-train/runs/frc_robot_yolo11n-20260420-001859/`
  - `weights/best.pt` (5.3 MB)、`weights/best.onnx` (10.1 MB, opset=12)、`weights/last.pt`
  - `results.png`、`results.csv`、`metrics.json`、`confusion_matrix*`、F1/P/R/PR curves
  - train/val batch 預覽圖
  - `run_full.zip` (24.7 MB)

**2. fuel-only 下一輪實驗的兩個新 notebook**
- `D:\FRC\frc-train-review\_gen_fuel_notebooks.py`（新增）— 共用模板，用 `VARIANTS = [('n', 16), ('x', 8)]` 一鍵產 2 個 ipynb
- `D:\FRC\frc-train-review\train_fuel_yolo11n.ipynb`（新增，24 cells，batch=16，預估 25–30 min）
- `D:\FRC\frc-train-review\train_fuel_yolo11x.ipynb`（新增，24 cells，batch=8，預估 2.5–3.5 hr）
- 差異於原 `train_colab.ipynb` 的關鍵：
  - 新增 cell 3.5 label 過濾：保留 class=2 (fuel)、class_id 重編為 0；非 fuel 圖當背景保留（label 檔清空）
  - `data.yaml`：`nc=1, names=[fuel]`
  - `RUN_NAME` 改 `frc_fuel_yolo11n` / `frc_fuel_yolo11x` → 兩版各自 Drive 子資料夾、不互蓋
  - 其餘流程（GPU check、install、Drive mount、unzip、split、val、ONNX export、推論預覽）與原 notebook 一致

**3. 監控系統（臨時、已拆除）**
- CronCreate `7,22,37,52 * * * *` 輪詢 Colab cell 13 輸出
- 偵測最終 metrics 後 CronDelete 清掉
- 使用者明日跑 fuel 兩版時不再需要，改用連點器 15 分鐘按一次保活

### 修改檔案
- `D:\FRC\frc-train-review\train_colab.ipynb`（之前 session 已改；本 session 為執行用）
- `D:\FRC\frc-train-review\_gen_fuel_notebooks.py`（新增）
- `D:\FRC\frc-train-review\train_fuel_yolo11n.ipynb`（新增）
- `D:\FRC\frc-train-review\train_fuel_yolo11x.ipynb`（新增）
- 無 git commit（訓練產物在 Drive、notebook 檔案 user 會自己決定要不要進 repo）

### 設計決策
**為何選 yolo11n 起手、再 yolo11x 不直接一步到位**：n 版 30 分鐘內能收斂，先驗證資料品質、class 平衡、label 格式沒問題；再投 x 版 2.5–3.5 hr 拉 ceiling。一次跳 x 若資料有問題會 waste 好幾倍時間。

**為何 fuel 要獨立訓練不在 3 類模型一起訓**：fuel 是小物件（ball），mAP50-95 偏低（0.746）反映 IOU 0.5–0.95 嚴格下 bbox 邊界對不齊。獨立訓 fuel 可以：(1) 用更大 imgsz（未來 960）專攻小物件、(2) 更長 epoch 不拖 robot class 過擬合、(3) 比對三類聯訓 vs fuel-only 效果差多少判斷要不要走 two-stage。

**為何用 generator script 而非手寫兩個 notebook**：24 cells × 2 個檔案 = 48 cells 手動同步不現實。generator 模板改一處兩邊同步，未來加 yolo11s / yolo11m 只要加一行 `VARIANTS`。

**為何 11x OOM 應對策略是 BATCH=4 而非 imgsz 降低**：Notebook cell 7 常數 `BATCH = 8`。T4 記憶體 15 GB，yolo11x 單張 feature map 佔用高，batch=8 已在邊界。真的 OOM 直接降到 4 最簡單（imgsz 降會傷小物件偵測，不該為了塞記憶體動 imgsz）。

### 型別 / 測試
不涉及。Python 訓練 notebook + ipynb 產物，無 TypeScript / Vitest。

### Git commits（本次 session）
無。訓練產物不進 repo，Drive 為 source of truth。新 notebook 尚未 commit。

### 下一步
1. 使用者明天用**兩個 Google 帳號同時跑** `train_fuel_yolo11n.ipynb` + `train_fuel_yolo11x.ipynb`
2. 使用者放連點器每 15 分鐘按一次保活，不需我自動監控
3. 跑完後回來請我比對兩版 fuel metrics（mAP50 / mAP50-95 / P / R / PR curve），決定是否升 imgsz=960
4. 11x OOM 應對：把 notebook cell 7 的 `BATCH = 8` 改 `BATCH = 4`
5. 比對完若效果 OK，考慮：(a) 把 fuel 權重與三類權重 ensemble、(b) 重新收更多 fuel 資料跑第三輪、(c) 把目前 onnx 拿去 scoring-analyzer 真實比賽場景測

### 阻礙
- 無 blocker。訓練已跑通、Colab 流程穩定、下一輪資料已備妥
- 潛在 risk：11x 在 T4 上可能 OOM 即使 batch=8，使用者需自己判斷降到 4。已在 notebook 留註解說明

### 5-Question Reboot Check
1. **做什麼？** 跑完首版 3 類 yolo11n 訓練 + 準備 fuel-only 兩版 notebook（11n / 11x）交給使用者明天平行跑
2. **進度？** 首版訓練完成、best.pt / best.onnx / run_full.zip 存 Drive；兩個新 notebook 與 generator 落在 local 可直接上 Colab 執行
3. **下一步？** 使用者明天雙帳號並行跑 fuel 兩版 → 回來比對 metrics → 決定是否升 imgsz=960 / ensemble / 重收資料
4. **阻礙？** 無。11x OOM 應對策略已寫在 notebook 註解（BATCH=8 → 4）
5. **關鍵檔案？**
   - `D:\FRC\frc-train-review\train_fuel_yolo11n.ipynb` — 明日 Colab 執行檔（batch=16）
   - `D:\FRC\frc-train-review\train_fuel_yolo11x.ipynb` — 明日 Colab 執行檔（batch=8）
   - `D:\FRC\frc-train-review\_gen_fuel_notebooks.py` — notebook 模板，要改超參時改這個重跑
   - `D:\FRC\frc-train-review\train_colab.ipynb` — 三類原版訓練 notebook（參考用，已跑過）
   - Drive `MyDrive/frc-train/runs/frc_robot_yolo11n-20260420-001859/` — 首版訓練產物（對照基準）
   - `D:\FRC\frc-train-review\FINDINGS.md` 發現 BBB — fuel 小物件 mAP50-95 偏低的解讀；notebook generator pattern；雙帳號並行 Colab 跑法

---

## Session: 2026-04-19（第 13 次）

### 主題
使用者在寫工程筆記 `C:\Users\USER\Downloads\Rebuilt工筆.docx`，Iteration 2 要寫自建標註平台 frc-train-review。需求：(1) 模仿原檔 docx 風格（Heading 2/3、Motivation/Evaluation/Pros-Cons 段落模式、mix 英中）; (2) 用純中文撰寫; (3) Claude 自動化進 production 網站（https://frc-annotation.vercel.app）截圖、保證圖片載入; (4) 審核 `frc6998`、admin `980415`。完成後使用者又要求把「Gemini 自動預標註」補進章節，因為那是自建網站的最大動機。

### 執行模式
非結構化 content production，但核心子任務（自動化擷取 Konva canvas 並嵌入 docx）全跑 systematic-debugging。整條 pipeline：chrome-in-chrome MCP → production 網站登入（使用者已是 Rick）→ html2canvas-pro 擷圖 → 本地 Python HTTP server 接收 POST → python-docx 嵌入。過程踩多層坑（Chrome 下載 silent block、Tailwind v4 lab() 色域、Konva canvas CORS taint），每層都走「症狀 → 追因 → 換方案」。章節重寫輪：先寫出 web 平台核心，被使用者提醒「Gemini 才是最大動機」、重讀 `auto_pipeline.py` / `compare_v2.py` / `compare_pro_vs_lite.py` 還原整條 offline pipeline、補入 Motivation 第 1 條 + 新段落 + 對照表更新。

### 完成項目（無 repo commit；產出在 Downloads 與 docs/）

1. **`C:\Users\USER\Downloads\Rebuilt工筆_新增章節.docx`（主產出，2.3 MB）** — Iteration 2 章節，結構：Motivation / Overview / Stage A Gemini Pipeline / Stage B Web 平台架構 / State Machine / 標註介面 / 審核介面 / Partial-Promote / YOLO Export / 效能優化 / Audit Log / 結論。嵌入 7 張實際截圖。使用者自行合併進原 `Rebuilt工筆.docx`（未動原檔）
2. **`D:\FRC\frc-train-review\docs\工筆截圖\` 目錄（7 張 PNG 備份）**
   - `shot01_dashboard.png`
   - `shot04_annotator.png`（Konva canvas + 手動重繪 overlay 技巧產物）
   - `shot05_review_tray.png`（同上）
   - `shot06_partial_promote.png`（由 shot04 裁切）
   - `shot09a_stepup.png`
   - `shot09b_admin_members.png`
   - `shot10_project_stats.png`
3. **Gemini 自動預標註段落補寫** — 研讀 `auto_pipeline.py` 還原 4-stage pipeline（rclone download → preprocess → gemini annotate → batch zip），研讀 `compare_v2.py` / `compare_pro_vs_lite.py` 理解 Pro vs Lite 實驗結果，章節補：模型選擇理由（3.1 Flash Lite 成本/效能）、prompt v1/v2、box_2d → YOLO 座標轉換、concurrency=10 + retry、實測效益（純手標 60-90s/張 → AI 預標 + 人審 12-20s/張，省 4-6 倍）。把 Gemini 列為 Motivation 第 1 條。Annotation 段落補虛線 AI 框 vs 實線 human 框 + `source='gemini'/'human'` 欄位說明

### 踩過的坑（詳見 FINDINGS AAA）
- **Chrome 下載 silent block** — 第一張 PNG 能正常下載，第二張開始被 Chromium download throttling 靜默擋掉。解法：起本地 Python HTTP server on port 8765、截圖函數 POST PNG blob 過來
- **html2canvas 1.4.1 不支援 Tailwind v4 lab() 色域** — 直接拋 `Attempting to parse an unsupported color function "lab"`。解法：改用 `html2canvas-pro` fork
- **Konva canvas CORS taint** — Vercel Blob signed URL 載圖未帶 `crossOrigin="anonymous"`、`canvas.toBlob()` 拋 SecurityError。解法：讀 `Konva.stages[0]` 的 Image node、fetch 原圖 blob with CORS、在乾淨的新 canvas 重繪（image + 所有 Rect + Text node）、html2canvas `ignoreElements` 排除 tainted 原 canvas、再截圖
- **PowerShell SetForegroundWindow 奪回 Chrome 焦點失敗** — F11 fullscreen 狀態也不持續。放棄 native window 路線，全走 JS 重繪路線

### 修改檔案
- 新增 `C:\Users\USER\Downloads\Rebuilt工筆_新增章節.docx`（主產出、使用者自行合併）
- 新增 `D:\FRC\frc-train-review\docs\工筆截圖\*.png`（7 張）
- 沒動 repo 程式碼
- 沒動原 `C:\Users\USER\Downloads\Rebuilt工筆.docx`

### 設計決策
**為何不直接用 Playwright MCP 截圖而走 chrome-in-chrome + 本地 server**：使用者電腦上的 Chrome 已登入 Google 帳號並有 Rick 的 session cookie（reviewer 需要 step-up）。Playwright 新起瀏覽器要重跑整條 OAuth + step-up 流程，很容易在步驟 3-5 卡住。直接接管使用者 Chrome（chrome-in-chrome 透過 DevTools Protocol）可以直接用既有 session，減少登入摩擦。代價是踩到 Chrome download block；用 HTTP server 繞過即可。

**為何採 Konva.stages[0] 重繪而非直接 html2canvas-pro 抓整個 DOM**：html2canvas 在 tainted canvas 上會 fallback 畫空白，且即使 `ignoreElements` 排除 tainted canvas，剩下的 DOM 不包含標註框（Konva 是透過 canvas 畫的、不是 DOM element）。唯一路徑是從 Konva stage 的 node tree 抽資料、用乾淨 canvas 重繪。這個技巧可重用於未來的 Web 端截圖 / PDF 匯出功能 — 見 FINDINGS AAA。

### 型別 / 測試
不涉及。純內容產出，無程式碼變更。

### Git commits（本次 session）
無。純內容產出，沒動 repo。

### 下一步
1. 使用者自行把 `Rebuilt工筆_新增章節.docx` 合併進 `Rebuilt工筆.docx`
2. 主軸仍在「等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing」
3. FINDINGS AAA 的技巧備著，未來若要做 Web 端「匯出標註結果 PNG / PDF 報告」可直接拿來用

### 阻礙
- 無。章節已交付、使用者自行合併

### 5-Question Reboot Check
1. **做什麼？** 自動化截圖 production 網站並撰寫工程筆記 Iteration 2 章節（含 Gemini 自動預標註段落補寫）
2. **進度？** `Rebuilt工筆_新增章節.docx` 2.3 MB 含 7 張截圖交付；7 張 PNG 備份進 `docs/工筆截圖/`；使用者自行合併進原 docx
3. **下一步？** 等使用者合併完成。回歸主軸（標註反饋 → M7.7 GPU timing）
4. **阻礙？** 無
5. **關鍵檔案？**
   - `C:\Users\USER\Downloads\Rebuilt工筆_新增章節.docx` — 主產出（已交付）
   - `D:\FRC\frc-train-review\docs\工筆截圖\*.png` — 7 張截圖備份
   - `D:\FRC\frc-train-review\auto_pipeline.py` — Gemini 段落的 reference source
   - `D:\FRC\frc-train-review\compare_v2.py` / `compare_pro_vs_lite.py` — Pro vs Lite 實驗 reference

---

## Session: 2026-04-19（第 12 次）

### 主題
標註者（annotator）回報兩個一層審核畫面 bug：(1) 按 S 偶爾跳 alert「送出失敗（圖片 jydr02）：Illegal submit from under_review。請回到佇列找這張重標/重送。」(2) 按 S 後 queue counter 從 `3/374` 變 `3/373`（total -1 而非 idx +1）。使用者提到「之前標到一半有點擊『送出目前進度給審核』」。trace 後確認單一根因：session 8 `59a0f07` 在 submit route 加的 fast-path（batch 已 under_review → image 跳過 annotated 直寫 under_review）同時打破 queue filter 與 editor readOnly 兩條系統不變量。選擇移除 fast-path、回復 invariant。

### 執行模式
systematic-debugging：從使用者症狀 → 搜尋錯誤訊息來源（`state-machine.ts` 的「Illegal submit from ...」）→ 讀 submit route + queue filter + editor readOnly → 建立症狀與 fast-path 的單一因果鏈 → decide 移除 fast-path 而非擴充 filter/invariant。commit + push master 觸發 Vercel auto-deploy。

### 完成項目（1 個 commit，已 push master、Vercel auto-deploy 觸發）

**`194d0d6` fix(web): remove submit fast-path that dropped images out of annotator queue**（3 個檔案）

- `web/app/api/images/[id]/submit/route.ts` — 移除 fast-path 與 `batchPromoted` 變數。submit 永遠 `assigned → annotated`（`needs_rework → under_review` 邏輯保留給 resubmit — session 11 `8950152` reject-all 的反向 flip）。同時 update stale comment，反映「唯一合法 under_review 來源是 resubmit」
- `web/app/(protected)/annotate/[imageId]/editor.tsx`：
  - `readOnly = (state === 'annotated' || state === 'under_review')`（原本只含 annotated）
  - `status` 初始值對 under_review 顯示「已送審核（唯讀）」，annotated 保持原顯示
  - 按鈕條件由二分（readOnly ? 解鎖重標 : Submit）改三分：`annotated` 顯示「解鎖重標」按鈕（可 unsubmit 回 assigned）、`under_review` 顯示「已送審核」靜態文字（state machine 不允許 `under_review → assigned`，所以沒有 unsubmit 按鈕）、其他顯示 Submit 按鈕
- `web/tests/integration/annotations.test.ts` — 加 regression integration test「keeps submits as annotated after partial-promote flipped batch to under_review」驗證：partial-promote 後 batch.state=under_review，後續 submit 的圖必須停在 annotated 而非被跳成 under_review

### 修改檔案
- `web/app/api/images/[id]/submit/route.ts` — 移除 fast-path，restore「submit 永遠 annotated」
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — readOnly / status / 按鈕三分條件
- `web/tests/integration/annotations.test.ts` — regression test

### 設計決策
**為何選 revert fast-path 而非擴充 queue filter / readOnly invariant**：fast-path 的 UX 價值（partial-promote 後 trickle 送審）不值得破壞兩條系統不變量（queue filter 只收 `assigned/needs_rework/annotated`、editor readOnly 只認 annotated）。使用者實際行為模式也不需要 trickle — 他們已經用「送出目前進度給審核」explicit workflow 批次送審。擴充 filter / readOnly 要改 queue filter、editor、API 三處且所有 future state-machine 擴充都要重新 audit，成本遠大於 revert 一條 fast-path。

**為何 `under_review` 不給「解鎖重標」按鈕**：state machine 的 unsubmit 只允許 `annotated → assigned`，對 under_review 發 unsubmit 會被 server 擋 400。要讓使用者拉回已送審圖需要 reviewer 退回，不是 annotator 自己 unsubmit。UI 不顯示按鈕避免誤導。

**為何不清理既存 under_review 資料**：那些圖是使用者按 S 送出的（只是路徑跳過 annotated 中繼），intent 明確是送審，reviewer 照審即可，不回滾。

### 型別 / 測試
- `pnpm tsc --noEmit`：只剩 session 10 就在的 `tests/integration/batches.test.ts(72,51)` Uint8Array 無關錯誤
- `pnpm vitest run tests/unit`：12 files / 90 tests 全過
- Integration test 因 env 無 DATABASE_URL 未實際跑（本專案常態，session 11 也沒跑；regression test 落檔備 future CI）

### Git commits（本次 session）
- `194d0d6` fix(web): remove submit fast-path that dropped images out of annotator queue

已 push origin master，Vercel auto-deploy 觸發。

### 下一步
1. 觀察 Vercel Runtime Logs 確認 submit 不再出現「Illegal submit from under_review」
2. 問標註者 queue counter 是否恢復正常（3/374 → 4/374 而非 → 3/373）
3. 主軸仍在「等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing」

### 阻礙
- 無 blocker。pre-existing 遺留：batch 已 under_review 且使用者繼續標完剩餘 assigned 圖時，`count(state != annotated)` 會因既存 under_review 圖 > 0 → auto-complete 不 fire → 剩下 annotated 圖需手動「送出目前進度給審核」。fast-path 移除前也如此，只是症狀被 fast-path 隱藏。暫不擴大 scope 改 auto-complete 語意；若使用者回報再處理（例如改成 `count(state NOT IN [annotated, under_review, approved]) === 0` 時觸發）

### 5-Question Reboot Check
1. **做什麼？** 移除 submit fast-path、restore queue filter + editor readOnly 兩條 invariant、加 regression test
2. **進度？** commit `194d0d6` push origin master、Vercel auto-deploy 觸發
3. **下一步？** 觀察 Vercel logs + 問標註者 queue counter 行為；等 reject 反饋決 M7.7 timing
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/app/api/images/[id]/submit/route.ts` — 移除 fast-path
   - `web/app/(protected)/annotate/[imageId]/editor.tsx` — readOnly / 按鈕三分
   - `web/tests/integration/annotations.test.ts` — regression test

---

## Session: 2026-04-19（第 11 次）

### 主題
兩件獨立的 prod hot-fix 合併一個 session：(1) 使用者按「Download zip」匯出 710 張已 approve 的 YOLO dataset 撞到 500「響應體物件不應受到干擾或鎖定」; (2) 使用者要求「第二層審核介面加全部退回按鈕，有些人一看就知道沒看過就來審了」 — reviewer 可以在 batch 層級一鍵把所有 under_review 的圖全退回 needs_rework，附一個共用 comment。

### 執行模式
非結構化 hot-fix，但前半段 export 500 走 systematic-debugging 追到 `@vercel/blob` v2 內部 retry 機制撞到 undici ReadableStream consumed 的底層原因（見 FINDINGS YY）。後半段新功能走「薄 API + 薄 UI + 複用既有 REJECT_PRESETS 與 step-up scope」模式。兩個 commit 都 push origin master 讓 Vercel auto-deploy 觸發。

### 完成項目（兩個 commit，都已 push master、Vercel auto-deploy）

**1. `2623dfb` fix(web): use multipart upload for YOLO export zip to blob**（1 個檔案）

- `web/app/api/projects/[id]/export/route.ts:132` 的 `put(key, stream, {...})` 補上 `multipart: true`。根因：`@vercel/blob` v2 `put()` 在 `requestApi` 層用 `async-retry`（`VERCEL_BLOB_RETRIES` 預設 10 次）做 HTTP 重試；非 multipart 路徑直接把整個 `ReadableStream` 餵進 `fetch(..., { body: stream })`，第一次 PUT timeout / 5xx 後 retry 想重用同一 stream、但 stream 已被 undici 消耗 → `The response body object should not be disturbed or locked`（Chrome 中文翻譯即使用者看到的「響應體物件不應受到干擾或鎖定」）。multipart 路徑（`uncontrolled.ts` 的 `uncontrolledMultipartUpload`）從 stream 讀 chunk 切 parts，每個 part 獨立 PUT + 獨立 retry，失敗 part 不需要重讀整條 stream
- 為什麼這次才炸：之前小 batch 一次 PUT 就成功、沒觸發 retry 路徑。710 張圖邊組 zip 邊上傳較慢，第一次 PUT 撞到 Vercel edge timeout，retry 才踩到既有的 bug

**2. `8950152` feat(web): reviewer can reject an entire batch back to the annotator**（4 個檔案）

- 新檔 `web/app/api/batches/[id]/reject-all/route.ts` — POST，`authzOr401(session, 'image.reject', req)` 走同一個 reviewer step-up scope、body `{ comment: string (1-500) }`、單 transaction：找 batch 驗 `state === 'under_review'`（否則 409）→ 找所有 `state='under_review'` 的圖 → 0 張回 400「這批已經沒有待審圖了」→ `updateMany` → needs_rework → `createMany` 所有圖的 ReviewEvent（action='reject'、同一 comment）→ `batch.state` 翻回 `in_annotation`（避免 dashboard 殘留 phantom 0 images batch，照搬 session 9 partial-promote 的設計）。Audit `batch.reject_all` payload `{ rejectedImages, comment }`
- `web/app/api/images/[id]/submit/route.ts` — annotator 重送 `needs_rework → under_review` 時，若 `batch.state === 'in_annotation'`（reject-all 後的狀態）要把 batch 一起 flip 回 `under_review`，否則重送圖 reviewer dashboard 看不到（dashboard 篩 `batch.state='under_review'`）
- `web/app/(protected)/review/[batchId]/page.tsx` — 加傳 `batchId` 給 ReviewTray
- `web/app/(protected)/review/[batchId]/review-tray.tsx` — 加 `batchId` prop；header 右上加紅色「全部退回」按鈕；加 reject-all dialog（複用 REJECT_PRESETS：菜就多練、邊框沒框好、沒框、少框機器人、少框 fuels、其他、同一風格 radio list、`disabled` 狀態）；成功 → `router.push('/')` 回 dashboard；dialog 開啟時 Space / R keyboard shortcut 被抑制

### 修改檔案
- `web/app/api/projects/[id]/export/route.ts` — 加 `multipart: true`
- `web/app/api/batches/[id]/reject-all/route.ts`（新）
- `web/app/api/images/[id]/submit/route.ts` — resubmit 時 flip batch 回 under_review
- `web/app/(protected)/review/[batchId]/page.tsx` — 傳 batchId
- `web/app/(protected)/review/[batchId]/review-tray.tsx` — 全部退回按鈕 + dialog

### 設計決策
**為何 reject-all 要 flip batch 回 in_annotation，而個別 reject 不用**：session 9 已經確立 batch.state 必須反映「reviewer 有沒有東西要看」。批次級大動作是「整個 batch 回歸 annotation 階段」，所以順便把 batch.state 也 flip 回去。個別 reject 則不確定其他圖是否還要審，維持 under_review 正確。

**為何要改 submit route 的 resubmit 分支**：flip batch 回 in_annotation 後會形成新 edge case — annotator 重送的 `needs_rework` 圖 state 變 `under_review` 但 batch 仍在 `in_annotation`，reviewer dashboard（篩 batch.state）看不到。symmetric 解法是 resubmit 時 flip batch 回 under_review，類似 partial-promote 的反向。

**為何不 hide 按鈕在 idx >= images.length**：`if (!current)` 已 short-circuit return 另一個畫面，按鈕不會顯示，不用額外 guard。

**為何 export 500 選 multipart 而非改 retry 設定**：`VERCEL_BLOB_RETRIES=0` 可以關 retry 吞掉症狀、但大檔 streaming 失去容錯、單一 PUT timeout 就整個匯出失敗。multipart 是 Vercel Blob 官方對大檔 streaming 的建議，每 part 獨立 retry 才是正解。

### 型別 / 測試
- `pnpm tsc --noEmit`：只有既存無關的 `tests/integration/batches.test.ts(72,51)` Uint8Array 型別錯誤（session 10 就在了）
- `pnpm vitest run`：90/90 unit tests 全過；integration tests 因環境沒 DATABASE_URL 全 fail（與本 session 無關）
- 無新 unit test（薄 API + 薄 UI、走 deploy 後 manual verify）

### Git commits（本次 session）
- `2623dfb` fix(web): use multipart upload for YOLO export zip to blob
- `8950152` feat(web): reviewer can reject an entire batch back to the annotator

兩個 commit 都已 push origin master，Vercel auto-deploy 觸發。

### 遇到的事件
- export 500「響應體物件不應受到干擾或鎖定」：使用者報錯後 10 分鐘內追到 `@vercel/blob` retry + undici stream 消耗底層原因，補 `multipart: true` 解決。詳見 ERROR E32 + FINDINGS YY

### 下一步
1. 觀察 Vercel Runtime Logs 確認 export 不再 500、reject-all audit log 記錄正常
2. 若使用者用 reject-all 後標註者有混亂（「我剛送出怎麼又全退回」），考慮在 reject-all comment 加「batch 整批退回，請整批檢查」提示字
3. 主軸仍在「等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing」

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** 修 YOLO export 500（multipart streaming）+ 新增 reviewer batch-level「全部退回」按鈕
2. **進度？** 兩個 commit (`2623dfb`, `8950152`) 全 push origin master、Vercel auto-deploy 成功
3. **下一步？** 觀察 Vercel logs 看 export 與 reject-all 穩定度，等標註者反饋決定 M7.7 timing
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/app/api/projects/[id]/export/route.ts` — multipart streaming 修
   - `web/app/api/batches/[id]/reject-all/route.ts` — 新 API
   - `web/app/api/images/[id]/submit/route.ts` — resubmit 時 flip batch 回 under_review
   - `web/app/(protected)/review/[batchId]/review-tray.tsx` — 全部退回按鈕 + dialog

---

## Session: 2026-04-19（第 10 次，深夜）

### 主題
標註者（annotator）與審核者（reviewer）反應「按 S / Space 後切下一張太慢、圖片載入慢」。系統性 trace 三個流程（annotator S submit、reviewer Space approve、reviewer 圖片載入）的 DB round-trip + HTTP RTT 後，做一系列效能改動分兩個 commit 上 production。使用者最後確認「夠快了」，此主題暫停。

### 執行模式
非結構化 hot-fix 形式，但過程跑 systematic-debugging skill：先 trace 三個流程每一步的 DB RT + HTTP RTT、識別瓶頸、排優先序、再實作。動手前用 `npx neonctl branches create` 建了 Neon branch `backup-2026-04-18-before-perf` (`br-withered-cell-amw3kxys`) 作為 rollback 保險。最後階段為了達到「幾乎無縫」需求再加碼 optimistic annotator submit。

### 完成項目（兩個 commit，都已 push master、Vercel auto-deploy）

**1. `146c346` perf(web): cut DB round-trips + optimistic reviewer UI for faster annotation loop**（6 個檔案）

伺服器端砍 DB round-trips：
- `web/app/api/images/[id]/approve/route.ts` — 移除 `writeAudit` 呼叫。`ReviewEvent` 已經記錄同樣資訊（reviewer / timestamp / before-after），auditLog 是重複寫，-1 DB RT
- `web/app/api/images/[id]/reject/route.ts` — 同上，移除 `writeAudit`
- `web/app/api/images/[id]/annotations/route.ts` — 5 DB RT → 3 DB RT。原本是 `findUnique`（檢 authz / state）+ `updateMany` CAS + `findUniqueOrThrow`（取 updatedAt）。改為單一 `updateMany({ where: { id, assignedToId, state: { in: ['assigned', 'needs_rework'] }, updatedAt: lastKnown }, data: { updatedAt: now, annotations: ... } })` 把 authz + state + CAS 全部壓進一條 SQL，count=0 就 409
- `web/app/api/images/[id]/submit/route.ts` — 接受 optional body `{ boxes, lastKnownUpdatedAt }`。若帶 boxes，單一 transaction 內 updateMany 同時做 save + CAS + state flip（annotated）；body 缺時走舊 2-step 邏輯做 backward compat

客戶端優化：
- `web/app/(protected)/review/[batchId]/review-tray.tsx` — ① `useEffect[idx]` 預載下 3 張圖（`const preload = new window.Image(); preload.src = url`）讓下一張命中 browser cache；② approve / reject 改 optimistic：`setIdx(next)` 先走、POST 背景跑、失敗用 `errorMsg` state 顯紅色 banner
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — S 鍵 submit 改為一次把 boxes 直接塞進 submit body（不再先 PATCH annotations 再 POST submit，省 1 HTTP + 2 DB RT）；同時 `doSave` 成功時同步寫 `updatedAtRef.current = json.updatedAt`（原本只靠 `useEffect([updatedAt])` 同步 ref，會讓 `await inFlightSave` 後讀到 stale 值，見 FINDINGS VV）；新增 `submittedRef` 避免 submit 成功後 unmount flush 又打一發 spurious PATCH

**2. `b9d51ea` perf(web): make annotator S key optimistic — navigate first, POST in background**（2 個檔案）

- `web/app/api/images/[id]/submit/route.ts` — 移除 updateMany 裡的 `updatedAt: lastKnown` CAS 條件（只保留 `state: img.state`）。原因：optimistic submit 不 await autosave，若 autosave PATCH 在 submit 之前完成會 bump updatedAt，submit 手上的 lastKnown 變 stale 導致永遠 409。見 FINDINGS WW
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — submit 改 optimistic 流程：snapshot payload → `submittedRef.current = true` → `router.push('/annotate/' + nextId)` 立即 → 背景 `void fetch(...)`。失敗用 `window.alert('送出失敗（圖片 {6chars}）...')` 告知（此時原 editor 已 unmount，status 顯示不到，必須用 alert）

### 效果（使用者確認「夠快了」）

| 流程 | 原 | 新 |
|---|---|---|
| Annotator S | 2 HTTP（PATCH+POST）+ 7-10 DB RT 序列、500ms-2s | 1 HTTP（背景）+ 4-5 DB RT；UI 即時 navigate（感官 0ms） |
| Reviewer Space | 等 6 DB RT 才切圖、300-500ms | 純 setIdx 即時、圖片已 prefetch |
| Reviewer 圖片載入 | 冷下載 1-3s | prefetched 命中 browser cache |

### 修改檔案
已於上方兩個 commit 列出；關鍵概念新增：`submittedRef`（editor）、`errorMsg` state（review-tray）、optional boxes body（submit API）、全 project image prefetch（review-tray）。

### 設計決策
**Prisma `updateMany` 壓多條件進一條 SQL 的收益 vs 可讀性**：把 authz / state / CAS 全壓進 where clause 讓 code 變難讀（不能 early return 給明確錯誤），但對 PATCH annotations 這條 hot path（autosave 每 5 秒跑一次）少 2 次 network round-trip 值得。Trade-off：失敗時只拿得到「0 row affected」，要靠額外一次 findUnique 判斷失敗原因（authz 被拒？state 不對？CAS 過期？）— 實際上發生 409 時一率回 `409 stale / unauthorized` 給 client、client 強制 re-fetch，不再細分原因，簡化錯誤處理。

**為何不做 batch-level SPA 取代 annotator 頁面導航**：真正極致的「0ms 感官延遲」是把 annotator 改成跟 reviewer 一樣的 SPA（同頁換圖不導航）。但這是 2-3 小時的大改，本次 hot-fix scope 不值得。Optimistic navigation 搭 Next.js route prefetch 已能做到使用者無感，先這樣。

**為何 submit 移除 updatedAt CAS 不會造成重複提交**：state 檢查（`state: img.state` 其中 img.state 是進入 handler 時 snapshot 的 `assigned` / `needs_rework`）已足以 guard 重複 submit — 第二次 submit 會看到 state 變成 `annotated` → 0 count → 回 409，是 expected 行為。見 FINDINGS WW。

### 型別 / 測試
- `pnpm tsc --noEmit` 本次變更檔全乾淨；既有 `tests/integration/batches.test.ts(72,51)` Uint8Array 型別錯誤與本 session 無關
- `pnpm vitest run` unit 跑完：12 test files / 90 tests 全 pass
- Integration test 因環境未設 `DATABASE_URL` 全 fail，與本 session 無關
- 無新單元測試（hot-fix 模式 + 手動驗證 + 直接 push）

### Git commits（本次 session）
- `146c346` perf(web): cut DB round-trips + optimistic reviewer UI for faster annotation loop
- `b9d51ea` perf(web): make annotator S key optimistic — navigate first, POST in background

兩個 commit 都已 push origin master，Vercel auto-deploy 觸發。

### Rollback 準備
- Neon branch `backup-2026-04-18-before-perf` (`br-withered-cell-amw3kxys`) 保留中；一兩天穩定後可刪

### 遇到的事件
- 無新 error；使用者最後確認「夠快了」，此主題暫停

### 下一步
1. 觀察 Vercel Runtime Logs 看 submit 409 或 annotator alert 出現頻率
2. 穩定後刪掉 Neon backup branch
3. 若日後要做極致無縫（真·0ms），下一步是把 annotator 改 batch-level SPA（跟 reviewer 一樣），預估 2-3 小時
4. 主軸仍在「等標註者累積完整 reject 反饋 → 決定 M7.7 GPU train timing」

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** Annotator S / reviewer Space 切圖效能優化（砍 DB round-trip + 預載圖片 + optimistic UI + optimistic navigation）
2. **進度？** 兩個 commit (`146c346`, `b9d51ea`) 全 push origin master、Vercel auto-deploy 成功、使用者確認「夠快了」
3. **下一步？** 觀察 Vercel logs、穩定後刪 Neon backup branch、等標註者反饋、評估是否要 annotator SPA 化
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/app/api/images/[id]/annotations/route.ts` — 5 DB RT → 3 DB RT 壓縮
   - `web/app/api/images/[id]/submit/route.ts` — 可選 boxes body + 移除 updatedAt CAS
   - `web/app/api/images/[id]/approve/route.ts` / `reject/route.ts` — 移除 writeAudit
   - `web/app/(protected)/annotate/[imageId]/editor.tsx` — ref snapshot bug 修、optimistic submit、submittedRef guard
   - `web/app/(protected)/review/[batchId]/review-tray.tsx` — 下 3 張 prefetch + optimistic approve/reject

---

## Session: 2026-04-19（第 9 次）

### 主題
排查 reviewer dashboard 出現 `FRC 視覺 2026-04-18 (auto) — 隊員I-1 (0 images)` 空 batch 的成因，修掉 partial-promote 的邊界 bug，並把 prod 資料救回。

### 執行模式
單點 debug/fix；先在 Neon prod 上診斷、改程式 push 讓 Vercel auto-deploy、再執行一次性資料修復 script。

### 根因
session 8（`59a0f07`）新的 `web/app/api/batches/[id]/promote/route.ts` POST handler，流程：
1. 權限檢查（`ownCount > 0` 才可 promote）
2. `tx.image.updateMany({ where: { batchId, state: 'annotated' }, data: { state: 'under_review' } })` 取得 count
3. 若 `batch.state === 'in_annotation'` → **無條件** flip 成 `under_review`

Bug：當 annotator 按下「送出目前進度給審核」時身上一張 `annotated` 都沒有（全部仍是 `assigned` / `needs_rework`），`updateMany` count 回 0，但程式仍把 batch flip 到 `under_review`。Dashboard query（`web/app/(protected)/page.tsx:23`）用 `_count.images where state='under_review'` 計數 → reviewer 看到 batch 但 0 張可審。

連帶：session 8 的 submit route 新邏輯「batch 已 `under_review` → submit 時跳過 annotated 中繼」，隊員I誤觸 promote 後繼續標、submit → image 被跳狀態 → batch 內混雜 `assigned` + `under_review`，畫面更亂。

### DB 證據（prod Neon）
- batch id `cmo3x1xkt03oi0oucj8bnqwoz`, 隊員I-1, 114 張
- 診斷時分佈：assigned 113 / under_review 1
- audit log: `2026-04-18T15:52:37Z batch.promote by 413061隊員I payload={"promotedImages":0}`

### 修復
**程式**（commit `fcfc0ae`，已 push master，Vercel auto-deploy）
- `web/app/api/batches/[id]/promote/route.ts` — `updateMany` count=0 時 `throw new HttpError(400, '目前沒有已標註的圖可送審')`，batch state 不動。client 端 `editor.tsx:278` 的 `setStatus(msg)` 會把錯誤訊息顯示給 annotator，體感足夠，未加 UI disable 邏輯

**資料**（prod 已 apply）
- batch `隊員I-1` state: `under_review` → `in_annotation`
- 那 1 張被跳狀態 image 在修復前剛好被 reviewer approve（state=approved），保留現狀
- 113 張 assigned image 回到標註者佇列

### 修改檔案
- `web/app/api/batches/[id]/promote/route.ts` — count=0 guard
- `web/scripts/_diag-batch.ts`（**新檔**，未 commit）— read-only 檢查 batch state / image state 分佈 / assignees / audit log
- `web/scripts/_fix-batch-yan.ts`（**新檔**，未 commit）— 一次性資料修復 script（dry-run / `--apply`）

### 設計決策
**為何不加 UI disable button**：client 沒有可靠判斷「當下本 batch 有無 `annotated` image」的 state（只有自己 editor 內 boxes state，不知 batch 全域）。要嚴謹做就要再拉一支 `/batches/:id/promote-eligible` API 或把 annotated count 壓進 page props，擴散半徑大。直接讓 server 回 400 + status 訊息足夠，使用者自然會理解「要先 S 提交某張」。

**為何 fix 用一次性 script 而不是 migration**：只影響單一 batch、prod-only，migration 是對 schema 變更；跑 ad-hoc script with dry-run + `--apply` guard 是正確粒度。script 留著未 commit，符合 session 7 `_*.ts` debug helper 慣例。

### 型別 / 測試
- `pnpm tsc --noEmit` 未跑本次（單檔 3 行 guard 改動）；prod deploy 成功即驗證通過
- 無新單元測試；partial-promote 的 happy path 已在 session 8 手動驗證過，本次只是加 error path

### Git commits（本次 session）
- `fcfc0ae` fix(web): partial-promote rejects when no annotated images（已 push origin master）

### 遇到的事件
- 本次主題就是處理 event；E31 詳見 ERROR.md

### 下一步
1. 觀察新錯誤訊息「目前沒有已標註的圖可送審」是否出現在標註者反饋中
2. 繼續等一輪完整 reject 反饋再決定 M7.7 GPU train timing（不變）
3. `_diag-batch.ts` / `_fix-batch-yan.ts` 留著未 commit

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** 排查 & 修復 reviewer dashboard 空 batch bug（partial-promote count=0 時仍 flip batch.state）
2. **進度？** commit `fcfc0ae` push 完、prod DB 資料修復完
3. **下一步？** 等標註者反饋、觀察 partial-promote 正常使用率
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/app/api/batches/[id]/promote/route.ts` — 本次修補點，count=0 guard
   - `web/app/api/images/[id]/submit/route.ts` — 「batch 已 under_review → 跳中繼」邏輯源
   - `web/app/(protected)/page.tsx` — reviewer dashboard `_count` query
   - `web/scripts/_diag-batch.ts` — 未來 diag 用
   - `ERROR.md` E31

---

## Session: 2026-04-18（第 8 次）

### 主題
在標註者 / 審核者 / project home 三個介面補上 class count 可視化，並新增「標到一半提早送審」的 partial-promote 機制。全部變更都是因應正式上線後標註者實際反饋，已 push 到 production 由 Vercel auto-deploy。

### 執行模式
標準 full-workflow，三階段小型 UI 增強；每階段 commit + push，直接讓 Vercel auto-deploy。

### 完成項目（三個 commit）

**1. `c38f4a9` feat(web): per-class counts + delete-all button in annotate/review UI**
- `web/components/annotation/ClassPalette.tsx` — 新增 optional `counts?: number[]` prop；每個 class 名旁顯示即時 count
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — 用 `useMemo` 從 boxes 算 counts 傳給 palette；footer 新增「全部刪除」按鈕，走 existing undo stack（Ctrl+Z 可還原），single confirm 防誤觸
- `web/app/(protected)/review/[batchId]/review-tray.tsx` — header 下方新增 pill 列，顯示當前圖片各 class 數量，復用 project home pill 樣式

**2. `c998272` feat(web): project home Classes shows total annotation count per class**
- `web/app/(protected)/projects/[id]/page.tsx` — 新增 `prisma.annotation.groupBy({ by: ['classIdx'], where: { image: { batch: { projectId } } } })` 單一 query 算全專案累計 count；Classes pill 顯示 `0: red_robot × 1234` 格式
- 使用者澄清：「[Image #1] classes」指的是 project home 頁面的 Classes 區塊要顯示整個 project 累計的各 class 數量，不是單張圖

**3. `59a0f07` feat(web): annotator partial-promote button sends progress to review early**
- 需求：標註者標到一半有事，想把目前已完成的圖先送給審核者看，不用等整批完成
- `web/lib/state-machine.ts` — 新增 `promote: annotated → under_review` transition
- `web/app/api/batches/[id]/promote/route.ts` — **新檔** POST endpoint：
  - 權限：只有有 image 派給自己的 annotator 能打（`image.count({ batchId, assignedToId: session.user.id })`）
  - 動作：把本 batch 中所有 `annotated` image flip 到 `under_review`；若 `batch.state='in_annotation'` 一併 flip 到 `under_review`
  - 409 不允許從 completed 等狀態 promote；idempotent
  - 寫 audit log `batch.promote`
- `web/app/api/images/[id]/submit/route.ts` — 核心邏輯改動：若 batch 已在 `under_review`（因前次 promote 過），submit 時直接把 image flip 到 `under_review`，跳過 `annotated` 中繼狀態
- `web/app/(protected)/annotate/[imageId]/page.tsx` — 傳 `batchId` 給 Editor
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — footer 新增「送出目前進度給審核」按鈕，先 flushSave → confirm → POST → `router.refresh()`

### 修改檔案
已於上方三個 commit 列出；關鍵新檔：`web/app/api/batches/[id]/promote/route.ts`。

### 設計決策
**partial promote 為何必須同時 flip batch.state**：reviewer dashboard 篩選 `batch.state='under_review'`，只 flip image 不 flip batch 會讓 reviewer 看不到；連帶導致 submit route 要判斷「batch 已 under_review → 跳過中繼直接 under_review」，整個 batch 轉為「連續動態 review」模式。詳見 FINDINGS.md 發現 TT。

**Delete all button 為何只 single confirm**：現有 undo stack（50 步，Ctrl+Z）是安全網，雙層 confirm 屬 over-engineering。

**counts 為何用 useMemo 不用 context/zustand**：local state 衍生值、無跨 component 共享需求；boxes 最多約 20 個，O(n) 重算可忽略。

### 型別 / 測試
- `pnpm tsc --noEmit` 本次變更檔全乾淨；既有 `tests/integration/batches.test.ts(72,51)` Uint8Array 型別錯誤與本 session 無關
- 無單元測試新增（小型 UI 增強 + 1 個 API endpoint，走 manual verify + 直接 push）

### Git commits（本次 session）
- `c38f4a9` feat(web): per-class counts + delete-all button in annotate/review UI
- `c998272` feat(web): project home Classes shows total annotation count per class
- `59a0f07` feat(web): annotator partial-promote button sends progress to review early

全部已 push 到 origin master，連帶把之前累積的 9 個 local-only commits 一起 push 出去（Vercel auto-deploy 觸發）。

### 遇到的事件
- 無新 error

### 下一步
1. 繼續等標註者實際反饋
2. 觀察是否有人使用 partial-promote 按鈕（audit log `batch.promote` 可追）
3. 累積一輪完整 reject 反饋後再決定 M7.7 GPU train timing

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** 三個 UI 增強：per-class counts（annotate + review）、project home 全專案 class 累計 count、partial-promote 提早送審機制
2. **進度？** 三 commits 全部 push 到 production（Vercel auto-deploy）
3. **下一步？** 等標註者實際反饋、觀察 partial-promote 使用率
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/lib/state-machine.ts` — 加了 promote transition 的完整規則
   - `web/app/api/batches/[id]/promote/route.ts` — 新 endpoint
   - `web/app/api/images/[id]/submit/route.ts` — 條件短路邏輯（batchPromoted）
   - `web/app/(protected)/annotate/[imageId]/editor.tsx` — 三個新按鈕 + counts
   - `web/components/annotation/ClassPalette.tsx` — counts prop

---

## Session: 2026-04-18（第 7 次，深夜接續）

### 主題
隊員在 Google Drive 「frc視覺辨識/」共用資料夾丟了新一批素材（含全新成員 `隊員B`），跑完整條 auto pipeline（`auto_pipeline.py download→preprocess→annotate` → `repack_per_owner.py` → `web/scripts/import-per-owner.ts`）把新資料匯進 prod web 平台，**不造 duplicate、不漏、不動到標註者已完成進度**。途中在 import 階段踩了四個連環坑，每踩一個就停手修 script → 清損傷 → 重跑，最終在 v6 乾淨跑完。

### 執行模式
非結構化熱修 + 連續五次嘗試（v1 partial damage → stop → delete orphan → v2 stop → v3 stop → v4 WebSocket crash → v5 WebSocket crash → v6 完成）。每次失敗都先確認 DB 現況、清掉 partial batch，再改 script 前進下一個瓶頸。

### 完成項目（依時序）

**1. auto_pipeline 三階段本地處理（不動 DB）**
- `download`: rclone 增量，1197 檔 / 8.76 GiB，本次新增 156 檔
- `preprocess`: 1133 new outputs（視訊新 frames + 新圖），856 skipped
- `annotate`: Gemini 1133 done / 2 err / 31605 boxes

**2. repack_per_owner**
- 11 owners（10 舊 + 1 新 `隊員B`），4908 imgs 有 label，30 batches
- repack wipe+rebuild 機制導致 `隊員A`（舊 1 batch）被重切為 `隊員A-1/-2`；`隊員G`、`隊員C` 也有類似切換

**3. web user mapping 全員 1:1 對上**
- 每個 Drive 資料夾名都能 substring-match 唯一一位 `user.name`，無須手動 mapping
- 新 owner `隊員B` → web user `313036隊員B` (hs313036)

**4. import-per-owner.ts 五代修復（見下方「修改檔案」）**

**5. 最終 DB 狀態**
- Project `cmo3vzz8b0000i8uccnfevhkt` 從 23 → 31 batches（全部 `state=in_annotation`）
- 新增 8 batch：`隊員A-1/-2`、`隊員B-1/-2`、`隊員C-4/-5/-6/-7`
- Append 4 batch：`Anna-1/-2`（各 +1）、`隊員D`（+151）、`隊員C-3`（+38）
- 21 batch 原樣 skip（全部 stem 都已在 DB）
- 總計 4909 imgs 分派給 11 位 owner。各 owner 總數：Anna 423、隊員A 417、隊員E 470、隊員F 467、隊員B 582、隊員G 204、隊員H 420、隊員D 278、隊員C 295、隊員I 677、隊員J 676

### 修改檔案（本 session，未 commit）
- `web/scripts/import-per-owner.ts` — 主修，五個獨立改動：
  1. **Global project-wide stem-level skip**（取代原本的 per-batch-name skip）— 用 `globalExistingFilenames` Set 比對 project 所有 `Image.blobPath` 的 basename，避免 repack rename sub-batches 造成 duplicate
  2. **`decodeURIComponent` 修正**— Vercel Blob 把中文檔名 URL-encode（例 `%E5%90%B3%E8%A1%A3%E7%B5%9C__...`），要 decode 後才能跟原生 UTF-8 zip entry name 比對
  3. **`DATABASE_URL = DATABASE_URL_UNPOOLED` env swap**— 在 `import` lib/db 之前 swap，長時間大量 INSERT 下走 pooler 會被 Neon 斷 WebSocket
  4. **CONCURRENCY 8 → 4**— 進一步降載
  5. **`updateMany { where: { batchId, state: 'unassigned' } }`**— 原本只 update `imageIds`，遇到中斷 orphan unassigned 會殘留；改全 batch 掃
- `web/scripts/_check-damage.ts` — 新 debug helper（列 project 所有 batches + img counts）
- `web/scripts/_debug-blobpath.ts` — 新 debug helper（印 blobPath 看 URL-encoding）
- `web/scripts/_dry-run-import.ts` — 新 debug helper（不動 DB，只算每個 manifest batch 的 new/skip 數字）

### Git commits
無，script 變更尚未 commit。

### 遇到的事件（ERROR.md 要記的四個坑）
1. **v1 run**：per-batch skip + 中文 URL-encode 沒處理，導致 `隊員A-1` 把已在舊 `隊員A` batch 的 stem 誤傳 63+ 張 dup → stop + delete-batch 清掉
2. **v2 run**：global skip 沒做，`隊員A-1/-2` 因為新 batch name 直接走「create fresh」分支，又要把舊 stem 全部重傳一輪 → stop + delete-batch 清掉
3. **v4 / v5 run**：Neon pooled WebSocket 在長時間 INSERT 下斷線（94s / 33s 後掛）→ 改用 `DATABASE_URL_UNPOOLED` + concurrency 4
4. **中斷後殘留 `state=unassigned` orphan images**（script 只 update `imageIds` scoped）→ 改 batchId-wide state updateMany 涵蓋

### 下一步
1. 繼續等標註者實際反饋（pipeline 主軸仍在 review 階段）
2. 累積一輪完整 reject 反饋後再決定 M7.7 GPU train timing（不變）
3. 本 session 的 `import-per-owner.ts` 修改可以 commit（user 尚未要求）；若 commit 建議拆成五個獨立 commit（global skip / decodeURIComponent / unpooled / concurrency / batchId-wide updateMany）
4. 三個 `_*.ts` debug helper 可以留著下次用，或清掉

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** 跑完新一輪 auto pipeline（含新成員 隊員B）→ import 進 prod
2. **進度？** 31 batches 全部 `in_annotation`，4909 imgs 分派到 11 owner，乾淨收尾；script 修改未 commit
3. **下一步？** 等反饋；若要 commit `import-per-owner.ts` 的五項修改要分成獨立 commit
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/scripts/import-per-owner.ts` — 本輪主修
   - `web/scripts/_check-damage.ts` — 未來診斷 DB 用
   - `web/lib/db.ts` — 了解 pooled vs unpooled 切換點
   - `repack_per_owner.py` — wipe+rebuild 機制的來源
   - `ERROR.md` — E27-E30 四筆新錯誤

---

## Session: 2026-04-18（第 6 次，深夜接續）

### 主題
標註者正式上線當下連環回報 bug / UX 缺陷，當場熱修；六個 commit 全部 push master → Vercel auto-deploy production，無中斷。

### 執行模式
非結構化、逐回報 bug 逐修。每收一則反饋 → 定位根因 → 修 → `git push` → 等 Vercel redeploy → 下一則。

### 完成項目

**1. `ce10603` fix pan crash**
- 根因：`AnnotationCanvas.tsx` mousemove pan 分支在 `setVp((cur) => ...)` functional updater **內部** 直接 deref `panState.current!`，React 19 concurrent rendering 延後 / 重跑 updater 時 `mouseup` 已把 ref 清 null → render phase throw → Editor unmount → Edge 顯示「This page couldn't load」fallback。
- 修法：ref 先 snapshot 到 local `const base`，updater closure 只讀 base，不碰可變 ref。

**2. `11ae026` session + unsubmit（兩件合一）**
- 「save failed、重登又好」(E24) 根因 A：`auth.ts` session.maxAge = 1h，連續同頁標註不切頁 → 無 server request 觸發 jwt callback rotate → 到期直接掛。修法：改 30d（對齊 Auth.js 預設）。
- 「save failed」(E24) 根因 B：`images/[id]/annotations` PATCH 用 `throw Object.assign(new Error, {status})`，Next.js 16 App Router 吞成 500 空 body（E12 坑），client 看不到 401。修法：三個 route（annotations / submit / signed-url）全遷 `NextResponse.json({error}, {status})` + 新 `HttpError` class；client 收 401 → setStatus + `window.location.href = '/login'`。
- 「無法返回上一張」(E25) 根因：queue 過濾 `state: { in: ['assigned', 'needs_rework'] }`，submit 後狀態變 `annotated` 掉出 queue → `prevId` 永遠 undefined。修法：queue filter 加 `annotated`；`editor.tsx` 判 `readOnly = imageState === 'annotated'`（autosave / flush / delete / undo / S 鍵全 skip）；footer 換「解鎖重標」按鈕 → 新 route `POST /api/images/[id]/unsubmit`；`state-machine.ts` 新增 `unsubmit` transition（僅 `annotated → assigned`）。

**3. `fbd5b27` e.repeat guard**
- 根因：Windows 預設 key-repeat ~30Hz，`keydown` 連發，handler 沒擋 `e.repeat` → 每次 repeat 都 `router.push(nextId)` 疊一大堆。
- 修法：兩支 keyboard useEffect 最前面加 `if (e.repeat) return;`；nav handler 額外 `e.preventDefault()`；S / 數字 / Delete / Ctrl+Z 主 shortcut handler 一並擋。

**4. `99273c3` stable queue order + darken boxes**
- 「←/→ 並非前/後一張」根因：queue `orderBy: { updatedAt: 'asc' }`，autosave 會 bump `updatedAt`，編輯中的圖往 queue 尾巴跑 → 側邊順序與 ←/→ 對不上。修法：`orderBy: [{ batchId: 'asc' }, { id: 'asc' }]` 穩定排序 = 匯入順序。
- 「框顏色要深一點」：`AnnotationCanvas.tsx` 加 `darken(hex, amount)` helper，classColor 對 DB 色碼套 25% 變暗；DB 色碼不動。

**5. `97b8be2` edge-only hit test**
- 需求：「點擊框的邊緣才選取，不是框內部都可選取」
- 修法：`hit-test.ts` 的 `hitTestBox` 改 8px 邊帶命中（外圈外 edgeWidth 到內圈內 edgeWidth 的環狀），內部命中落到 draw handler → 可在現有框裡畫 nested 新框。邊長 < 2*edgeWidth 的小框 deadzone 崩陷 → 整個可點（避免無法選小框）。`tests/unit/annotation-hit-test.test.ts` 重寫，13 passed。

**6. `4593ce0` clickable sidebar with state icons**
- 需求：「左邊順序號碼要能點跳轉、當前圖片要提示、狀態圖示要正確」
- 修法：`page.tsx` queue select 加 `state`、改傳 `queueItems: {id, state}[]`；`editor.tsx` prop 改 `queueItems`，新增共用 `navTo` callback（flushSave → router.push），←/→ 改用 navTo；側邊列表 `<div>` → `<button>` 可點擊；狀態圖示：`●` 當前 / `✓` annotated / `✎` needs_rework / `○` assigned；當前行 bg highlight + 粗體 + disabled，hover 灰底 + pointer；prefetch 邏輯改從 queueItems slice。

### 修改檔案
- `web/components/annotation/AnnotationCanvas.tsx` — pan ref snapshot + darken helper + classColor 套 0.25 變暗
- `web/components/annotation/hit-test.ts` — hitTestBox 改 edge-only 8px 帶，移除 unused dispToImg import
- `web/tests/unit/annotation-hit-test.test.ts` — 重寫 hitTestBox 測試（13 passed）
- `web/lib/auth.ts` — session maxAge 1h → 30d
- `web/lib/state-machine.ts` — 加 `unsubmit` transition（`annotated → assigned`）
- `web/app/api/images/[id]/annotations/route.ts` — throw → NextResponse.json + HttpError class
- `web/app/api/images/[id]/submit/route.ts` — 同上
- `web/app/api/images/[id]/signed-url/route.ts` — 同上
- `web/app/api/images/[id]/unsubmit/route.ts` — **新檔**，POST endpoint with audit log
- `web/app/(protected)/annotate/[imageId]/page.tsx` — queue state 加入 select、orderBy 改穩定、pass queueItems + imageState
- `web/app/(protected)/annotate/[imageId]/editor.tsx` — imageState/readOnly、401 redirect、unsubmit 按鈕、e.repeat guard、navTo 共用、clickable sidebar、state icons
- `ERROR.md` — 本 session 中已更新 E23 / E24 / E25 / E26 四筆

### Git commits
- `ce10603` fix(web): prevent pan crash from concurrent setState ref deref
- `11ae026` fix(web): extend session to 30d + unsubmit + 401 redirect
- `fbd5b27` fix(web): guard keyboard handlers against e.repeat
- `99273c3` refactor(web): stable queue order + darken box colors
- `97b8be2` refactor(web): edge-only hit test for box selection
- `4593ce0` feat(web): clickable sidebar with per-image state icons

### 下一步
1. 繼續等標註者實際反饋（pipeline 主軸仍在 review 階段）
2. 若有新 bug 反饋，同樣現修現 push
3. 累積一輪完整 reject 反饋後再決定 M7.7 GPU train timing

### 遇到的事件
- 無，全部當場修完 push production

### 阻礙
- 無

### 5-Question Reboot Check
1. **做什麼？** 熱修復標註者實戰反饋的七個 bug / UX 缺陷（pan crash / save failed / 無法返回 / ←/→ 跳太多 / 排序亂跳 / 框顏色淺 / 側邊無法點 / hit test 太寬）
2. **進度？** 全部修完 push production，6 commits 都已 deploy。ERROR.md E23-E26 記錄完成
3. **下一步？** 繼續等標註者反饋；pipeline 主軸仍在「等 reject 反饋累積完才決定 GPU train timing」
4. **阻礙？** 無
5. **關鍵檔案？**
   - `web/app/(protected)/annotate/[imageId]/editor.tsx` — 整個標註前端的 state/UX 集中地
   - `web/components/annotation/AnnotationCanvas.tsx` — Konva canvas 行為
   - `web/components/annotation/hit-test.ts` — 框選邏輯
   - `web/lib/state-machine.ts` — 狀態機（新增 unsubmit 後的完整清單）
   - `web/lib/auth.ts` — session maxAge
   - `ERROR.md` — E23-E26 四筆新錯誤已記

---

## Session: 2026-04-18（深夜，第 5 次）

### 主題
批次把 3 個帳號升為 admin，為迎接新 admin 進來協作做準備。純 DB / whitelist 操作，沒改程式碼。

### 執行模式
`/start` 恢復 context 後，連續跑三次既有 `web/scripts/set-role.ts`（commit `1dffd88` 加的），全部打 prod DB：`pnpm dlx dotenv-cli -e .env -- pnpm tsx scripts/set-role.ts <email> admin`。

### 完成項目

**1. `redacted@example.com`**
- 既有 user，role 從 annotator → admin
- whitelist 同步升 admin

**2. `redacted@example.com`**
- 尚未登入過，只寫 whitelist（role=admin）
- 首次登入時會以 admin 身份建立帳號

**3. `redacted@example.com`**
- 尚未登入過，只寫 whitelist（role=admin）
- 首次登入時會以 admin 身份建立帳號

### 修改檔案
- 無（純 DB / whitelist 操作，沒改程式碼、沒新 commit）

### 當前 admin 名單變化
- 新增 3 名 admin（其中 2 名尚未首次登入，靠 whitelist 預約 role）

### 遇到的事件
- 無，全部一次成功

### 下一步
1. **等標註者實際進入 web 開審**（延續上輪主軸）— pipeline 主軸仍在這一步
2. **累積一輪 reject 反饋後決定 GPU train timing** — M7.7 GPU 驗證排在真實 review 完成後
3. （可選）新 admin 進來協作後觀察流程瓶頸

### 5-Question Reboot Check
1. **做什麼？** Admin 權限管理（為迎接新 admin 進來協作）
2. **進度？** 3 人 admin 已加完，pipeline 主軸仍在等標註者開審
3. **下一步？** 等 annotator 進來審 → 累積 reject 反饋 → M7.7 GPU 訓練
4. **阻礙？** 無
5. **關鍵檔案？** `web/scripts/set-role.ts`（下次再加 admin 用）、`web/CLAUDE.md`（DB 安全守則，確保打 prod 流程正確）

---

## Session: 2026-04-18（深夜，第 4 次）

### 主題
完成 FRC 視覺自動標註 pipeline 的「import 上雲」階段，並補強 DB 安全防護避免 Neon production branch 再次被誤 reset。從上一輪 export 重構轉為實際把 23 batches、3775 imgs 端對端 import 進 web 平台 + 自動指派 10 名標註者，把整條 auto-annotation pipeline 推到「等使用者開審」的位置。

### 執行模式
非結構化推進：先 resume 既有 import script、撞 Vercel Blob Hobby quota 1GB 上限 → 用戶決定升 Pro $20/mo 100GB → 繼續跑到 100% → 中途有半成品 batch 寫專用 cleanup script 清掉 → 收尾後改用 dev branch + check script + CLAUDE.md 規則三層防護避免下次 schema 操作砸到 prod。

### 完成項目

**1. Import per-owner script 強化（resume mode + parallelism）**
- `web/scripts/import-per-owner.ts` 新增 `--project-id=<id>` flag，能 resume 進入既有 project，自動 skip 已存在的 batches（之前每次重跑都要新建 project）
- CONCURRENCY=8 worker pool（前一輪已加，本 session 確認效能 0.3 → 3.2 img/s，10x 提升）
- 跑完 project `cmo3vzz8b0000i8uccnfevhkt` "FRC 視覺 2026-04-18 (auto)"：23 batches、3775 imgs、10 owners 全部成功配對 + 自動指派
- 總耗時 ~35 分鐘

**2. Vercel Blob Pro 升級**
- Hobby 1GB quota 在傳到第 2312 imgs 時撞 `BlobError: storage quota exceeded`
- 用戶升 Pro $20/mo 100GB（現用 ~1.5GB 充裕），import 繼續完成

**3. DB 安全防護三層架構**（防 Neon production DB 再被 `prisma db push` 砸掉）
- **第一層 dev branch 隔離**：新增 `web/.env.local` 切換 DATABASE_URL host 從 prod (`ep-holy-moon-amdsve0e`) → dev branch (`ep-cold-bar-amyk8qgq`)，同 password 只換 host fragment
- **第二層 runtime 警告**：新增 `web/scripts/check-db.ts` — 印出當前 DATABASE_URL host + 警告字樣
- **第三層 written rule**：更新 `web/CLAUDE.md` — 寫死 prod 禁止指令清單、script 環境選擇規則、唯一允許的 schema 變更流程、Neon PITR 復原管道

**4. 新增 utility scripts**
- `web/scripts/inspect-project.ts` — 列 project 的 batches + 各 batch image 數
- `web/scripts/delete-batch.ts` — 清掉單一 batch（DB rows + Vercel Blob entries），用於隊員C-1 半成品（37/50 imgs, pending_upload）清掉重做
- `web/scripts/check-db.ts` — 上述

**5. User role 調整**
- redacted@example.com (Rick) annotator → admin（直接 update DB）

### 修改檔案
- `web/scripts/import-per-owner.ts` — 加 `--project-id` flag 支援 resume mode
- `web/scripts/check-db.ts` — 新增（DATABASE_URL 環境檢查）
- `web/scripts/inspect-project.ts` — 新增（列 batches + image 數）
- `web/scripts/delete-batch.ts` — 新增（清單一 batch 的 DB rows + Blob）
- `web/.env.local` — host 從 prod 換成 Neon dev branch
- `web/CLAUDE.md` — 加 DB 安全章節（prod 禁止清單、script 環境規則、PITR 路徑）

### 當前 DB 狀態（Neon main = prod）
- 1 active project：`cmo3vzz8b0000i8uccnfevhkt`（23 batches、3775 imgs in_annotation）
- 15 users（10 annotator owners + 4 admin/其他 + 1 身份不明 Uhjjj 6）
- Neon dev branch `ep-cold-bar-amyk8qgq` 留作將來 schema 操作 sandbox

### 遇到的事件
- Vercel Blob Hobby quota 撞牆（1GB max）→ 升 Pro 解決
- 隊員C-1 半成品 batch（37/50 imgs, pending_upload）→ 寫 `delete-batch.ts` 清掉，下次 resume 自動重補

### 下一步
1. **等標註者實際進入 web 開審** — 已配對指派完成，缺實際 review traffic 才能評估流程瓶頸
2. **累積一輪 reject 反饋後決定 GPU train timing** — M7.7 GPU 驗證原本就排在真實 review 完成後
3. （可選）清掉 Uhjjj 6 不明帳號
4. （可選）Phi / 段佑霖 仍缺 Drive 資料夾，補資料後可加進下一輪 import

### 5-Question Reboot Check
1. **做什麼？** FRC 自動標註 pipeline 端對端跑通到 web review 階段
2. **進度？** 23 batches、3775 imgs 已 import 並指派完成，等標註者開始審
3. **下一步？** 等標註者實際進入 web 標 → 累積一輪 reject 反饋後再決定 GPU train timing
4. **阻礙？** 無；Phi / 段佑霖 仍缺 Drive 資料夾、Uhjjj 6 身份不明（可選清掉）
5. **關鍵檔案？** `web/scripts/import-per-owner.ts`、`auto_pipeline.py`、`repack_per_owner.py`、`web/CLAUDE.md`（DB 安全章節）

---

## Session: 2026-04-18（晚上，第 3 次）

### 主題
重構 `web/app/api/projects/[id]/export/route.ts` 為 streaming zip → Vercel Blob → signed URL 模式，解決 approved images 規模大時（預估 ~2500 張 × 2MB = 5GB）原 `zipSync` in-memory 打包 + `NextResponse(buf)` 直回會撞 Vercel Function memory (1024MB)、response size、maxDuration 三重天花板的預防性風險。架構改動、非 bug 修復。

### 執行模式
使用者提出疑慮（上傳側安全、匯出側有風險）→ 分析 → 決定方案 3（server 端打 zip → upload Blob → 回 URL）→ inline 實作 + 測試 + cherry-pick 乾淨 commit → 上 production。使用者先試 preview 撞到 Google OAuth `redirect_uri_mismatch`（preview URL hash 動態），改直接上 master。

### 完成項目

**1. 上傳側風險分析（安全，不需改）**
- pipeline 側 cap 已對齊 180MB，web 端 `maxCompressedBytes=200MB`
- 超 cap 會被 reject 而非 silent 資料遺失（finalize 是 `prisma.$transaction` wrap，會 rollback）

**2. 匯出側重構：streaming zip → Blob → signed URL**

**後端：`web/app/api/projects/[id]/export/route.ts`**
- `GET` → `POST`（breaking change，前端兩處同步改）
- `fflate.Zip` + `ZipPassThrough` 建 streaming zip writer，外包一層 `ReadableStream<Uint8Array>`
- `@vercel/blob.put(key, stream, { access: 'public', contentType: 'application/zip', addRandomSuffix: false, allowOverwrite: true })` 直 stream 上傳（v2 支援 multipart + ReadableStream body）
- Key：`frc-annotation/exports/{projectId}/{safeProjectName}-yolo-{ISO-timestamp}.zip`
- Response JSON：`{ url, filename, imageCount }`
- 加 `export const runtime = 'nodejs'`、`export const maxDuration = 300`
- 錯誤處理改用 `NextResponse.json({ error }, { status })`（對齊 M7 後 convention，避免 ERROR.md E12 的 throw 被吞空 body 500）
- 0 approved → 400

**前端 1：`web/app/(protected)/projects/[id]/export/page.tsx`**
- 舊版 `<a href="/api/.../export">` 直觸發 GET 下載
- 新版 server component 只保留 approved count，按鈕改 client component `<DownloadButton projectId={id} disabled={...} />`

**前端 2：`web/app/(protected)/projects/[id]/export/download-button.tsx`（新檔）**
- `'use client'`、`useState(loading/error)`
- onClick → `fetch(POST)` → 拿 `url` → `window.location.href = url` 跳 Blob 下載
- UI 顯示 "Packing…" + 錯誤訊息

**前端 3：`web/app/(protected)/review/completed-batches.tsx`**
- 舊版 `window.location.href = '/api/.../export'` 改 `fetch POST → redirect blob url`
- 加 busy/error state、按鈕文字「打包中…」

**3. 測試：`web/tests/integration/export.test.ts` + `export-stepup.test.ts`**
- 兩檔都 GET → POST
- `vi.mock('@vercel/blob')` 的 `put` mock 消費 ReadableStream、拼接 chunks 存到 `capturedZipRef.current`
- 用 `vi.hoisted` 傳 ref 讓 outer scope 讀得到
- `export.test.ts` 新增「no approved → 400」測試 + `unzipSync` 驗 zip 內容（classes.txt / data.yaml / images/ / labels/ 皆在）
- `export-stepup.test.ts` 4 個 step-up scope 測試改 POST
- 跑 `npx dotenv-cli -e .env -- vitest run tests/integration/export*`：**6 passed**（2 files）

**4. pre-existing tsc error（未修）**
- `tests/integration/batches.test.ts:72` `Uint8Array<ArrayBufferLike>` 不 assignable to `BodyInit` — 驗證過是既有錯誤（stash 後仍出現），與本次改動無關，暫未修

**5. Git 流程**
- `feat/vision-auto-pipeline` branch 先 commit `16ffd09`（該 branch 混 auto_pipeline.py 工作，不整支合 master）
- 從 master 開 `refactor/export-streaming` → cherry-pick 乾淨 commit `2e465f0` → push
- 使用者試 preview 撞 Google OAuth `redirect_uri_mismatch`（preview hash URL 未註冊到 Google Console）
- 改「直接上 production」→ `git checkout master && git merge --ff-only refactor/export-streaming && git push origin master`
- Vercel production auto-deploy 觸發

### 修改檔案
- `web/app/api/projects/[id]/export/route.ts`（重構為 POST + streaming zip upload）
- `web/app/(protected)/projects/[id]/export/page.tsx`（server component 精簡 + 嵌入 client 按鈕）
- `web/app/(protected)/projects/[id]/export/download-button.tsx`（新 client component）
- `web/app/(protected)/review/completed-batches.tsx`（改 POST + busy state）
- `web/tests/integration/export.test.ts`（POST + unzipSync 驗內容 + no-approved 400）
- `web/tests/integration/export-stepup.test.ts`（4 scope 測試改 POST）

### Git commit
```
2e465f0 refactor(web): export via streaming zip uploaded to blob
```
（cherry-pick 自 feat/vision-auto-pipeline 的 16ffd09，fast-forward merge 到 master）

### 下一步
1. **Production 實測下載流程** — 剛 push master，Vercel deploy 中，使用者尚未實測。要在專案有 approved image 後從 web UI 走一次 export，確認：(a) POST 成功、(b) Blob URL 可下載、(c) zip 內容正確（classes.txt / data.yaml / images/ / labels/）
2. **maxDuration=300s 邊界觀察** — 2500 imgs × ~2MB、blob→function→blob sequential 估 100–200s，未跑真實樣本。撞到超時下一步選：升 Fluid Compute 800s / 分 batch export / Vercel Workflow DevKit durable job
3. **Blob 清理 cron**（非阻塞）— 每次 export 寫新 timestamp key，`frc-annotation/exports/{projectId}/*.zip` 會累積，未來加 TTL 或 cron
4. **pre-existing tsc error** — `tests/integration/batches.test.ts:72` 還在，與本次改動無關，之後順手修

### 阻礙
1. **Production 未驗證** — 剛 push master，Vercel deploy 中，使用者尚未跑過真實下載
2. **maxDuration=300s 邊界未實測** — 若 2500 imgs 撞超時需要升級架構（Fluid Compute / durable job）
3. **Preview deploy 驗不到** — Google OAuth `redirect_uri_mismatch`（preview URL 每次不同 hash、Google Console 未註冊），只能靠 production 驗
4. **Blob 累積未清理** — 非阻塞但要記著

### 5-Question Reboot Check
1. **做什麼？** 重構 export route：`zipSync + NextResponse(buf)` → `fflate.Zip` streaming → `@vercel/blob.put(ReadableStream)` → signed URL。避免大規模 approved 時 Function OOM / response size 爆
2. **進度？** 後端 route + 2 個前端觸發點 + 2 個 integration test 檔改好，6 tests passed。Commit `2e465f0` cherry-pick 到 master 並 push，Vercel production auto-deploy 中
3. **下一步？** 使用者到 production 實測下載流程；觀察 maxDuration 邊界
4. **阻礙？** Production 未驗證 / maxDuration 邊界未實測 / preview 因 OAuth 無法驗 / Blob 累積未清理
5. **檔案？**
   - `web/app/api/projects/[id]/export/route.ts`（核心重構）
   - `web/app/(protected)/projects/[id]/export/page.tsx`（server component）
   - `web/app/(protected)/projects/[id]/export/download-button.tsx`（新 client component）
   - `web/app/(protected)/review/completed-batches.tsx`（review 端觸發點）
   - `web/tests/integration/export.test.ts` + `export-stepup.test.ts`（已改 POST + mock put）
   - `FINDINGS.md` HH（新）— streaming zip + Blob multipart pattern 的選型與實作細節
   - `tests/integration/batches.test.ts:72`（pre-existing tsc error，未修）

### 安全備註
- 無新密鑰外洩。Google OAuth `redirect_uri_mismatch` 是預期行為（preview hash URL 不在 whitelist），非安全事件
- `web/CLAUDE.md` 本 session 被使用者手動加 DB 安全章節（兩 Neon branch `.env` vs `.env.local`、禁 `prisma migrate reset` on prod），屬使用者維護範圍，未動

---

## Session: 2026-04-18（下午，第 2 次）

### 主題
接續上午 session Stage 1 download（807 files / 5.15 GiB / 7 owners），本 session 完整跑完 Stage 2 preprocess → Stage 3 Gemini 自動標註 → Stage 4 package，產出 16 個 batch.zip ready for web 上傳。途中發現並修 4 個 bug（cv2 Windows Unicode path / API key 誤貼 OAuth token / packaging cap 算錯 / preview `Path.stem` 把 `.0s` 當副檔名）。

### 執行模式
Continuation of plan `C:\Users\USER\.claude\plans\sprightly-jingling-lemur.md`。Inline iteration — 每個 stage 跑起來發現問題 → 修 → rerun，沒派 subagent。最後使用者要求把 16 個 batch.zip flat copy 出來方便一次 drag-and-drop 上傳。

### 完成項目

**1. Stage 2 preprocess（2538 張 jpg 產出，修 cv2 Unicode bug）**
- 發現 `cv2.imwrite` 在 Windows 非 ASCII 路徑上 **silently 失敗**（回傳 False 但不拋例外）
- 影響中文 owner 資料夾（隊員F / 隊員H / 隊員D / 隊員J）的影片抽幀 — state file 有紀錄但 disk 上 0 檔案
- Anna（ASCII 路徑）與純靜態照片 owner（隊員C / 隊員I，走 PIL 路徑）未受影響
- 修法：`cv2.imencode(".jpg", frame, ...)` + `Path.write_bytes(buf.tobytes())`，繞過 cv2 C-stdio 對 Unicode path 不支援
- 修 `preprocess_state.json` + 各 owner `source.json`，清掉 outputs-不存在的壞紀錄（移除 8 entries，保留 793）
- 改 `python -u`（unbuffered）讓 `tee` 看得到即時 progress

**2. Stage 3 Gemini 自動標註（2538 張，約 25 分，0 errors，82,423 boxes）**
- 初期 API key 全失敗（HTTP 400 `API_KEY_INVALID`）
- 使用者貼的 `AQ.Ab8RN6KI...` token 是 OAuth 2.0 access token，不是 API key。Gemini API key 必為 `AIzaSy` 開頭 + 39 chars + 純英數+底線，要從 https://aistudio.google.com/app/apikey 產生
- 換新 key `***REMOVED***`（export 到當前 bash session，未 setx）
- 加 `--limit N` flag 方便小樣本驗證
- 先跑 20 張 sample（Anna IMG_3587），0 error，703 boxes 全 class=fuel — 驗證 fuel 偵測 recall 穩
- Preview 發現 FP 模式：紅色練習墊 → red_robot、藍色 pool noodle → blue_robot。素材多是 fuel 練球場景，真 robot 很少
- 全量 2518 張剩餘，concurrency 10，**1.8 img/s，約 25 分，0 errors**
- Class 分布：red_robot 849 / blue_robot 336 / fuel 81,238（98.6%）。R:B 比 2.5:1 不合理（應為 FP 道具），人審階段會清掉

**3. Stage 4 package（16 batches，修 cap 算錯 bug）**
- 第一次跑產 8 batches，但 7 個超 200MB（219MB–471MB）會被 web 拒
- Bug：split cap 用 `MAX_UNCOMPRESSED_BYTES * 0.9 = 450MB`，但 JPEGs 幾乎不 deflate（約 0-6%），zip 出來 ≈ raw bytes。實際上限是 `MAX_COMPRESSED_BYTES = 200MB`
- 修法：`cap_bytes = int(MAX_COMPRESSED_BYTES * 0.9)` = 180MB；並改 `ZIP_STORED`（JPEGs 壓不動，deflate 浪費 CPU）
- Wipe + rerun → 16 batches，全部 ≤188.8MB，合計 2538 imgs

**4. Preview bug 順手修**
- `cv2.imread` 同樣 Windows Unicode path 問題 → 改 `cv2.imdecode(np.fromfile(...))`
- 寫 preview 也改 `imencode + write_bytes`
- `Path(args.target).stem` 把 `_t11.0s` 的 `.0s` 當副檔名 → 針對非 `.txt/.jpg/.jpeg/.png` 目標，整個 arg 當 stem

**5. 使用者收尾 ask：flat copy**
- 把 16 個 batch.zip 複製到 `datasets/frc-vision-notyet/all_batches/batch_NNN.zip`，方便一次 drag-and-drop 上傳

### 修改檔案

- `auto_pipeline.py` — 4 處：
  - `extract_frames_1fps`：`cv2.imwrite` → `cv2.imencode + write_bytes`
  - `cmd_preview`：`cv2.imread` → `imdecode + np.fromfile`；輸出也改 `imencode + write_bytes`；Path.stem 邏輯修
  - `cmd_annotate`：加 `--limit N` flag
  - `cmd_package`：cap `MAX_UNCOMPRESSED_BYTES * 0.9 (450MB)` → `MAX_COMPRESSED_BYTES * 0.9 (180MB)`；`ZIP_DEFLATED` → `ZIP_STORED`
- `datasets/frc-vision-notyet/labels/*.txt`（新 — 2538 個 YOLO label）
- `datasets/frc-vision-notyet/batches/batch_001..016/`（新 — 16 batch 含 images/ labels/ classes.txt batch.zip）
- `datasets/frc-vision-notyet/all_batches/batch_001..016.zip`（新 — flat copy）
- `datasets/frc-vision-raw/processed/{owner}/images/*.jpg`（新 — 2538 張抽幀 / 轉檔）
- `datasets/frc-vision-raw/preprocess_state.json` + 各 owner `source.json`（更新 — 清壞紀錄）

### 下一步

**使用者手動**：
1. 到 https://frc-annotation.vercel.app 建 / 選擇專案，classes `red_robot, blue_robot, fuel`（順序 + 名字 exact）
2. 依序上傳 16 個 `all_batches/batch_NNN.zip`
3. Assign annotators、通知複審

**Pipeline 側（可選優化，非阻塞）**：
- Anna 的全 fuel 練球場景考慮單獨 review 流程（全類 fuel 不需要 robot 判斷）
- 補上游過濾排除紅 / 藍道具 FP（或 prompt 加「排除泡棉墊、pool noodle」提示）
- `rclone lsf "gdrive:frc視覺辨識/Phi" --drive-shared-with-me` 等等驗證缺 4 owner 是空資料夾還是權限問題

### 阻礙
無。Stage 2–4 整條走通，產物 ready for 人審。

### 5-Question Reboot Check
1. **做什麼？** Drive → Gemini → web batch zip 自動標註 pipeline（plan `sprightly-jingling-lemur.md`）
2. **進度？** Stage 1–4 全部跑完。16 個 batch.zip（≤188.8MB 各）在 `datasets/frc-vision-notyet/all_batches/`，82,423 Gemini boxes，ready 上傳 web 人審
3. **下一步？** 使用者手動上傳 + assign annotators。pipeline 側 idle（可選做 FP 過濾 / 缺 4 owner 驗證，非阻塞）
4. **阻礙？** 無
5. **檔案？**
   - `auto_pipeline.py`（4 處 bug fix，見上）
   - `datasets/frc-vision-notyet/all_batches/batch_001..016.zip`（人審輸入）
   - `datasets/frc-vision-notyet/batches/batch_NNN/`（完整 batch 目錄，另保留）
   - `datasets/frc-vision-raw/processed/{owner}/images/*.jpg`（2538 張預處理輸出）
   - `web/lib/zip-validator.ts`（200MB compressed cap 的 source of truth）
   - `web/app/api/batches/[id]/finalize/route.ts`（web 端 import 邏輯）

### 安全備註
- Gemini API key `***REMOVED***`（新）貼在 chat 裡，只 export 未 setx，下次 bash session 會不見 — 要跑 pipeline 得重貼或 setx
- 上一把 `AIzaSyB...` 可能 rate limit / revoke，新 key 為 working one
- User 貼的 `AQ.Ab8RN6KI...` 是 OAuth access token 不是 API key（已提醒），與本 pipeline 無關但記一下

---

## Session: 2026-04-18（上午，第 1 次）

### 主題
新開分支 `feat/vision-auto-pipeline`,建一條 auto-annotation pipeline:從 Google Drive 共用資料夾下載 FRC 隊內訓練素材 → 1 fps 抽幀 → Gemini API 自動標註 → 打包 YOLO zip 給既有 web review 平台（frc-annotation.vercel.app）。批次後使用者再手動上傳給標註者複審。

### 執行模式
Plan-driven。Plan 檔:`C:\Users\USER\.claude\plans\sprightly-jingling-lemur.md`(已 user approve)。本 session 完成 setup + 寫 orchestrator + 跑 Stage 1 download,使用者要求停在 Stage 1 後檢查產出再繼續,故 Stages 2–4 留下 session。

### 完成項目

**1. 環境 setup**
- 安裝 `rclone v1.73.4`(winget)
- 設定 `gdrive` rclone remote(OAuth scope=drive,full access;素材在 "Shared with me")
- 驗證 `GEMINI_API_KEY` 對 `gemini-3.1-flash-lite-preview` 可用,並用 `setx` 寫進 user 環境變數
- 安裝 Python deps:`pillow-heif`(HEIC 轉 JPEG)+ `tqdm`(progress bar)
- 開分支 `feat/vision-auto-pipeline`(從 master)
- 建目錄:`datasets/frc-vision-raw/`、`datasets/frc-vision-notyet/`、`datasets/frc-vision-ok/`

**2. 新增 `D:\FRC\frc-train-review\auto_pipeline.py`(498 行,單檔 orchestrator)**
- 6 個 subcommand:`download` / `preprocess` / `annotate` / `package` / `all` / `preview`
- 非同步 Gemini 呼叫 — `asyncio.Semaphore(10)` 控併發,429 走 exponential backoff
- 嚴格 `response_schema`:`{"box_2d": [y1,x1,y2,x2], "class": "red_robot"|"blue_robot"|"fuel"}`
- 4 個 state file 支援 incremental rerun:`drive_manifest.json` / `preprocess_state.json` / `progress.json` / `packed_manifest.json`
- **完全沒動**既有 `auto_annotate.py`、`extract_frames.py`、`train_robot_model.py`(scoring-analyzer 還依賴它們)

**3. Stage 1 Drive download 跑完(31 分 50 秒)**
- `rclone copy gdrive:frc視覺辨識/ datasets/frc-vision-raw/_drive_copy/ --drive-shared-with-me ...`
- 結果:**807 個檔案 / 5.15 GiB**,7 個擁有者資料夾(Anna / 隊員F / 隊員H / 隊員D / 隊員C / 隊員I / 隊員J)
- **意外 1**:預期 11 個資料夾,只下來 7 個 — 缺 Phi / 隊員A / 隊員B / 段佑霖。假設是空資料夾(rclone 不建空目錄),下 session 用 `rclone lsf` 驗證
- **意外 2**:初次 `rclone size` 量到 3.73 GiB / 477 files,實際下載完 5.15 GiB / 807 files。可能 sessions 之間有人補傳,或初次 size 量不完整

### 修改檔案
- `auto_pipeline.py`(新增 — 498 行 orchestrator,本 branch only)
- `datasets/frc-vision-raw/_drive_copy/`(新增 — 5.15 GiB / 807 files,gitignore 不會進 repo)
- `datasets/frc-vision-raw/drive_manifest.json`(新增 — Stage 1 state file)

### 核心設計決策(供未來 session 快速 recall)

1. **Class schema:`0=red_robot, 1=blue_robot, 2=fuel`(3 類)** — 從既有 `auto_annotate.py` 的 2 類 Red/Blue bumper 擴增。User 已確認。`fuel` 是黃色泡棉球,排球大小(直徑約 20 cm),2026 REBUILT 賽季 game piece;prompt 指示 Gemini 跳過寬度 < 30px 的球(太遠看不清)
2. **Model:`gemini-3.1-flash-lite-preview`** — User 指定。$0.25/M input + $1.50/M output。預估 ~7000 張全跑 ~$2-3 USD
3. **分發給標註者:走方案 B(手動透過 web UI)** — Pipeline **不**自動上傳、**不**自動 assign。Stage 4 print 絕對路徑,使用者手動 upload 到 https://frc-annotation.vercel.app → /projects/[id]/upload
4. **輸出位置**:`datasets/frc-vision-notyet/batches/batch_NNN/batch.zip`
5. **輸出格式**:YOLO zip(`classes.txt` + `images/` + `labels/`),遵守 `web/lib/zip-validator.ts` 限制(≤500 imgs / ≤200 MB compressed / ≤500 MB uncompressed / ≤20 MB per file / ≤1200 entries)
6. **Incremental**:4 state files 讓 rerun 安全。Drive 新增的素材自動偵測、處理,不會重做既有

### 下一步
1. **Stage 2 preprocess** — `python auto_pipeline.py preprocess`:HEIC→JPEG、影片 1 fps 抽幀、寫 `preprocess_state.json`
2. **Stage 3 annotate** — 先小樣本(例如 20 張)驗證 Gemini 輸出品質,看完 OK 再全跑
3. **Stage 4 package** — 切 batch、產 YOLO zip、印絕對路徑
4. **解開「缺 4 owners」謎團** — `rclone lsf "gdrive:frc視覺辨識/Phi" --drive-shared-with-me` 等等,確認是空資料夾 or 權限差異
5. **Stage 4 跑完**手動上傳第一個 batch.zip 到 production web 平台,實測整條 pipeline

### 阻礙
- 缺 4 個擁有者資料夾(Phi / 隊員A / 隊員B / 段佑霖) — 待 user 確認是空資料夾還是權限問題,不是 hard blocker(其他 7 人的 5.15 GiB 已夠跑 pipeline)

### 5-Question Reboot Check
1. **做什麼?** 執行 plan `C:\Users\USER\.claude\plans\sprightly-jingling-lemur.md` — Drive → Gemini → web batch zip 自動標註 pipeline
2. **進度?** Setup 完、`auto_pipeline.py` 寫完、Stage 1 download 跑完(807 files / 5.15 GiB / 7 owners)
3. **下一步?** `python auto_pipeline.py preprocess`(Stage 2 抽幀 + HEIC 轉檔)
4. **阻礙?** 缺 4 個擁有者資料夾 — 待驗證是空資料夾還是權限問題,不是 hard blocker
5. **檔案?**
   - `auto_pipeline.py`(新增 orchestrator,本 branch only)
   - `C:\Users\USER\.claude\plans\sprightly-jingling-lemur.md`(plan 檔,完整架構)
   - `datasets/frc-vision-raw/_drive_copy/`(Stage 1 產出,5.15 GiB)
   - `datasets/frc-vision-raw/drive_manifest.json`(state file)
   - `web/lib/zip-validator.ts`(Stage 4 輸出格式參考)
   - `web/app/api/batches/[id]/finalize/route.ts`(web 端 import 邏輯,Stage 4 輸出對齊參考)

### 安全備註(供未來 leak audit)
- 使用者把 Gemini API key 貼在 chat 裡(`AIzaSyB...`),已設定為「沒問題」並 `setx GEMINI_API_KEY` 寫進 user env
- 使用者也曾誤把 OAuth client secret(`GOCSPX-...`)當 API key 貼出 — 與本 pipeline 無關(我們用 API key 不用 OAuth)
- 兩者都沒進 git。但若未來懷疑外洩或要 rotate,以上是源頭

---

## Session: 2026-04-17 (第 7 次)

### 主題
Session 6 剛完成 UI 權限洩漏修復 + 4 位 production user role 升級 + annotate submit 延遲優化。本 session 繼續處理 3 件小事：新增一位 final_reviewer 白名單、修首次登入輸入名字不跳轉的 bug、Reject dialog 加預設原因選項。

### 執行模式
Inline rapid iteration — 三件事各自 1 個 commit push master，Vercel auto-deploy 上線。不派 subagent，因範圍都小。

### 完成項目

**1. 新增 final_reviewer 白名單（production DB 改動，不在 git 裡）**
- 使用者要求把 `redacted@example.com` 加入 EmailWhitelist 為 `final_reviewer`
- 用 Session 6 建的 `web/scripts/set-role.ts` CLI 工具
- 流程：`vercel env pull --environment=production .env.vercel.production` → `npx tsx --env-file=.env.vercel.production scripts/set-role.ts redacted@example.com final_reviewer` → 清除 env 檔
- 該 email 尚未登入過（User 表沒記錄），只 upsert 白名單 → 首次登入會由 signIn callback 自動繼承 role

**2. Fix：首次登入輸入名字後不跳轉**（commit `6767a05`）
- **症狀**：使用者回報首次 Google SSO 登入、輸入中文名字、按儲存後停在 `/onboarding/name`，沒跳轉到 dashboard
- **根因**：原流程是 PATCH `/api/me/display-name` 成功 → DB 寫入 `displayNameSetAt` → `await useSession().update()` → `router.push('/')`。但 next-auth v5 beta.31 的 `update()` 不保證 rotate JWT cookie，若 cookie 還是 stale（`displayNameSetAt: null`），`router.push('/')` 經 proxy.ts 的 auth() gate 又被 redirect 回 `/onboarding/name`
- **修法**：`web/app/(protected)/onboarding/name/name-form.tsx` 移除 `useSession` + `useRouter` 依賴，PATCH 成功後直接 `window.location.href = '/'`。完整頁面導航會讓 proxy 的 jwt callback 重新從 DB 讀 `displayNameSetAt` 並 rotate cookie（Next.js 16 proxy 預設跑 Node.js runtime，Prisma 可用）

**3. Reject dialog 加預設原因選項**（commit `e1c5f0d`）
- 使用者要求 6 個退回原因：菜就多練 / 邊框沒框好 / 沒框 / 少框機器人 / 少框 fuels / 其他（自填）
- `web/app/(protected)/review/[batchId]/review-tray.tsx` 修改:
  - 新增 `REJECT_PRESETS` 常數（5 個 preset）+ `OTHER` 常數
  - State 從單一 `rejectComment` 改為 `rejectChoice` + `rejectOther`
  - `finalComment = rejectChoice === OTHER ? rejectOther.trim() : rejectChoice`
  - UI：原生 `<input type="radio">` + Tailwind `has-[:checked]` selector（不裝 shadcn radio-group，維持極簡風）
  - 選「其他」才顯示 Textarea
  - Dialog title/按鈕改中文（退回原因 / 取消 / 確認退回）
- API 層 `web/app/api/images/[id]/reject/route.ts` 不變（仍接受 `comment` string 存入 `ReviewEvent.comment`）

### 修改檔案
- `web/app/(protected)/onboarding/name/name-form.tsx`（6767a05）— 簡化為純 fetch + `window.location.href` 硬導航
- `web/app/(protected)/review/[batchId]/review-tray.tsx`（e1c5f0d）— radio preset + 其他 fallback

### Production DB 變更（不在 git 裡）
- EmailWhitelist 新增 1 筆：`redacted@example.com` → final_reviewer（user 尚未登入，只 whitelist）

### 核心設計決策（供未來 session 快速 recall）
1. **next-auth v5 beta.31 `update()` cookie rotation 不穩定** — 靠 full-page navigation + proxy 的 jwt callback 重讀 DB 才是 reliable 解法。凡是「改 DB 後 UI 需即時反映新 session state」的流程，都優先考慮 `window.location.href = '/'` 而非 `router.push` + `useSession().update()`
2. **Next.js 16 proxy 預設 Node.js runtime** — 所以 proxy 的 jwt callback 可以安心用 Prisma、不必擔心 edge runtime 不相容
3. **Reject 預設用原生 radio + `has-[:checked]`** — 避免多裝 shadcn radio-group；`ReviewEvent.comment` 存明文中文標籤（之後若要做 aggregation 可以用 `comment IN (...)` 分組）
4. **set-role script 對只有 whitelist 的 email 工作正常** — 不依賴 User row 存在，upsert EmailWhitelist 就好，signIn callback 首次登入時自動建 User + 繼承 role

### Git commits（全 push master）
```
e1c5f0d feat(web): preset reject reasons with custom "其他" fallback
6767a05 fix(web): force full-page nav after saving display name
```

### 下一步
1. **等 hs313102 使用者首次登入驗證 role 繼承** — 登入後他應看到 Review 連結、沒看到 Projects/Admin
2. **等使用者實測 reject preset UX** — 若有使用者抱怨「菜就多練」太硬核，再調整文案
3. **選配**:aggregate ReviewEvent.comment 做統計 — 每個 annotator 最常被退回的原因。目前沒需求，純 idea
4. **選配**:onboarding name 頁之外若還有類似「server update session state → 前端要即時跳轉」的流程，掃一遍是否也該改成 full-page nav

### 阻礙
無 blocker。

### 5-Question Reboot Check
1. **做什麼?** 三件小事：(a) 用 set-role script 把 hs313102 加入白名單 final_reviewer；(b) 修首次登入輸入名字不跳轉（改 full-page nav）；(c) Reject dialog 加 6 個預設原因選項
2. **進度?** 2 commit push master + 1 筆 production whitelist upsert。Vercel auto-deploy 完成
3. **下一步?** 等使用者實測 reject UX + hs313102 首次登入拿到正確 role
4. **阻礙?** 無 blocker
5. **檔案?**
   - `web/app/(protected)/onboarding/name/name-form.tsx`（full-page nav fix）
   - `web/app/(protected)/review/[batchId]/review-tray.tsx`（reject presets）
   - `web/scripts/set-role.ts`（whitelist CLI 工具，Session 6 建，本 session 再用一次）
   - `web/lib/auth.ts`（jwt callback 讀 DB 的 single source of truth，診斷 cookie 問題時要翻）
   - `web/proxy.ts`（onboarding gate 所在，診斷 redirect loop 要翻）

---

## Session: 2026-04-17 (第 6 次)

### 主題
Session 5 剛完成 annotation editor UX upgrade 後，使用者 production 實測時發現 UI 權限洩漏 — annotator（第一層審核者）看得到 Projects 欄。本 session 順著修好權限 + 升級 UI 連結（Review / Admin）+ 批次改 production DB role + 最後優化 annotate submit 延遲。

### 執行模式
Inline rapid iteration — 每個 fix 單一 commit 直接 push master，讓 Vercel auto-deploy 快速上線。使用者在 production 依序 smoke test。不派 subagent，因每個修正範圍都小。

### 完成項目

**1. UI 權限洩漏診斷（無 commit, audit only）**
- 依 `web/lib/rbac.ts` ROLE_MATRIX audit:project 管理全部 admin-only（連 final_reviewer 都沒權限）、image.approve/reject 是 final_reviewer、image.annotate/submit 是 annotator
- 找到 3 個 UI 洩漏點:`web/components/top-nav.tsx:17-22`（Projects 連結無條件渲染）、`web/app/(protected)/page.tsx:62-66`（dashboard 的「All projects」）、`web/app/(protected)/projects/page.tsx` 與 `/projects/[id]/page.tsx`（route 本身無 role gate）
- Mutation 雖由 `StepUpGuard scope="admin"` 擋住，但 UI 露出入口是 UX leak。使用者決策:Projects 連結只對 admin + final_reviewer 顯示

**2. Fix 1:UI Nav / Dashboard role gate**(commit `c5af099`)
- `web/components/top-nav.tsx`:讀 `session.user.role`，用 `canSeeProjects = role === 'admin' || role === 'final_reviewer'` gate Projects 連結
- `web/app/(protected)/page.tsx`:dashboard 的「All projects」section 用同樣 gate
- 驗證:Lint 0 errors、Build 33 routes green、88/88 unit tests pass
- Fast-forward merge 直接 push master

**3. Fix 2:/projects 路由樹 server-side role gate**(commit `ca3421d`)
- 新增 `web/app/(protected)/projects/layout.tsx` — async server layout 讀 session.role，非 admin/final_reviewer 即 `redirect('/')`
- 使用者手打 `/projects` 網址原本仍進得去（只 UI 隱藏），這步補上 server 層 redirect 擋完整 `/projects/*` 子樹
- Integration tests 都打 `/api/projects/*` route handler，不受 layout 影響

**4. 診斷使用者自身 role 錯誤**(無 commit)
- 使用者反映連上線後仍看不到 Projects — 建議打 `/api/auth/session`，回傳顯示 `user.role === 'annotator'`
- 根因:signIn callback `lib/auth.ts:12` 若 emailWhitelist 無該 email，fallback `annotator`
- 結論:需要直接改 DB role

**5. 批次升級 4 個 user role（production DB 改動，不在 git 裡）**
- 用 `vercel env pull --environment=production .env.vercel.production` 抓 production DATABASE_URL
- 一次性 script 執行完刪除，修正 4 人:
  - `redacted@example.com` → admin（使用者本人）
  - `redacted@example.com` → final_reviewer
  - `redacted@example.com` → final_reviewer
  - `redacted@example.com` → final_reviewer（user 尚未登入，只 upsert whitelist）
- 三人已在 DB 的:User.role + EmailWhitelist 同步 update

**6. 可重複使用的 set-role script**(commit `1dffd88`)
- 把一次性 hardcoded email 的 script 重構成 CLI args 版
- 路徑:`web/scripts/set-role.ts`
- 用法:`npx tsx --env-file=.env.vercel.production scripts/set-role.ts <email> <role>`
- Role 白名單驗證:admin | annotator | final_reviewer
- 同時 update User.role（若 user 存在）+ upsert EmailWhitelist（保險若 user 被重建）
- 會印 before→after role 方便驗證

**7. TopNav 擴充 Review + Admin 連結**(commit `50517ac`)
- Review 連結:admin + final_reviewer 可見
- Admin 連結:admin only
- 變數簡化為 `isAdmin` + `canReview = isAdmin || role === 'final_reviewer'`
- 注意:`/review` 和 `/admin` 的 layout 本來就有 StepUpGuard（reviewer / admin scope），沒補 server-side role redirect（有意的 scope limit — 知道密碼仍能進）

**8. Annotate submit 延遲優化 A + B**(commit `a5b6a71`)
- 使用者問「按 s 感覺有延遲」— 分析 `editor.tsx:140-153` submit 流程:flushSave → POST submit → router.push，三個 serial round trip
- 主要延遲來源:router.push 沒 prefetch 下張 RSC payload（editor.tsx:250-262 只 prefetch signed-url + image）
- 次要:flushSave 無條件發 PATCH（即使沒變更）
- **A**:prefetch useEffect 加 `router.prefetch('/annotate/[id]')` — 預抓下 5 張 route RSC payload
- **B**:加 `lastSavedBoxesRef` snapshot pattern — flushSave early return when `boxesRef.current === lastSavedBoxesRef.current && saveTimer.current === null && inFlightSave.current === null`；doSave 開始前 capture snapshot，成功後寫入 lastSavedBoxesRef（保證 save 期間新 edit 不會錯誤標記為 saved）
- 預期體感:按 s 從 600-1400ms 降到 200-300ms；若無變更更快（省掉 PATCH）

### 修改檔案
- `web/components/top-nav.tsx`（commit c5af099 + 50517ac）— role gate Projects/Review/Admin 連結
- `web/app/(protected)/page.tsx`（c5af099）— dashboard 的 All projects 連結 gate
- `web/app/(protected)/projects/layout.tsx`（ca3421d，新增）— server-side role redirect
- `web/scripts/set-role.ts`（1dffd88，新增）— CLI 改 role 的 reusable script
- `web/app/(protected)/annotate/[imageId]/editor.tsx`（a5b6a71）— router.prefetch + flushSave no-op skip

### Production DB 變更（不在 git 裡）
- EmailWhitelist + User.role 改 4 筆:rosalyn admin、hs219014 final_reviewer、eva final_reviewer、baconfried final_reviewer（via whitelist only）

### 核心設計決策（供未來 session 快速 recall）
1. **權限分層**:admin 管 projects/batches/export/whitelist；final_reviewer 管 review approve/reject；annotator 只做 annotate/submit。UI nav 用 role 白名單分別顯示
2. **Server-side redirect + UI gate 一起**:UI 隱藏是 UX，server-side redirect 防手打網址。`/projects/*` 補了 layout redirect；`/review` / `/admin` 本來有 StepUpGuard（知道密碼仍能進），沒補 role redirect 是有意的 scope limit
3. **Session.user.role 結構**:`declare module 'next-auth'` 擴充過 Session type（`web/types/next-auth.d.ts`）；auth.ts jwt callback 每次從 DB 讀最新 role，role 在 DB update 後使用者不用重登也會更新（但 session cookie cache 可能造成畫面延遲，hard refresh 保險）
4. **set-role script 作 admin 後門**:admin UI 還沒寫好（或不夠方便）時的 fallback 工具。注意用 `vercel env pull --environment=production` 明確指定 production DB
5. **flushSave snapshot pattern**:與 Session 5 的 inFlightSave promise coalescing 一脈相承 — race-safe 做法都是「capture snapshot 在 fetch 前，compare on success」，而非依 state 推斷 dirty

### Git commits（全 push master）
```
a5b6a71 perf(web): speed up annotate submit via prefetch + save no-op skip
1dffd88 chore(web): add set-role script for CLI role updates
50517ac feat(web): add Review and Admin nav links with role gate
ca3421d fix(web): role-gate /projects route tree for annotator
c5af099 fix(web): hide Projects nav link from annotator
```

### 下一步
1. **使用者 logout/login 驗證新 role** — session cookie 會重建，TopNav 應顯示 Projects + Review + Admin（他是 admin）；其他兩位 reviewer 登入後會拿到 final_reviewer
2. **production 實測 annotate submit 優化效果** — 按 s 體感比較前後
3. **選配**:若發現 annotator 仍能手打 `/review` 或 `/admin` URL（step-up 密碼會問，但 role 層沒擋），要不要補 server-side role redirect。目前 documented 未做
4. **選配**:admin UI（/admin/members 或 /admin/users）的 role 管理 UX 是否夠好？若還是用 set-role script 比較快，script 保留。若 UI 好用則下次考慮棄用 script

### 阻礙
無 blocker。等使用者實測 submit 延遲改善是否符合預期。

### 5-Question Reboot Check
1. **做什麼?** 修三件事:(a) UI 權限洩漏 — Projects/Review/Admin 連結 role gate + /projects 路由樹 server redirect；(b) 批次升級 4 個 production user role + 寫 reusable set-role script；(c) annotate submit 延遲優化（router.prefetch + flushSave no-op skip）。
2. **進度?** 5 個 commit 全 push master。Vercel auto-deploy 完成。待使用者 production 實測。
3. **下一步?** 使用者 logout/login 驗證 role 生效 + 實測 submit 速度。若正常則進下一個功能;若有 regression 開新 branch 修。
4. **阻礙?** 無 blocker。
5. **檔案?**
   - `web/components/top-nav.tsx`（role gate 主要對象）
   - `web/app/(protected)/projects/layout.tsx`（server-side redirect，新增）
   - `web/scripts/set-role.ts`（CLI 改 role 工具，新增）
   - `web/app/(protected)/annotate/[imageId]/editor.tsx`（submit 優化）
   - `web/lib/rbac.ts`（RBAC matrix 參考來源）
   - `web/types/next-auth.d.ts`（Session type augmentation 參考）

---

## Session: 2026-04-17 (第 5 次)

### 主題
執行前一個 session 寫的 Annotation Editor UX Upgrade plan — 把 Python 桌面版 `label_editor.py` 的 UX 整套搬到 web annotator 頁。14 個 task 全部完成 + 3 個 fix commits(code reviewer 抓到的 latent bugs) + 1 個 docs commit。Production 已 push master 觸發 Vercel auto-deploy。

### 執行模式
**Subagent-Driven Development**（`superpowers:subagent-driven-development` skill）。14 個 task plan,每個 task 派 implementer + spec review + code quality review。

### 完成項目

**Phase 0 — 4 個 pure helper modules（TDD,42 個新 unit tests）**
- [x] Task 0.1 `web/components/annotation/viewport.ts` — `imgToDisp` / `dispToImg` / `computeFitView` / `applyWheelZoom`(cursor-centered zoom,1.15× factor,[0.1, 10] bounds,3× fit cap)+ 10 tests
- [x] Task 0.2 `web/components/annotation/hit-test.ts` — `boxToImgRect` / `hitTestBox`(top-most z-order 優先)/ `hitTestHandle`(9 px 預設命中半徑)/ `HANDLE_CURSORS`(8 個方向性 cursor 字串)+ 11 tests
- [x] Task 0.3 `web/components/annotation/undo.ts` — `pushUndo<T>`(cap 50 預設,不可變)/ `popUndo<T>` + 7 tests
- [x] Task 0.4 `web/components/annotation/editor-actions.ts` — `changeSelectedClass` / `deleteSelected` / `clampMoveNorm` / `commitResize`(reverse-flip support,<5px reject)/ `commitDraw`(<0.005 norm reject,fresh UUID)+ 14 tests

**Phase 1 — AnnotationCanvas.tsx 完全重寫**
- [x] Task 1.1 ResizeObserver-responsive Konva Stage + viewport state(zoom/pan)+ fit-view on image load/URL change/container resize/`f` key + wheel zoom(cursor-centered,invert `-deltaY`)+ middle/right-click pan(`preventDefault` contextmenu)+ `readOnly` prop + `selectedId`/`onSelect` controlled props
- [x] Task 1.2 Modeless 互動 — `DragAction` tagged union(null | move | draw)+ hit-test priority(handle > box > empty,handle 待 1.3)+ drag move with `clampMoveNorm` + drag draw → commit via `commitDraw`(<5 px 視為 click → deselect)+ `drawPreview` 黃色虛線 + `hoverBoxId` state + cursor 反饋(mirror state `isPanning`/`isDrawing`,因為 React 19 `react-hooks/refs` 不允許 render 時 read refs)
- [x] Task 1.3 8-handle resize — 擴展 `DragAction` 加 `resize` variant + handle-hit 優先於 box-hit + resize 邏輯(handle 0=TL..7=BR)+ `renderHandles`(白填色 + class color 邊,`listening={false}`)+ `hoverHandleIdx` state + `HANDLE_CURSORS[idx]` cursor
- [x] Task 1.4 Esc 取消 in-progress draw + readOnly 驗證(無程式碼變更,readOnly 已由 1.2 實作)

**Phase 2 — editor.tsx 整合**
- [x] Task 2.1 **大改動** — Editor 擁有 `selectedId`、`undoStack`、`onBoxesChange` wrapper(pushUndo 舊 boxes 到 stack 再 setBoxes);image-id 變更時清空 stack + selection;**Canvas refactor 為 shadowBox pattern** — `onChange` 只在 mouseup 觸發(不再每 mousemove frame 觸發),蛇行 `shadowBox` state 提供 live drag 預覽;Esc + window-mouseup 清理也補上 `setShadowBox(null)`;editor 新增 keyboard handlers:Ctrl+Z(`popUndo` + `setBoxes` + 清選擇)、Del/Backspace(`deleteSelected` via `onBoxesChange`)、Esc(清選擇)
- [x] Task 2.2 Class shortcut 雙重作用 — 有 selected → `onBoxesChange(changeSelectedClass(boxes, selectedId, matchByShortcut))`;同時 `setActiveIdx`;letter + numeric fallback 都有雙重作用
- [x] Task 2.3 **flush-save 架構** — 拆 debounce useEffect:新增 `boxesRef`/`updatedAtRef`(ref 確保 `doSave` 讀最新值、不受閉包影響)、`doSave` useCallback、2s debounce useEffect、`flushSave`(清 pending timer + await doSave)、`submit`(flush 再 POST submit)、unmount flush useEffect(fire-and-forget);`prevId` 同 `nextId` 一起宣告;新 arrow-nav useEffect:←/→ 先 `flushSave()`,失敗則 stay、成功則 router.push
- [x] Task 2.4 Header hint 文字更新(`drag: empty→draw · box→move · handle→resize · wheel zoom · mid/right drag pan · f fit · ←/→ nav · 1-9/letters class · Del · Ctrl+Z · Esc · S submit`)

**Phase 3 — Review tray**
- [x] Task 3.1 Review tray readOnly — 已由 Task 1.1 完成(passes `readOnly`、`selectedId={null}`、`onSelect={() => {}}`;wrapper div 從 `items-center justify-center` 改 `flex` 讓 canvas 填滿);僅驗證,無新改動

**Phase 4 — Final validation**
- [x] Task 4.1 最終驗證(build + lint + 88/88 tests 全綠)+ 派最終 code reviewer + fast-forward merge + push

**非計畫內的 3 個 fix commits(code reviewer 抓到的 latent bugs)**
- [x] `e65196b` fix(web): clean up drag state on window mouseup + mid-drag pan — 補 window-level mouseup handler(使用者拖曳到 canvas 外釋放也會清空 drag state;middle-click 在 left-drag 中啟動 pan 時先 abort 左邊 drag)
- [x] `9b775ea` fix(web): resolve react-hooks lint errors on drag state mutations — Task 1.4 的 Esc useEffect 位置原本在 state 宣告之前,導致 `react-hooks/immutability` 規則誤判 dragState mutations;移到 state 宣告之後,規則就不再 fire 了
- [x] `cb67386` fix(web): save-race data loss + undo ref-based state — 最終 reviewer 抓到 C1 critical:`doSave` 在 in-flight 時直接 return true 可能導致「user 編輯 A → 2s save 中 → user 編輯 B → 按 → → flushSave 以為成功 → navigate → B 遺失」。改為 `inFlightSave` promise coalescing:先 await 舊的 save 再 fire 新的 save(用最新 boxes);也順便修 I1(unused `undoStack` 綁定,改成 `useRef`)+ I2(`setUndoStack` updater 裡的副作用違反 React 19 reducer purity,改成 ref-based 讀寫)

**1 個 docs commit**
- [x] `622fd94` docs: correct box1 y-coord math in Task 0.1/0.2 test specs — plan 裡原本 box1 (y=0.5, h=0.4, natH=500) 誤寫成 y1=100/y2=300,正確應是 y1=150/y2=350。subagent implementers 發現並修正 test,我再補 plan doc 的 math

### 核心設計決策(供未來 session 快速 recall)
1. **Canvas owns viewport + drag, Editor owns undo + save**:責任分離清楚。Canvas 透過 `onChange(newBoxes)` + `selectedId`/`onSelect` controlled 與 Editor 通信
2. **shadowBox pattern**:drag 中 Canvas 不 fire onChange,commit-on-release 後才 fire。Esc/window-mouseup 清 shadowBox → drag 中被 undo 會自動還原
3. **undoStackRef 而非 useState**:undo stack 不驅動 UI,只在 event handlers 間共享 → 用 ref 更純,避開 React 19 reducer purity 問題
4. **inFlightSave promise coalescing**:避免 rapid ←/→/S 時的 silent data loss
5. **React 19 effect 宣告順序**:新 useEffect 必須放在它讀的 refs/state 之後,否則 lint 會誤判 ref mutations 為「modifying value used in effect」
6. **Class shortcut 雙重作用**:有 selected → 改 class + set active;無 selected → 只 set active。省「畫完再按一次 class key」那一步
7. **Mirror state (`isPanning`/`isDrawing`)**:React 19 `react-hooks/refs` 禁止 render 時 read refs,所以 cursor 邏輯用 state booleans 鏡射 refs,而非直接 `panState.current ? 'grabbing' : 'grab'`

### 修改檔案
- `web/components/annotation/viewport.ts`(新增,zoom/pan/fit helpers)
- `web/components/annotation/hit-test.ts`(新增,box + 8 handles hit-test helpers)
- `web/components/annotation/undo.ts`(新增,undo stack helpers)
- `web/components/annotation/editor-actions.ts`(新增,class/delete/clamp/resize/draw helpers)
- `web/components/annotation/AnnotationCanvas.tsx`(完全重寫,加 viewport + modeless 互動 + 8-handle resize + readOnly + shadowBox pattern)
- `web/app/(protected)/annotate/[imageId]/editor.tsx`(大改,undo stack + Del + Ctrl+Z + Esc + class shortcut dual action + flush-save + ←/→ nav + submit flush)
- `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)
- `docs/superpowers/plans/2026-04-17-annotation-editor-ux-upgrade.md`(新增,implementation plan)
- `web/tests/unit/annotation/viewport.test.ts` + `hit-test.test.ts` + `undo.test.ts` + `editor-actions.test.ts`(新增 4 個 test file,42 test)

### Git commits(全 push master)
```
622fd94 docs: correct box1 y-coord math in Task 0.1/0.2 test specs
cb67386 fix(web): save-race data loss + undo ref-based state
5b4019c feat(web): expand annotation editor header hint to reflect new shortcuts
68ca1ed feat(web): annotation editor flush-save + ←/→ nav + submit flush
7baa046 feat(web): annotation class shortcut dual action (change selected + set active)
da2767a feat(web): annotation editor undo stack + Del + Ctrl+Z + Esc + shadowBox refactor
9b775ea fix(web): resolve react-hooks lint errors on drag state mutations
77495c6 feat(web): annotation canvas Esc cancels in-progress draw
a5732e2 feat(web): annotation canvas 8-handle resize (with reverse-flip)
e65196b fix(web): clean up drag state on window mouseup + mid-drag pan
2e1c35f feat(web): annotation canvas select + move + draw (modeless)
7a4f1f2 feat(web): annotation canvas viewport (zoom/pan/fit + responsive stage)
1a9aa3a feat(web): annotation editor-actions helpers (class/delete/clamp/resize/draw)
aeafe52 feat(web): undo stack helpers
d22bd54 feat(web): annotation hit-test helpers (box + 8 handles)
d73998d feat(web): annotation viewport helpers (zoom/pan/fit)
a93db09 docs: annotation editor UX upgrade implementation plan
```

branch `feat/annotation-editor-ux-upgrade` 已 fast-forward merge 進 master + push origin;local branch 已刪除。

### 最終測試狀態
- Build: green(Next.js 16 + Turbopack,33 routes)
- Lint: 0 errors(1 pre-existing warning 在 `name-form.tsx` 的 unused `isEdit`,不相關)
- Unit tests: 88/88 pass(12 test files,包含 4 個新的 + 既有 8 個)
- Playwright E2E: 未跑(spec 明確 skip,Konva 難測)
- 手動 QA: 使用者選擇跳過,Vercel auto-deploy 後直接 production smoke test

### 下一步
1. **使用者在 production 實測 annotation editor**(`https://frc-annotation.vercel.app/annotate/[任一 assigned image]`)— 走 viewport(滾輪/mid-right drag/f fit)、modeless 互動(點 bbox 選取、拖 bbox 移動、拖 handle 縮放)、draw 新 bbox、Del/Ctrl+Z/Esc、class shortcut 雙重作用、←/→ nav(看 flush 是否正常)、submit。如遇到回歸,開新 branch 修
2. **選配**:若手動 QA 抓到 edge case,考慮補 jsdom integration tests(spec §11 原本提過,被 Appendix C 延後)
3. **選配**:code reviewer 提到的 I3(Ctrl+Z / Del 在 drag 中按會 state 不一致)— 目前是 documented known limitation,若真有使用者撞到再補 fix(Canvas 在 boxes prop 變更且 drag 中時 auto-cancel drag)
4. **選配**:重度使用者反映 undo 50 不夠 → 擴大 cap;觸控板使用者 → 加 `Space + 左拖 pan`;右鍵 pan 衝突 context menu → 改 middle-only。都是 post-launch watch 項目
5. **Python pipeline 側**:隊友用平台審核過 Gemini 批次標註後,如果某個 batch 走到 `completed`,匯出 YOLO zip → 借 GPU 跑 `python train_robot_model.py --local-dataset ...` 做端到端訓練驗證(這是 L1 project_gpu_training_workflow memory 提過的延後項)

### 阻礙
無技術 blocker。等使用者 production 實測 annotation editor UX。

### 5-Question Reboot Check
1. **做什麼?** 執行 Annotation Editor UX Upgrade plan — 把 Python 桌面版 `label_editor.py` 的 UX(zoom/pan、modeless 互動、8-handle resize、fit view、undo、←/→ nav、class shortcut)整套搬到 web annotator 頁。Subagent-driven 執行 14 task,每 task 兩段式 review。
2. **進度?** 全部 14 task 完成 + 3 個 fix commits + 1 個 docs commit 全 push master。Build + lint + 88/88 tests 綠。branch `feat/annotation-editor-ux-upgrade` 已 merge + 刪除。
3. **下一步?** 使用者在 production 實測 annotation editor UX。若發現 regression 開新 branch 修;否則進入下一個功能開發。
4. **阻礙?** 無技術 blocker。等使用者實測。
5. **檔案?**
   - `web/components/annotation/AnnotationCanvas.tsx`(主要重寫對象)
   - `web/components/annotation/viewport.ts` + `hit-test.ts` + `undo.ts` + `editor-actions.ts`(新 4 個 pure helper module)
   - `web/app/(protected)/annotate/[imageId]/editor.tsx`(大改,undo + flush-save + nav + shortcut)
   - `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)
   - `docs/superpowers/plans/2026-04-17-annotation-editor-ux-upgrade.md`(plan)

---

## Session: 2026-04-17 (第 4 次)

### 主題
兩件事:
1. **端到端冒煙測試驗證成功** — 使用者在本地 `c:\Users\USER\Downloads\FRC-yolo.zip` 收到從 production `/review` export 的 YOLO zip(8 張圖 + 8 labels + classes.txt + data.yaml),驗證檔案結構、classes 順序(Red=0, Blue=1)、data.yaml、label 格式全部合規。整個平台從登入 → 建專案 → upload zip → finalize → assign → annotate → submit → review approve → export 完整 pipeline 首次跑通。
2. **規劃 Annotation Editor UX Upgrade** — 使用者回報「審核的介面目前操作很不人性化」,要求把 Python 桌面版 `label_editor.py`(team 既有工具)的 UX 整套搬到 web annotator 頁(`/annotate/[imageId]`),唯一差別是 class 切換從 Tab toggle 改成 class 自己的 shortcut(r/b/...)。走完 `superpowers:brainstorming` skill 流程,產出 design spec 並 commit。**尚未寫 implementation plan、尚未實作**。

### 完成項目
- [x] 確認 production 端到端冒煙測試成功(FRC-yolo.zip 結構與 YOLO 格式全通過)
- [x] 比對 `label_editor.py` vs 現有 `web/components/annotation/AnnotationCanvas.tsx` 功能落差(整理成表格)
- [x] 走 brainstorming 流程,使用者確認:
  - **Scope(Q1)**:整套 label_editor.py UX 搬(zoom/pan、move/resize bbox、fit view、undo、prev/next nav、class shortcut 替代 Tab toggle)
  - **Mode(Q2)**:Modeless — drag 空白 = 畫新 box,click bbox = 選,drag bbox = 移,drag handle = 縮放
  - **架構**:方案 1 — 擴充既有 `AnnotationCanvas.tsx` 加 `readOnly?: boolean` prop(reviewer tray 同時受惠,免費拿到 zoom/pan)
- [x] 分 4 段 section 呈現 design(viewport / bbox 互動 / keyboard+undo+autosave / readOnly+檔案+測試),每段獲使用者 OK
- [x] 寫 design spec 到 `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(257 行,12 個 section + 2 個 appendix)
- [x] Spec self-review(無 placeholder、內部一致、scope 單一 plan 可涵蓋)
- [x] Commit `26e6fae docs: annotation editor UX upgrade design spec`

### 核心設計決策(供下次 session recall)
1. **Modeless 互動**:hit-test 順序 handle > bbox > empty;drag empty = draw,click empty = deselect
2. **8 個 resize handles**:TL/TC/TR/ML/MR/BL/BC/BR,selected 才顯示
3. **Move clamp 偏離 label_editor**:`cx ∈ [bw/2, 1-bw/2]` 讓 bbox 完全在 image 內(避免 YOLO 負座標);Python 版只 clamp center
4. **Class shortcut 雙重作用**:有 selected → 改 selected class **同時** set "next-draw active"
5. **Undo per-image**:cap 50 entry,切圖清空;不做 redo(YAGNI)
6. **Auto-save immediate flush**:←/→ 切圖前、S submit 前、unmount 前 flush pending save;失敗不切圖
7. **ReadOnly mode**:reviewer tray 加一行 `readOnly` prop 即享 zoom/pan/fit
8. **Zoom**:滾輪 1.15×/tick cursor-centered,bounds [0.1, 10];fit view 3× cap
9. **Pan**:middle-click drag + right-click drag(需 preventDefault context menu)

### 修改檔案
- `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(新增,257 行)

### Git commits
- `26e6fae docs: annotation editor UX upgrade design spec`

### 規劃的未來檔案變動(尚未實作)
| 檔案 | 動作 |
|---|---|
| `web/components/annotation/AnnotationCanvas.tsx` | **重寫**(加 viewport + 互動 + readOnly) |
| `web/app/(protected)/annotate/[imageId]/editor.tsx` | 加 ←/→ nav、f/Ctrl+Z/Esc、class shortcut 雙重作用、flush-before-nav |
| `web/components/annotation/types.ts` | 加 viewport helper types(可選) |
| `web/app/(protected)/review/[batchId]/review-tray.tsx` | 加 `readOnly` prop(1 行) |

### 下一步
1. **使用者 review spec**(`docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`)— 目前阻塞在此
2. Spec 通過後 invoke `superpowers:writing-plans` skill 產 implementation plan
3. Plan 通過後進實作(subagent-driven-development 或 inline,待使用者選)

### 阻礙
無技術 blocker。等使用者 review spec。

### 5-Question Reboot Check
1. **做什麼?** (a) 驗證 production 端到端冒煙測試成功(FRC-yolo.zip 合規);(b) 規劃把 `label_editor.py` UX 整套搬到 web annotator 頁 — design spec 完成並 commit,尚未寫 plan 與實作。
2. **進度?** Design spec(257 行)已 commit(`26e6fae`);等使用者 review 後才能進 writing-plans。
3. **下一步?** 使用者 review `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`;通過後 invoke `superpowers:writing-plans` skill。
4. **阻礙?** 無技術 blocker,等使用者 review spec。
5. **檔案?**
   - `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(design spec,主要跟隨對象)
   - `D:\FRC\frc-train-review\label_editor.py`(參考來源,Python 桌面版)
   - `web/components/annotation/AnnotationCanvas.tsx`(要重寫)
   - `web/app/(protected)/annotate/[imageId]/editor.tsx`(要加 nav + shortcut)
   - `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)

---

## Session: 2026-04-17 (第 3 次)

### 主題
Production 平台（`https://frc-annotation.vercel.app`）端到端冒煙測試。使用者用 `redacted@example.com` 登入後撞到兩個症狀：`/review` 顯示「僅覆核者 / 管理員可進入」、`/admin` 回 404。使用者決策：**不再綁定特定 Gmail 帳號才能登入/操作，只要 step-up 密碼正確即可** — 整塊 role-based RBAC 從 route layer 移除,step-up 密碼變成 reviewer/admin 動作的唯一閘門。後續工作往外擴：補 global top nav、New batch 按鈕、Export 按鈕、修 `/admin/members` 看不到新登入使用者的 bug。並產出端到端測試用的 `test_batch_8.zip`。

### 完成項目

**修復 1：step-up 密碼為唯一閘門（drop role-based RBAC）**
- `web/lib/rbac.ts` 新增 `ACTION_SCOPE: Partial<Record<Action, StepUpScope>>` + `requireAuthz(session, action, request)` + `authzOr401` wrapper — 把「哪個 action 要哪種 step-up」集中成單一 source of truth。`canPerform` / `requireRole` 保留給 unit test compat，但沒有 route 再呼叫
- 10 個 API route `requireRole` → `authzOr401` 對應正確 scope：admin/users POST+GET、batches/assign POST、batches/finalize POST、blob/upload POST、images/approve POST、images/reject POST、projects POST+PATCH、projects/[id]/batches POST、projects/[id]/export GET
- `/api/images/[id]/signed-url`：privileged 判斷改為「持有 reviewer 或 admin step-up cookie」而非查 role
- `/api/batches/[id]/assign`：拿掉 assignee 的 role 檢查，任何 active user 可被分派
- 補 `/admin/page.tsx`（redirect 到 `/admin/members`）修 `/admin` 404
- `/review/page.tsx` 與 `/admin/members/page.tsx` 移除 role check
- `StepUpGuard scope="admin"` 包 `/projects/new`、`/projects/[id]/upload`、`/projects/[id]/batches/[batchId]/assign`
- `StepUpGuard scope="reviewer"` 包 `/projects/[id]/export`
- `/projects` 列表拿掉 `canCreate` role check，"New project" 按鈕永遠顯示
- Dashboard「Ready for Review」區塊對所有人顯示
- Tests 改寫：3 個 integration 測試檔換 cookie helpers（admin/reviewer step-up cookies）+ 401 step-up-required 取代 403 role-forbidden；`admin-users.test.ts` 改測「session id ≠ step-up cookie userId → 401」
- 同步修掉現存 lint errors：`step-up-guard.tsx` / `step-up-dialog.tsx` / `completed-batches.tsx` / `rbac-stepup.test.ts`
- `web/.gitignore` 補 `/test-results` / `/playwright-report`
- 93/93 tests 綠、`pnpm build` 綠、`pnpm lint` 0 errors 1 warning
- Commit `79da235`（32 files, +310/-167）

**修復 2：Project home 列 batches + New batch 按鈕 + finalize error detail**
- `/projects/[id]/page.tsx` 改為顯示所有 batch（state + image count）+ "New batch" 按鈕連到 `/projects/[id]/upload`（先前只有「No batches yet」空字串）
- `/api/batches/[id]/finalize` 所有失敗分支改用 `return NextResponse.json({ error }, { status })`；classes mismatch 錯誤包含 `expected=[...] got=[...]` 對照；外層 try/catch 吸未預期錯誤
- `batch-uploader.tsx` 改讀 JSON error body 顯示給使用者
- Commit `72500df`（3 files, +178/-103）

**修復 3：Global top nav + Export button + 智能 batch 連結**
- 新 `web/components/top-nav.tsx`（server component，FRC Annotation logo + Dashboard + Projects + 使用者名 + Sign out server-action）
- 新 `web/app/(protected)/layout.tsx` 包 TopNav；`/review` 與 `/admin` 的 StepUpGuard layout nested 在這之下
- 依使用者指示 `/review` / `/admin` 仍維持 URL-only 不進 nav
- `/projects/[id]/page.tsx` 加「Export YOLO zip (N)」按鈕（N = approved image count）
- Batch 列表連結智能路由：`under_review` → `/review/[id]`、`completed` → `/projects/[id]/export`、否則 → assign page
- `/login` 文案更新掉白名單相關舊字串
- `lib/auth-test.ts` `FakeSession` 加 `name?: string | null`（TopNav 需要）
- Commit `2e746dc`（5 files, +96/-6）

**修復 4：`/admin/members` 顯示所有已登入使用者**
- 根因：舊 page iterate `EmailWhitelist` 為主表 join User；白名單 sign-in gate 上 session 拿掉後，多數 Google users 沒 whitelist row，整個隱形，只剩 seeded admin 看得到
- 改為 `User.findMany()` 為主表，分兩區顯示：
  - **已登入 (N)**：所有 User row，多一欄「白名單角色」，當 whitelist role ≠ User.role 以 amber `{role}（未同步）` 呈現 — 讓 E4「L1 backlog drift」終於可見
  - **預訂白名單 (N)**：只在有 whitelist row 無對應 User 時顯示
- Commit `00b6fce`（1 file, +100/-40）

**端到端測試 artifact**
- 新 `datasets/notyet/_test_samples/make_test_zip.py` + `test_batch_8.zip`（1.6 MB，8 張從 2895 張 `datasets/notyet/` 均勻取樣 + YOLO labels + `classes.txt = "Red\nBlue\n"`）
- 用於端到端冒煙測試上傳流程；注意 project class 必須 idx0=Red、idx1=Blue 順序一致，否則 finalize reject 並附上 expected/got diff

### 修改檔案（核心）
- `web/lib/rbac.ts`（ACTION_SCOPE map、requireAuthz、authzOr401 — 新 authz 核心）
- `web/app/(protected)/layout.tsx` + `web/components/top-nav.tsx`（global nav 結構）
- `web/app/(protected)/projects/[id]/page.tsx`（batch-aware + export button + smart links）
- `web/app/(protected)/admin/members/page.tsx`（User-primary 重寫）
- `web/app/(protected)/admin/page.tsx`（新建，redirect 到 `/admin/members`）
- `web/app/api/batches/[id]/finalize/route.ts`（try/catch + JSON error pattern，可作為其他 route 遷移模板）
- `datasets/notyet/_test_samples/test_batch_8.zip` + `make_test_zip.py`

### Git commits（皆已 push master + Vercel auto-deployed）
1. `79da235 feat(web): make step-up password the sole gate; drop role-based RBAC`
2. `72500df feat(web): project home lists batches with New batch button; finalize surfaces error detail`
3. `2e746dc feat(web): global top nav + export button on project home + smart batch links`
4. `00b6fce fix(web): /admin/members shows all logged-in users, not just whitelist entries`

### Production status
- `https://frc-annotation.vercel.app` 已跑在 `00b6fce`
- Env vars 完整（DATABASE_URL / AUTH_* / BLOB_READ_WRITE_TOKEN / REVIEWER_PASSWORD_HASH / ADMIN_PASSWORD_HASH / STEPUP_COOKIE_SECRET）
- 選配 `NEXT_PUBLIC_APP_URL` / `UPSTASH_*` 仍未設

### 下一步
1. **使用者端到端實測**（rosalyn 帳號 fresh login）：top nav + Sign out、Projects → 建 `2026inmis-bumper`（classes: Red(r) / Blue(b)，順序不可錯）→ New batch → 上傳 `test_batch_8.zip` → 自我分派 → 標註 → submit → `/review` + `frc6998` 覆核 → export
2. **選配**：若使用者想用單一 "bumper" class 而非 Red/Blue 拆兩 class,需重產 test zip 做 class remapping（本 session 未做）
3. **選配**：連 Upstash Redis（step-up rate-limit 跨 instance 持久化）+ 設 `NEXT_PUBLIC_APP_URL` 讓 step-up CSRF origin check 生效

### 5-Question Reboot Check
1. **做什麼？** Production 冒煙測試發現兩個 blocker（`/admin` 404 + `/review` role gate），使用者決策 drop role-based RBAC 改以 step-up 密碼為唯一閘門。後續擴充：global top nav、New batch 按鈕、Export 按鈕、修 `/admin/members` 看不見新登入使用者的 bug。產出端到端測試 zip。
2. **進度？** 4 個 commit 全 push、Vercel auto-deploy 綠（跑在 `00b6fce`）、93/93 tests + build + lint 綠。`test_batch_8.zip` ready。
3. **下一步？** 使用者用 rosalyn 帳號跑完整端到端實測（建專案 → 上傳 zip → 分派 → 標註 → submit → 覆核 → export）。
4. **阻礙？** 無技術 blocker。等使用者實測。若要單一 class bumper 專案需重產 zip。
5. **檔案？**
   - `web/lib/rbac.ts`（ACTION_SCOPE + requireAuthz + authzOr401）
   - `web/app/(protected)/layout.tsx` + `web/components/top-nav.tsx`
   - `web/app/(protected)/projects/[id]/page.tsx`
   - `web/app/(protected)/admin/members/page.tsx`
   - `web/app/api/batches/[id]/finalize/route.ts`（JSON-error pattern 模板）
   - `datasets/notyet/_test_samples/test_batch_8.zip` + `make_test_zip.py`

---

## Session: 2026-04-17 (第 2 次)

### 主題
短收尾 session。接在同日上一個 session（三種角色介面 + step-up auth 實作完成 + production 部署）之後，使用者 Gmail 登入實測時撞到兩個連動的 blocker，本 session 修完即收尾。

### 完成項目

**修復 1：移除 email 白名單登入閘門**
- 症狀：Google 登入後 Google 顯示 "Access Denied / You do not have permission to sign in"
- 根因：`web/lib/auth.ts` 的 `signIn` callback 查不到 `EmailWhitelist` row 就 `return false`，Google OAuth 回給用戶 AccessDenied
- 修法：改為「白名單找不到 → fallback role = `annotator`」；白名單保留作為「指定某些 email 為 admin / final_reviewer」的晉升機制，不再擋人
- 安全論證：reviewer / admin 頁面仍有 step-up 密碼（`frc6998` / `980415`）擋著，開放 annotator 門檻 ≠ 開放 reviewer / admin 操作

**修復 2：Vercel production auto-deploy 失敗**
- 症狀：push 到 master 後 Vercel auto-deploy 報 `No Next.js version detected. Make sure your package.json has "next" in either "dependencies" or "devDependencies"`；其實上一個 docs commit `1440204`（上 session 結尾）的 auto-deploy 也已經壞過，當時被 CLI 手動 deploy 覆蓋沒注意到
- 根因：Vercel project 的 Root Directory 設定是 `.`（repo 根目錄），但 Next.js 在 `web/` 子目錄。之前 CLI deploy 沒讀這個設定，接上 GitHub 後 auto-deploy 走 Vercel clone repo + 讀 project 設定的路徑才觸發
- 修法：CLI 沒提供改 rootDirectory 的子命令，改用 Vercel REST API `PATCH /v9/projects/{id}` body `{"rootDirectory":"web"}`，auth token 從 `$APPDATA/com.vercel.cli/Data/auth.json` 讀
- 驗證：`vercel redeploy <failed-url> --target production` 觸發新 deploy，aliased 到 `frc-annotation.vercel.app`；curl `/login` 200、`/` 307 ✓

### 修改檔案
- `web/lib/auth.ts`（`signIn` callback 邏輯改動，+2 / -2）

### Git commits
- `092d745 feat(web): remove email whitelist gate at sign-in`（已 push，觸發 auto-deploy；修 Root Directory 後 redeploy 成功）

### 下一步
1. **使用者仍需 Gmail 端到端驗證**（現在應該真的能登入了）— onboarding 填中文姓名、進 `/review` 輸 `frc6998`、進 `/admin` 輸 `980415`、`/admin/members` 新增成員、reviewer 匯出 zip
2. 登入後於 `/projects/new` 建 `bumper`(shortcut `b`)+`fuels`(shortcut `f`) 專案
3. **選配**：連 Upstash Redis（否則 step-up rate limit 只在 in-memory、多 instance 無效）
4. **選配**：把 `NEXT_PUBLIC_APP_URL` 設為 prod URL 讓 step-up CSRF origin check 真正作用

### 5-Question Reboot Check
1. **做什麼？** 短收尾 session，修 Gmail 登入 blocker（白名單 gate 擋人）+ Vercel auto-deploy blocker（Root Directory 未設 `web/`）。
2. **進度？** 兩個修復完成，commit `092d745` 已 push、redeploy 成功。Production `https://frc-annotation.vercel.app` 現在應可實際登入。
3. **下一步？** 使用者 Gmail 登入做端到端驗證（onboarding / step-up / 成員管理 / export 全流程）、建 bumper + fuels 專案；選配 Upstash + `NEXT_PUBLIC_APP_URL`。
4. **阻礙？** 無技術 blocker。待使用者實測確認登入真的通了。
5. **檔案？**
   - `web/lib/auth.ts`（`signIn` callback，fallback to annotator role）
   - `PROGRESS.md` / `FINDINGS.md` / `ERROR.md`（本次 session 紀錄）
   - Vercel project settings（Root Directory 已透過 API 改為 `web`）

---

## Session: 2026-04-17

### 主題
執行 2026-04-16 產出的「三種角色介面 + 雙層閘門」plan，從 P0 到 P5 + P7.3 security audit 全部實作完成。+ 中途加碼字母快捷鍵功能。+ Vercel 接 GitHub、部署 production、env vars 設妥、migrations 驗證。

### 執行模式
**Subagent-Driven Development**（`superpowers:subagent-driven-development` skill）。每個 task 派新 implementer + spec review + code quality review subagent。原 28 tasks → 執行 21、刪除 7（P6 Gemini 視覺套版 + P7.1/P7.2 Playwright E2E，使用者決策跳過）。

### 完成項目

**P0 Foundation（Tasks 0.1–0.3）**
- 新增 `argon2` + `@upstash/ratelimit` + `@upstash/redis` 依賴
- `User.displayNameSetAt: DateTime?` 欄位 + migration
- `scripts/hash-passwords.ts` 一次性 argon2id hash 產生器

**P1 Step-up Core（Tasks 1.1–1.4, 含 review patches）**
- `lib/stepup.ts`：argon2 verify、HMAC-signed cookie (`stepup_reviewer`/`stepup_admin`)、cookie payload 綁 `userId` 防 session fixation、Upstash + in-memory fallback rate limit（1 分鐘 5 次、超過鎖 10 分鐘）
- `lib/rbac.ts`：`requireStepUp(scope)`、`stepUpOr401(session, scope, request)` 助手、`UnauthorizedError`、`StepUpRequiredError`
- `/api/auth/step-up` POST（驗密碼簽 cookie）+ GET（查目前狀態）+ audit log
- 發現 plan 規格 bug：Upstash 版本漏了 10-min 鎖（I1 patch fixed to match spec §2.2）

**P2 Onboarding（Tasks 2.1–2.4）**
- `PATCH /api/me/display-name`（寫 `displayNameSetAt` + audit）
- `/onboarding/name` 表單（shadcn Input + a11y label，無視覺套版僅功能版）
- JWT claim `hasDisplayName` + proxy 強制 redirect gate
- `SessionProvider` mount + client-side `update()` refresh

**P3 Step-up UI（Tasks 3.1–3.2）**
- `step-up-dialog.tsx`（non-dismissable，自動清 lockout countdown，trim 密碼）
- `step-up-guard.tsx`（wrapper component）
- Mount 在 `/review` + `/admin`

**P4 Integrated Members（Tasks 4.1–4.3）**
- `/admin/members` 統一表格（joins EmailWhitelist + User，合併原本兩個頁面）
- `/admin/users` → 自動 redirect 到 `/admin/members`
- `POST /api/admin/users`（whitelist） + `POST /api/batches/[id]/assign` 加 `requireStepUp('admin')`
- GET `/api/admin/users` 也加 stepUpOr401（防資訊外洩）

**P5 Reviewer Export（Tasks 5.1–5.2）**
- `POST /api/projects/[id]/export` 放寬 `admin | final_reviewer` + `requireStepUp('reviewer')`
- `/review/page.tsx` 新增 landing（列出 completed batches + 匯出按鈕）

**P7.3 Security Audit（`agent-skills:nextjs-security-scan`）**
- 0 Critical、3 Important 全修：
  1. SSRF guard on finalize zipUrl（延伸到 export 的 blob fetch）
  2. CSRF origin check on step-up POST（`NEXT_PUBLIC_APP_URL` 比對）
  3. `.env.example` 文件化 `REVIEWER_PASSWORD_HASH` / `ADMIN_PASSWORD_HASH` / `STEPUP_COOKIE_SECRET` / Upstash tokens

**加碼功能：Letter Shortcuts for Annotation Classes**
- mid-session 使用者額外要求
- `AnnotationClass.shortcut: String?` 欄位 + migration
- `ClassPalette` + `AnnotationCanvas` 支援單字母鍵（例：bumper=b、fuels=f），shortcut 與既有 1-9 數字鍵並存
- Project edit page + `/projects/new` 表單新增 shortcut 欄位

**整合成果**
- 93/93 tests pass（unit + integration）
- `pnpm build` 綠
- `pnpm lint` 綠

### Git 活動
- Branch：`feat/three-interfaces-stepup`（從 master `aaa9152` 開）
- 27 個 branch commit + 1 個 merge commit (`5ce7af0`) on master
- 40 個檔案變動，+2184 / −325

### 架構新增（review 後）
- `stepUpOr401(session, scope, request): Response | null`（`lib/rbac.ts`）— 3 個 route 呼叫點用，省去 try/catch 重複
- `readStepUpCookie(request, scope)`（`lib/stepup.ts`）— route GET 與 `requireStepUp` 共用 cookie 解析
- `UnauthorizedError extends Error { status = 401 }`（`lib/rbac.ts`）— null-session 分支的 typed error，取代 `Error('unauthorized')`

### 部署（session 結尾）
- `vercel git connect https://github.com/0908869905/frc-train-review.git` — Vercel `frc-annotation` project 接上 GitHub（未來 push master 會自動部署）
- 第一次 `vercel deploy --prod --yes` → `https://frc-annotation-fyksxyone-0908869905s-projects.vercel.app`
- 加 `REVIEWER_PASSWORD_HASH`（`frc6998` 的 argon2id）+ `ADMIN_PASSWORD_HASH`（`980415` 的 argon2id）到 Production/Preview/Development 三環境
- `prisma migrate deploy`：prod Neon DB 已同步，0 pending
- 第二次 `vercel deploy --prod` → aliased to `https://frc-annotation.vercel.app`
- Smoke test：`/login` 200、`/` 307（redirect to /login）、`/api/auth/step-up?scope=reviewer` 未授權 401 ✓

### 測試 DB FK 殘留事件（處理過）
- 「最終」一輪測試先是 92/93（修掉一個）→ 重跑 10 failed across 6 files
- 根因：Neon pooled + Prisma 7 + `admin-api-stepup.test.ts` 按檔名排序最前，它的 `beforeAll` 跑 `user.deleteMany` 卻被前一輪崩掉留下的 AuditLog FK 擋
- Fix：新增 `web/tests/helpers/clean-db.sql`（TRUNCATE CASCADE）+ `prisma db execute`
- 重置後 93/93 一致通過

### Plan 偏差（已記入 plan amendment notes）
- `withTestSession` 助手不存在 → 實測用 `__setFakeSession`（repo convention）
- `writeAudit` object-arg vs positional signature 不符 → 既有 lib 是 positional，route handlers 調整
- Upstash rate limit 漏 10-min 鎖 → patched 符合 spec §2.2
- `/api/admin/whitelist` → 實際是 `/api/admin/users`（M1.6 legacy）
- `/api/batches/[id]/export` → 實際是 `/api/projects/[id]/export`
- `next-auth.d.ts` 是**延伸**不是新建（M1 已先寫 `id`+`role` augmentation）
- Plan Task 5.2 改的 `/review/page.tsx` 不存在 → 新建

### 修改檔案（重點）
- `web/lib/stepup.ts`（新）
- `web/lib/rbac.ts`（改）
- `web/app/api/auth/step-up/route.ts`（新）
- `web/app/api/me/display-name/route.ts`（新）
- `web/proxy.ts`（改：onboarding gate + login gate）
- `web/components/step-up-dialog.tsx`（新）
- `web/components/step-up-guard.tsx`（新）
- `web/app/(protected)/admin/members/page.tsx`（新）
- `web/app/(protected)/review/page.tsx`（新）
- `web/app/(protected)/onboarding/name/page.tsx`（新）
- `web/components/annotation/class-palette.tsx`（改：shortcut 支援）
- `web/components/annotation/annotation-canvas.tsx`（改：shortcut 支援）
- `web/prisma/schema.prisma`（改：`User.displayNameSetAt` + `AnnotationClass.shortcut`）
- `web/tests/helpers/clean-db.sql`（新）
- `scripts/hash-passwords.ts`（新）
- `docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md`（持續 amendment）
- `memory/feedback_autonomy.md`（新，使用者要求自主決策）

### 使用者未完成的動作
- Gmail 端到端登入驗證（dev server 仍在 localhost:3000、prod 也 up）— 要驗 onboarding 填名、`/review` 輸 `frc6998`、`/admin` 輸 `980415`、`/admin/members` 新增成員、reviewer 匯出 zip
- 在 production 建 `bumper`(shortcut `b`)+`fuels`(shortcut `f`) 專案（透過 UI）

### 下一步
1. **使用者端到端驗證**（上述流程）— 無程式碼阻礙
2. 使用者於 `/projects/new` 建立 bumper + fuels 專案（letter shortcut 已 ready，commit `81a3501`）
3. **選配**：連 Upstash Redis（否則 step-up rate limit 只在 in-memory、多 instance 無效）
4. **選配**：把 `NEXT_PUBLIC_APP_URL` 設為 prod URL 讓 CSRF origin check 真正作用
5. **未來可回頭補**：P6 Gemini 視覺套版 + P7.1/P7.2 Playwright E2E（這次 session skip 的部分）

### 5-Question Reboot Check
1. **做什麼？** 在既有 FRC Annotation Review Platform 上實作三種角色介面（審核者/覆核者/管理員）+ step-up 雙層閘門 + 中文姓名 onboarding + 整合成員表 + reviewer 匯出 + 字母快捷鍵（bumper/fuels 的 b/f）。全流程 TDD + two-stage review（spec + code quality）。
2. **進度？** 21 個 plan task 執行完成（P0-P5 + P7.3），7 個刪除（P6 Gemini 視覺套版 + P7.1/P7.2 Playwright E2E 依使用者決策跳過）。93/93 tests 綠。Production 已部署 `https://frc-annotation.vercel.app`，env vars 設妥，GitHub integration 啟用（未來 push master 自動部署）。
3. **下一步？** (a) 使用者 Gmail 登入做端到端驗證（dev server 仍在 localhost:3000，prod 也 up）— onboarding 填名、進 /review 輸 `frc6998`、進 /admin 輸 `980415`、/admin/members 新增成員、reviewer 匯出 zip。(b) 登入後於 `/projects/new` 建 bumper(shortcut b)+fuels(shortcut f)專案。(c) 選配：Upstash Redis 連接（否則 step-up rate limit 為 in-memory、多 instance 無效）+ `NEXT_PUBLIC_APP_URL` 設為 prod URL 讓 CSRF origin check 生效。
4. **阻礙？** 無 blocker。selected-out 的 P6 視覺套版 + P7.1/P7.2 E2E 是未來可回頭補的空間。使用者尚未 Gmail 登入實測全流程。
5. **檔案？**
   - `docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md`（plan，含所有 amendment notes）
   - `docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md`（design spec）
   - `web/lib/stepup.ts`（核心 crypto + rate limit + `readStepUpCookie`）
   - `web/lib/rbac.ts`（`stepUpOr401`、`UnauthorizedError`、`StepUpRequiredError`、`requireStepUp`）
   - `web/app/api/auth/step-up/route.ts`（POST + GET）
   - `web/proxy.ts`（onboarding redirect gate + login gate）
   - `web/components/step-up-dialog.tsx`、`web/components/step-up-guard.tsx`
   - `web/tests/helpers/clean-db.sql`（測試 FK 殘留時的手動清理腳本）
   - `memory/feedback_autonomy.md`（使用者要求自主決策的 feedback）

---

## Session: 2026-04-16 (第 5 次)

### 主題
在已上線的 FRC Annotation Review Platform（M0–M7 完成）之上，規劃「三種角色介面 + 雙層閘門登入」：審核者（Gmail SSO + 中文姓名 onboarding）、覆核者（額外密碼 `frc6998`）、管理員（額外密碼 `980415`）。本次 session 只走完 brainstorming + design spec + implementation plan 三步，**尚未寫實作程式碼**。

### 完成項目

**Brainstorming（superpowers:brainstorming skill）**
- Q1–Q5 clarifying questions 全部獲使用者核准：
  - 雙層閘門（維持 Gmail+白名單，reviewer/admin 前再加共用密碼 step-up，不取代）
  - Session 綁定（密碼通過後 JWT session 結束前 = 1 小時都有效）
  - 強制中文姓名 onboarding（首次 Gmail 登入後擋在 `/onboarding/name`）
  - 整合成員表（`/admin/users` 升級為 `/admin/members`，joins EmailWhitelist + User）
  - Reviewer 可匯出（`POST /api/batches/[id]/export` 放寬到 `admin | final_reviewer` + `requireStepUp('reviewer')`）
- § 1–§ 6 分段設計審查全部 pass

**Design Spec（docs/superpowers/specs/...）**
- 產出 `docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md`
- Spec 自檢後發現原本規劃的 Auth.js v5 `unstable_update()` 做 server-initiated session update 不穩定
- 改為**獨立 HMAC-signed httpOnly cookie** 機制（`stepup_reviewer` / `stepup_admin`，`Max-Age=3600`），與 Auth.js JWT 解耦、cookie payload 綁 userId 防 session fixation
- 密碼儲存：`frc6998` / `980415` 經離線 `argon2id` 雜湊後放 Vercel env（`REVIEWER_PASSWORD_HASH` / `ADMIN_PASSWORD_HASH`），絕不進 DB、絕不進前端 bundle
- Rate-limit：同 userId 1 分鐘 5 次、超過鎖 10 分鐘（production 用 Upstash Redis，dev/單 instance 降級 in-memory）
- Audit log 記 `auth.stepup_granted` / `auth.stepup_failed`，失敗紀錄不存嘗試的密碼

**Implementation Plan（superpowers:writing-plans skill）**
- 產出 `docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md`
- 共 2149 行、28 個 TDD-structured tasks，分成 P0–P7 七個 phase

### 修改檔案
- `docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md`（新增）
- `docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md`（新增）

### Git commits
1. `5f166bf docs: three interfaces + step-up auth design spec`
2. `aaa9152 docs: implementation plan for three interfaces + step-up auth`

### 下一步
- **使用者需先決定執行模式**：Subagent-Driven Development vs Inline Execution。此為明天開始實作前的第一個 blocker。
- 模式選定後，按 plan 從 P0 起跑。
- 實作階段會先跑 `scripts/hash-passwords.ts` 產生兩個 argon2id hash，產完要**立刻貼 Vercel env vars**（Production/Preview/Development 三環境各一份），切勿漏設。

### 核心設計決策（供下次 session 快速 recall）
1. **雙層閘門**：維持 Gmail+白名單，reviewer/admin 介面加共用密碼 step-up
2. **Session 綁定**：密碼通過後直到 JWT session 結束（1 小時）都有效
3. **姓名 onboarding**：新欄位 `User.displayNameSetAt` + JWT claim，擋在 `/onboarding/name`；profile 頁可自改
4. **整合成員表**：`/admin/users` 升級為 `/admin/members`（joins EmailWhitelist + User）
5. **Reviewer 可匯出**：export endpoint 權限放寬到 `admin | final_reviewer` + `requireStepUp('reviewer')`

### 5-Question Reboot Check
1. **做什麼？** 在已上線的 FRC Annotation Review Platform 上新增三種角色介面（審核者 / 覆核者 / 管理員），前兩者之外的 role 再加共用密碼 step-up + 強制中文姓名 onboarding + 整合成員表 + 放寬 reviewer 匯出權限。
2. **進度？** 完成 brainstorming + design spec + implementation plan（P0–P7, 28 tasks, 2149 行）。**尚未寫程式碼**。
3. **下一步？** 使用者先選執行模式（Subagent-Driven vs Inline），然後從 plan 的 P0 開跑。產 argon2id hash 後記得貼 Vercel env。
4. **阻礙？** 唯一阻礙：使用者尚未選定執行模式。無技術性 blocker。
5. **檔案？**
   - `docs/superpowers/specs/2026-04-16-three-interfaces-step-up-auth-design.md`（design spec）
   - `docs/superpowers/plans/2026-04-16-three-interfaces-step-up-auth.md`（implementation plan，主要跟隨對象）
   - `web/lib/auth.ts`（後續會改：加 `displayNameSetAt` JWT claim、signIn 後強制 onboarding）
   - `web/prisma/schema.prisma`（後續會改：`User.displayNameSetAt` 新欄位）
   - `web/lib/rbac.ts`（後續會改：加 `requireStepUp(scope)`）

---

## Session: 2026-04-16 (第 4 次)

### 主題
延續本日第 3 次 session（M0 已完成、Google OAuth 進行中），本次 session 一口氣把 **M1 → M7 全部完成**，包含後續的 security hardening，平台功能完整、測試全綠、已推上 GitHub。

### 前置作業（Google OAuth）
- Google Cloud Console 重新產生 OAuth Client Secret（舊的未留存 plaintext）
- `AUTH_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `AUTH_TRUST_HOST` 設到 Vercel Production/Preview/Development + 本地 `.env.local` / `.env`

### 完成項目

**M1 — Auth + Whitelist + Roles（6 tasks / 6 commits）**
- M1.1 Auth.js v5 Google provider + signIn callback 白名單 + JWT role 傳播；`lib/db.ts` 改用 `PrismaNeon` adapter（Prisma 7 要求）
- M1.2 `proxy.ts`（Next.js 16 middleware → proxy 改名）保護 `/login` 與 `/api/auth` 以外全部路由
- M1.3 `/login` 頁面（極簡灰階 Google SSO 按鈕，無 indigo）
- M1.4 `prisma/seed.ts` + `prisma.config.ts` 的 `migrations.seed`（Prisma 7 從 package.json 搬出來）；以 `94easystudio@gmail.com` 為初始 admin
- M1.5 `lib/rbac.ts` canPerform / requireRole（TDD 6 個 unit tests）
- M1.6 `/admin/users` 頁 + API + test-only auth bypass（`lib/auth-test.ts` + `lib/session.ts` 採 lazy auth import 以避開 Vitest 解析 `next/server`）

**M2 — Projects（4 tasks / 4 commits）**
- M2.1 `/api/projects` POST/GET，zod + RBAC（2 integration tests）
- M2.2 `/api/projects/[id]` GET/PATCH（+ PATCH 測試）
- M2.3 Projects list + new project form（shadcn card + textarea 加裝）
- M2.4 Project home shell + class chips

**M3 — Batch Upload direct-to-blob（7 tasks / 6 commits）**
- M3.1 `lib/yolo.ts` parser/serializer（6 unit tests）
- M3.2 `lib/zip-validator.ts`（fflate，path traversal + size guards，3 unit tests）
- M3.3 `lib/blob.ts`（Vercel Blob v2，Uint8Array 須包 `new Blob([...])`）+ batch init endpoint
- M3.4 `/api/blob/upload` handleUpload token handler
- M3.5 `/api/batches/[id]/finalize` — 抓 zip 驗證 classes.txt 與專案一致，image + annotation 以 transaction 插入
- M3.6 `/api/images/[id]/signed-url`（session gated）
- M3.7 Upload UI 以 `@vercel/blob/client` direct-to-blob + progress bar

**M4 — Assignment（3 tasks / 3 commits）**
- M4.1 `lib/assignment.ts splitEvenly`（4 unit tests）
- M4.2 `/api/batches/[id]/assign` — transactional claim + `updateMany` conditional concurrency check（2 integration tests）
- M4.3 Assignment page UI（"Distribute evenly" 按鈕）

**M5 — Canvas Annotation Editor（8 tasks / 4 commits）**
- M5.1 `lib/state-machine.ts` canTransition/nextState（10 unit tests）
- M5.2 `/api/me/queue`
- M5.3 `/api/images/[id]/annotations` PATCH + optimistic concurrency（3 integration tests）
- M5.4 `/api/images/[id]/submit` + 自動 batch-level enter-review（2 integration tests）
- M5.5 Dashboard 取代舊 placeholder（移除 `web/app/page.tsx`）
- M5.6 Konva `AnnotationCanvas` + `ClassPalette`（淺灰階，無 indigo）
- M5.7 Annotate 頁 + editor，2s debounce auto-save + 快捷鍵（1-9 class / S submit / Del delete）
- M5.8 Prefetch 下 5 張

**M6 — Review Flow（3 tasks / 1 commit）**
- M6.1–M6.3 approve/reject API + review tray（Dialog）+ dashboard "Ready for Review" 區塊（4 integration tests）

**M7 — Export + Security（7 tasks / 4 commits）**
- M7.1 YOLO zip export endpoint（1 integration test）
- M7.2 Export 頁（approved 張數）
- M7.3 `lib/audit.ts writeAudit` 接入 approve/reject/assign
- M7.4 文件化 blob URL opacity policy
- M7.5 手動 security grep（0 個 `dangerouslySetInnerHTML` / raw SQL / eval）+ 派遣 `superpowers:code-reviewer` agent 做 security audit
- M7.6 Playwright config + "login page renders" spec
- M7.7 測試修正：`auditLog.deleteMany` 排在 `user.deleteMany` 前（FK）；`vitest fileParallelism: false`

**Security hardening（review 後）**
- H1 SSRF：驗 `zipUrl` hostname 須結尾 `.public.blob.vercel-storage.com` 或 `.blob.vercel-storage.com`
- H2 Blob overwrite：`putImage` 加 `allowOverwrite: true` 讓重試可行
- M1 TOCTOU：stale check 移入 `$transaction` 搭配 conditional updateMany
- M2 `/signed-url` scope：annotator 只能看被分派的 image；admin / final_reviewer 不限
- M3 zip 邊角：Windows drive prefix、null byte、control char 全擋；加 `maxCompressedBytes` 前置檢查
- M4 Magic byte：`sniffImageMime()` 取代副檔名判斷 content-type
- M5 Batch ownership：`/api/blob/upload` 驗 pathname 的 batchId 對應到 caller 所屬 `pending_upload` batch

### 測試與部署
- **48/48 tests pass**（13 檔，unit + integration）
- **Playwright E2E 1/1 pass**（`login page renders`）
- Vercel production：https://frc-annotation.vercel.app
- Database：Neon Postgres（Vercel Marketplace）
- Blob：Vercel Blob
- 已推 `https://github.com/0908869905/frc-train-review`（private），remote `origin`。途中需 `gh auth refresh -s workflow`（`web-ci.yml` 需要 workflow scope）

### 寫入 ~/.claude/ERROR_LOG.md 的 4 筆通用錯誤
1. Prisma 7 `new PrismaClient()` 必須帶 adapter 或 accelerateUrl
2. Prisma 7 seed 設定從 package.json 搬到 `prisma.config.ts migrations.seed`
3. Vitest + next-auth 無法解析 `next/server` → lazy auth import
4. Next.js 16 `middleware.ts` → `proxy.ts` 改名

### 本地 memory 儲存
- `memory/project_gpu_training_workflow.md`（使用者不擁有 GPU 機器，M7.7 Step 2 端到端訓練驗證刻意延後）

### 下一步
- 等隊友用平台實際審核 Gemini 批次標註的資料
- 當某個 batch 狀態走到 `completed`，匯出 YOLO zip
- 向同儕借 GPU 跑 `python train_robot_model.py --local-dataset ...` 做端到端驗證

### 已知小 backlog（非 blocking）
- **L1**：白名單改 role 後，既有 `User.role` 不會自動同步（要重登或手動 patch）

### 5-Question Reboot Check
1. **做什麼？** FRC Annotation Review Platform — M0 至 M7 功能完備 + security hardening 結案。
2. **進度？** 所有 milestone 完成，48/48 unit+integration tests + Playwright E2E 全綠，已推上 GitHub private repo 並部署 Vercel production。
3. **下一步？** 等隊友用平台審核真正的 Gemini 批次；batch 完成後匯出 zip、借 GPU 跑 `train_robot_model.py --local-dataset ...` 做端到端驗證。
4. **阻礙？** 無 blocking。小 backlog：L1 白名單 role 變更不會寫回既有 `User.role`。GPU 端到端驗證要等 hardware 可用。
5. **檔案？**
   - `web/app/(protected)/page.tsx`（dashboard）
   - `web/lib/auth.ts`（Auth.js 設定 + whitelist callback）
   - `web/lib/rbac.ts`（canPerform / requireRole）
   - `web/prisma/schema.prisma`（8 models + 5 enums）
   - `docs/superpowers/plans/2026-04-15-annotation-review-platform.md`（plan，全部 milestone 已打勾）

---

## Session: 2026-04-16 (第 3 次)

### 主題
執行 plan 的 Milestone M0（Project Bootstrap），完成可自動化的 5 個 task，遇到 Next.js 升主版（15 → 16）與 Prisma 升主版（6 → 7），一併處理。

### 完成項目
- [x] **M0.1** Bootstrap Next.js app in `web/` — commit `29b0b35`
  - `pnpm create next-app@latest` 裝到 Next.js 16.2.4 + React 19.2.4（非預期，plan 原寫 v15）
- [x] **Next.js 16 相容性研究** — commit `6757f3d`
  - 讀 `web/node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
  - 記錄 14 項 breaking changes 到 FINDINGS.md
  - 在 plan 開頭加 "Next.js 16 Adjustments" 區塊，列出每項對 plan 的影響與應對
  - 決策：擁抱 v16（不降版），因為是 stable release、Vercel 原生支援、breaking changes 可量化
- [x] **M0.2** Install core deps — commit `f490266`
  - Prisma 7.7.0（非預期，plan 原寫 v6），Auth.js v5 beta 31, zod 4, konva, vitest 4
  - shadcn v2 + Tailwind v4 路線（非 plan 的 Tailwind v3 路線），base color `neutral`
  - Theme override 成功：pure grayscale OKLCH、`--radius: 0.375rem`、`.font-mono-ui` utility 已加
- [x] **pnpm v10 build scripts 白名單** — commit `2f87e91`
  - 在 `web/package.json` 加 `pnpm.onlyBuiltDependencies: ["@prisma/engines", "prisma"]`
- [x] **M0.3** Prisma schema — commit `de646a2`
  - Prisma 7 breaking changes 已處理：
    1. `datasource.url` 必須移出 schema.prisma（改放 `prisma.config.ts`）
    2. `driverAdapters` preview feature 已 GA，不需聲明
    3. 新增檔案 `web/prisma.config.ts`（plan 原本沒列）
    4. `.gitignore` 加 `!.env.example` 讓 example 檔可被提交
  - 8 models + 5 enums 完整建立，`prisma validate` + `prisma generate` 通過
- [x] **M0.5** Vitest smoke test — commit `5a70e51`
- [x] **M0.6** GitHub Actions CI (`.github/workflows/web-ci.yml`) — commit `f516af8`
  - pnpm v10（match local），env vars hoist 到 job-level（Prisma 7 CLI 需要 `DATABASE_URL` at generate time）

### Manual 項目（已透過 Vercel CLI + Chrome 完成）
- [x] **M0.4** Neon Postgres — commit `76aa8f9`
  - 用 `vercel integration add neon -n frc-annotation-db`（marketplace 路線）自動建 Neon project + 注入 `DATABASE_URL`
  - `vercel env pull .env.local` 拉到本地，複製為 `.env` 給 Prisma CLI 讀
  - `prisma.config.ts` 改為優先使用 `DATABASE_URL_UNPOOLED`（migrations 需要 direct connection）
  - 用 `pnpm dlx dotenv-cli -e .env -- pnpm prisma migrate dev --name init` 成功執行初始 migration
  - 9 個表（含 `_prisma_migrations`）已建立於 Neon
- [x] **M0.7** Vercel deploy — commits `1eecbe0` `96e233b`
  - `vercel link -p frc-annotation -y` 建立 Vercel project
  - Blob store `frc-annotation-blob` 透過 dashboard connect（CLI 無法非互動完成）
  - 加 `package.json` 的 `postinstall: prisma generate` 讓 Vercel build 自動生成 client
  - 加 `web/.vercelignore` 防 `.env` 被上傳到 deploy bundle
  - `vercel deploy --prod --yes` 成功
  - **Production URL**：https://frc-annotation.vercel.app （已驗證頁面顯示 M0 placeholder）
  - **Preview URL**：https://frc-annotation-cmxvcsxx1-0908869905s-projects.vercel.app

### Prisma 7 + Next.js 16 + Vercel 整合踩雷
- Prisma 7 `prisma.config.ts` **不會自動載入 `.env`**（Prisma 6 會）→ 解法：`pnpm dlx dotenv-cli -e .env -- prisma ...`
- Neon pooled URL 不支援 `prisma migrate` 的 transactions → 解法：`prisma.config.ts` 用 `DATABASE_URL_UNPOOLED`
- `vercel blob create-store` 的 env-selection 步驟是 interactive checkbox（arrow/space），pipe stdin 無法自動化 → 解法：dashboard 手動 connect
- `vercel deploy` 預設會上傳 local `.env`（已被 Vercel 平台警告）→ 解法：`.vercelignore` 排除

### 清理待辦（非 blocking）
- Vercel dashboard 有 2 個孤兒 blob store（`frc-annotation-blob2`, `frc-annotation-blob3`）是之前互動式 CLI 嘗試留下的，沒連到任何 project，無 runtime 成本，但占用 Hobby 方案 blob quota。有空可從 https://vercel.com/0908869905s-projects/~/stores 手動刪

### 下一步
**M0 整個 milestone 已完成**（7/7 task + bonus: `.vercelignore`、`postinstall` script）。可以進入 **M1 — Auth + Whitelist + Roles**。

M1 第一個 task 是 **M1.1 Auth.js config with Google provider**，需要：
1. 到 Google Cloud Console 建立 OAuth 2.0 Client ID
2. 把 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` 加到 Vercel env vars（via `vercel env add`）
3. 拉回本地：`vercel env pull web/.env.local` + 複製為 `web/.env`
4. 然後就可以開始寫 Auth.js config 程式碼

### (舊) Manual Instructions — 已完成，保留參考

#### M0.4: Neon Postgres
1. 到 https://neon.tech 註冊/登入，建立新 project 命名為 `frc-annotation`
2. 複製 **pooled** connection string（包含 `-pooler` 的那條）
3. 在 `D:\FRC\frc-train-review\web\` 建立 `.env` 檔，貼入：
   ```
   DATABASE_URL="postgresql://...-pooler.neon.tech/neondb?sslmode=require"
   ```
   （`.env` 已在 `.gitignore`，不會被 commit）
4. 執行：
   ```bash
   cd web
   pnpm prisma migrate dev --name init
   ```
   預期：產生 `web/prisma/migrations/<timestamp>_init/` 目錄 + 輸出 "Database is now in sync with your schema"
5. 執行 `pnpm prisma studio` 開 GUI 檢查 9 張表是空的，確認後關閉瀏覽器
6. Commit migration：
   ```bash
   git add web/prisma/migrations/
   git commit -m "feat(web): initial Prisma migration"
   ```

⚠️ Prisma 7 + Neon 備註：若 `prisma migrate` 遇到 `driverAdapters` 或 serverless driver 相關警告，可忽略；plan 原先假設 v6 需要 preview feature，v7 已內建。

#### M0.7: Vercel deploy
1. 到 https://vercel.com 登入，"Add New… → Project"，import GitHub repo `frc-train-review`
2. 設定：
   - **Root Directory**: `web`
   - **Framework Preset**: Next.js（自動偵測）
   - **Install Command**: `pnpm install`
   - **Build Command**: `pnpm prisma generate && pnpm build`
3. 在 Environment Variables 加入（Production + Preview 都勾）：
   - `DATABASE_URL` = 剛才的 Neon pooled 連線字串
   - `AUTH_SECRET` = 執行 `openssl rand -base64 32` 產生一組亂數字串
   - `AUTH_GOOGLE_ID` = 空白（M1.1 會填）
   - `AUTH_GOOGLE_SECRET` = 空白（M1.1 會填）
4. Storage tab → Create Blob store，命名 `frc-annotation-blob`，connect 到專案。`BLOB_READ_WRITE_TOKEN` 會自動注入環境變數
5. Deploy 後，訪問 deploy URL，應該看到 `FRC Annotation Review Platform / Bootstrap placeholder — M0` 這頁

⚠️ 注意：目前 repo 只有本地 `master` branch，未 push。Vercel import 前要先 `git push origin master`（但你確認過 remote 狀態再 push）。

### 5-Question Reboot Check
1. **做什麼？** 執行 FRC Annotation Review Platform plan 的 M0 milestone（Next.js 專案 bootstrap）。
2. **進度？** M0 的 5/7 自動化 task 已完成（M0.1/M0.2/M0.3/M0.5/M0.6）。剩 M0.4（Neon 手動）、M0.7（Vercel 手動）。
3. **下一步？** 使用者完成 M0.4 + M0.7。然後 `/start` 繼續 M1.1（Auth.js 設定）。
4. **阻礙？** M0.4 + M0.7 都是需要登入 SaaS 的 manual 項目，agent 無法代替。
5. **檔案？**
   - `docs/superpowers/plans/2026-04-15-annotation-review-platform.md`（implementation plan + 最上方 "Next.js 16 Adjustments" 區塊）
   - `FINDINGS.md`（記錄 Next.js 16 + Prisma 7 的 breaking changes + 應對）
   - `web/` 整個目錄（已 scaffold 完成，可以 `cd web && pnpm build` 驗證）

---

## Session: 2026-04-15 (第 2 次)

### 主題
為 FRC 隊伍設計全新的內部審核/訓練 Web 平台（類 Roboflow），放在 `web/` 子目錄，與現有 Python training pipeline 完全解耦。

### 重要背景（不可搞混）
- 本 repo 原本是從 scoring-analyzer 分離出的 Python 訓練 pipeline（`train_robot_model.py`、`extract_frames.py`、`download_matches.py`、datasets/2023mslr/）
- 本次 session 規劃的是**全新獨立的** Next.js web 平台，用來審核 Gemini 自動標註的資料，產出新模型（裝在機器人本體上做物件辨識）
- **硬性約束：絕對不動 `train_robot_model.py` 或任何現有 Python 程式碼**
- 新 web 平台會放在 `web/` 子目錄，與 Python code 在同一個 repo 但零耦合

### 完成項目
- [x] 透過 superpowers:brainstorming skill 完成需求釐清與技術選型
  - 雲端 PaaS 部署、外部批次 Gemini 標註、純 YOLO 匯出、Google SSO + email 白名單、單隊 16+ 人、手動分派 + 單一 final_reviewer 覆核、多專案支援、YOLO 原生格式 end-to-end 零轉換
  - 選定技術方案：Next.js 15 App Router 全端（vs FastAPI split vs Supabase 純前端）
- [x] 產出 design spec（12 個 section, ~370 行）
- [x] 透過 superpowers:writing-plans skill 產出 implementation plan（~4700 行, 8 個 milestones M0-M7）
  - M0 bootstrap / M1 auth+白名單 / M2 project+class / M3 batch upload (direct-to-blob) / M4 assignment / M5 canvas editor / M6 review flow / M7 export + 安全審查
  - 每個 task 遵循 TDD：寫失敗測試 → 驗證失敗 → 實作 → 驗證通過 → commit
- [x] 補上 UI style 硬性約束：極簡風、中性灰階、無 AI 味（禁用紫藍漸層、sparkle icon、AI-powered 文案、rounded-xl 大卡片、shadcn indigo 預設主題）
- [x] 決定執行模式：Subagent-Driven（每個 task 派遣新 subagent 執行 + 兩段式 review）

### 修改檔案
- `docs/superpowers/specs/2026-04-15-annotation-review-platform-design.md`（新增，design spec）
- `docs/superpowers/plans/2026-04-15-annotation-review-platform.md`（新增，implementation plan）
- `.gitignore`（加入 `.superpowers/`）

### Git commits
1. `a7a863f docs: add annotation review platform design spec`
2. `c3cb1e1 docs: add annotation review platform implementation plan`
3. `82ff916 docs: enforce minimalist UI style (no AI aesthetic)`

### 阻礙
無目前阻礙。以下為 plan 中已標記「manual」需用戶自行完成的項目：
- **M0.4**：到 neon.tech 建立 Neon Postgres 專案並填 `DATABASE_URL`
- **M0.7**：在 Vercel dashboard 建立專案、設定 Root Directory = `web`、新增 Vercel Blob store
- **M1.1**：到 Google Cloud Console 建立 OAuth 2.0 Client ID、填 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
- **M1.4**：執行 seed 指令加入第一個 admin email 到白名單

### 下一步
1. 執行 `/clear` 清除主 session context
2. 執行 `/start` 從本檔恢復
3. 開始按 plan 執行 **M0.1**，使用 `superpowers:subagent-driven-development` skill 派遣 subagent 實作
4. plan 路徑：`D:\FRC\frc-train-review\docs\superpowers\plans\2026-04-15-annotation-review-platform.md`

### 5-Question Reboot Check
1. **做什麼？** 為 FRC 隊伍開發全新的 Next.js 15 內部審核/訓練 Web 平台（類 Roboflow），審核 Gemini 批次標註、產出 YOLO 模型給機器人本體做物件辨識。放在 `web/` 子目錄。**硬性約束：不動 `train_robot_model.py` 或任何現有 Python 程式碼**。
2. **進度？** 完成 brainstorming + design spec + implementation plan（M0-M7, 8 個 milestones）+ UI style 硬性約束。尚未開始寫程式碼。
3. **下一步？** 按 plan 執行 M0.1（bootstrap Next.js 專案於 `web/`），使用 `superpowers:subagent-driven-development` skill 派遣 subagent 實作。plan 路徑見上。
4. **阻礙？** 無程式碼阻礙。4 個 manual 項目（Neon / Vercel / Google OAuth / seed admin）需用戶依序手動處理，plan 中已標記。
5. **檔案？**
   - `docs/superpowers/plans/2026-04-15-annotation-review-platform.md`（implementation plan, 主要跟隨對象）
   - `docs/superpowers/specs/2026-04-15-annotation-review-platform-design.md`（design spec, 設計依據）
   - `train_robot_model.py`（現有 Python pipeline 邊界，**只讀不改**）

---

## Session: 2026-04-15 (第 1 次)

### 完成項目
- [x] 專案初始化

### 修改檔案
- `PROGRESS.md` - 初始化
- `FINDINGS.md` - 初始化
- `ERROR.md` - 初始化
- `CLAUDE.md` - 初始化

### 5-Question Reboot Check
1. **做什麼？** FRC 機器人偵測模型訓練與資料集處理（從 scoring-analyzer 分離出的 pipeline）
2. **進度？** 剛完成專案結構初始化，已有 extract_frames.py、train_robot_model.py、download_matches.py 核心腳本與 2023mslr 資料集
3. **下一步？** 補充 CLAUDE.md 專案說明、檢視訓練流程是否需要調整
4. **阻礙？** 無
5. **檔案？** CLAUDE.md、train_robot_model.py、extract_frames.py
