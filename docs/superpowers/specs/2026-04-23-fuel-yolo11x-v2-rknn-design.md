# Fuel-only yolo11x v2 + RKNN（INT8 + FP16）部署設計

**日期**：2026-04-23
**作者**：session 18
**背景**：session 16/17 把 session 14 訓好的 fuel-only yolo11x 轉成 RK3588 RKNN（INT8 + FP16），使用者板端 INT8 實測發現遮擋 fuel 偵測率差、懷疑量化，FP16 A/B 尚未回報。本次 session 使用者決定用最新 1342 張資料集重訓 yolo11x、直接上機器人測試，同時要求強化資料增強。

---

## 1. 目標與非目標

### 目標
1. 用最新資料集 `FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip`（1342 張、3 類）訓練 fuel-only yolo11x
2. 強化 Ultralytics online augmentation（曝光、角度、透視、copy_paste）
3. 產出 RK3588 NPU 可用的 RKNN 檔兩版（INT8 + FP16）
4. 提供 simulator cos similarity 驗證報告，確認轉換無損

### 非目標
- 板端實機效能測試（使用者自行上機器人做）
- 重新設計 post-process（session 16 `yolo11.py` 沿用）
- Hybrid quantization / `quantized_algorithm='mmse'`（session 17 留的備案，本次不做）
- 訓練 3 類模型（本次明確 fuel-only）

---

## 2. 輸入與產物

### 輸入
- `FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip`（1342 張 + 1342 label，含 red_robot/blue_robot/fuel 3 類原始標註）
- 使用者需手動上傳到 Google Drive：`MyDrive/frc-train/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip`（保留原檔名，不改名）

### 產物
| 檔案 | 位置 | 大小估計 | 說明 |
|---|---|---|---|
| `best_v2.pt` | Colab Drive + 使用者 Downloads | ~109 MB | yolo11x PyTorch 權重 |
| `best_v2.onnx` | Colab Drive + 使用者 Downloads | ~217 MB | 官方 ultralytics ONNX（參考用） |
| `best_v2_airockchip.onnx` | WSL `~/rknn-work/` | ~217 MB | airockchip 3-tail ONNX（RKNN 轉換來源） |
| `best_v2_rk3588_int8.rknn` | `C:\Users\USER\Downloads\` | ~62 MB | INT8 量化、NPU 全加速 |
| `best_v2_rk3588_fp16.rknn` | `C:\Users\USER\Downloads\` | ~120 MB | FP16、NPU 部分加速 |
| simulator 驗證 log | 對話內 | 文字 | class cos / bbox DFL cos 對比 |

---

## 3. 架構（三 Stage Pipeline）

```
Stage 1 (Colab T4)                  Stage 2 (WSL conda rknn)       Stage 3 (WSL conda rknn)
──────────────────────              ─────────────────────────      ──────────────────────────
新 zip 1342 張                      best_v2.pt                     best_v2_airockchip.onnx
  ↓ filter class 2 → remap 0          ↓                              ↓
  ↓ 80/20 train/val                 airockchip export              convert.py i8（200 cal）
  ↓ yolo11x @ imgsz=640               ↓                              ↓
  ↓ batch=8, epochs=50              best_v2_airockchip.onnx        best_v2_rk3588_int8.rknn
  ↓ 強化 augmentation                                                ↓
  ↓ (hsv_v=0.6, degrees=15, ...)                                   convert.py fp（無 cal）
best_v2.pt + best_v2.onnx                                            ↓
                                                                  best_v2_rk3588_fp16.rknn
                                                                     ↓
                                                                   simulator cos 驗證
```

**Stage 間解耦**：
- Stage 1 完成 → 使用者從 Drive 下載 `best_v2.pt` 到 Windows Downloads
- Stage 2/3 在 WSL 本機跑，input 從 `/mnt/c/Users/USER/Downloads/best_v2.pt` 讀
- 這樣切分的原因：Colab 不適合裝 rknn-toolkit2（session 16 CCC-2 版本鎖複雜、session 斷了要重建），WSL 環境已常駐

---

## 4. Stage 1 細節（Colab 訓練）

### 4.1 檔案
新增 `train_fuel_yolo11x_v2.ipynb`（**不覆蓋**現有 `train_fuel_yolo11x.ipynb`，保留 session 14 版可回滾）。

### 4.2 設定
```python
ZIP_PATH = '/content/drive/MyDrive/frc-train/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip'
MODEL = 'yolo11x.pt'
EPOCHS = 50
IMGSZ = 640
BATCH = 8
VAL_RATIO = 0.2
SEED = 42
RUN_NAME = 'frc_fuel_yolo11x_v2'
FUEL_ORIGINAL_CLASS_ID = 2  # 3 類 zip 裡 fuel 的 class id
```

### 4.3 資料處理流程（沿用 session 14 notebook）
1. 解壓 zip 到 `/content/dataset/_raw/`
2. 按 `SEED=42` shuffle，80/20 切 train/val
3. Filter labels：只保留 class 2 (fuel)、remap 為 class 0，其他 class 刪除
4. 沒有 fuel 的圖保留為背景（空 label 檔）
5. 寫 `data.yaml`（nc=1、names={0: fuel}）

### 4.4 Augmentation 參數（本次強化重點）

| 參數 | Ultralytics 預設 | 本次設定 | 用意 |
|---|---|---|---|
| `hsv_h` | 0.015 | **0.02** | 白平衡偏差（場館燈光色溫差異） |
| `hsv_s` | 0.7 | **0.8** | 飽和度變化（不同場地反光） |
| `hsv_v` | 0.4 | **0.6** | 曝光度（逆光/過曝/陰影） |
| `degrees` | 0.0 | **15** | 鏡頭傾斜（機器人搖晃） |
| `translate` | 0.1 | **0.2** | 位置泛化 |
| `scale` | 0.5 | **0.6** | 距離遠近 |
| `shear` | 0.0 | **3.0** | 輕微錯切 |
| `perspective` | 0.0 | **0.0005** | 輕微透視 |
| `flipud` | 0.0 | **0.0** | ⚠️ 保持 0 — fuel 有重力方向 |
| `fliplr` | 0.5 | **0.5** | 左右翻（對稱） |
| `mosaic` | 1.0 | **1.0** | 4 圖拼接 |
| `mixup` | 0.0 | **0.15** | 兩圖混合 |
| `copy_paste` | 0.0 | **0.3** | fuel 物件複製增加密度 |

**連續 sampling 說明**：這些參數是**最大強度**，實際訓練時每張圖每個 epoch 從 `[-max, +max]`（或 `[0, max]`）之間取連續隨機值。50 epochs × 1342 張 ≈ 67,100 組不同變換。不是 0/max 二元。

**過激進 fallback**：若訓練前 5 epoch 看到 loss 爆高或 NaN，降 `copy_paste=0.15`、`hsv_v=0.4`、`degrees=10` 重跑。

### 4.5 訓練呼叫
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
    # 強化 augmentation
    hsv_h=0.02, hsv_s=0.8, hsv_v=0.6,
    degrees=15, translate=0.2, scale=0.6,
    shear=3.0, perspective=0.0005,
    flipud=0.0, fliplr=0.5,
    mosaic=1.0, mixup=0.15, copy_paste=0.3,
)
```

### 4.6 驗收基準
- `mAP50 ≥ 0.90`（session 14 baseline 0.954，不該退步超過 5%）
- `mAP50-95 ≥ 0.65`（session 14 baseline 0.746）
- 若 mAP 退步超過 5%，停下、不進 Stage 2/3，先降低 augmentation 強度重訓

### 4.7 輸出（Drive）
- `MyDrive/frc-train/runs/frc_fuel_yolo11x_v2-<ts>/` 含 weights/best.pt、best.onnx、results.png/csv、metrics.json
- `run_full.zip`（整包 backup）

### 4.8 預估時間
T4 + yolo11x + 1342 張 + 50 epochs ≈ **3–4 小時**（比 session 14 的 1088 張多 25%）

---

## 5. Stage 2/3 細節（WSL RKNN 轉換）

### 5.1 環境
沿用 session 16 建立的 WSL conda env：
- `~/rknn-work/`（env path）
- conda env `rknn`（python 3.10）pinned：rknn-toolkit2 2.3.2 / torch 2.4.0+cpu / numpy 1.26.4 / onnx 1.17.0 / setuptools<80 / ultralytics 8.3.9（airockchip fork editable）
- 參考 session 16 CCC-2 的版本鎖細節

### 5.2 新增腳本
新增 `_train_v2_to_rknn.sh`（repo 外、`_` 前綴 local-only、git untracked），內容：
```bash
#!/bin/bash
set -e
cd ~/rknn-work

# 1. 接收新 best.pt
cp /mnt/c/Users/USER/Downloads/best_v2.pt best.pt

# 2. airockchip export → 3-tail ONNX
#    重用 session 16 的 _export_rknn_onnx.sh（editable install 的 airockchip/ultralytics_yolo11 fork
#    會輸出 3-tail 9-output ONNX 給 RKNN）
bash _export_rknn_onnx.sh best.pt best.onnx

# 3. 重抽 calibration 200 張
python _prepare_calib.py \
    --zip /mnt/d/FRC/frc-train-review/FRC-2026-04-18-auto--yolo-2026-04-22T15-58-55-995Z.zip \
    --n 200 --seed 42 \
    --out calib_images_v2/ --list calibration_v2.txt

# 4a. INT8 版
python rknn_model_zoo/examples/yolo11/python/convert.py \
    best.onnx rk3588 i8 best_v2_rk3588_int8.rknn

# 4b. FP16 版
python rknn_model_zoo/examples/yolo11/python/convert.py \
    best.onnx rk3588 fp best_v2_rk3588_fp16.rknn

# 5. simulator cos 驗證
python _verify_rknn_vs_onnx.py --onnx best.onnx \
    --rknn_int8 best_v2_rk3588_int8.rknn \
    --rknn_fp16 best_v2_rk3588_fp16.rknn

# 6. 複製到 Windows Downloads
cp best_v2_rk3588_int8.rknn best_v2_rk3588_fp16.rknn /mnt/c/Users/USER/Downloads/
echo "✅ 完成，產物在 /mnt/c/Users/USER/Downloads/"
```

### 5.3 `_prepare_calib.py`（新增）
- Input：新 zip 路徑、抽樣數量、seed
- Output：解壓 200 張圖到 `calib_images_v2/`、寫 `calibration_v2.txt`（convert.py 吃的 path list）
- 邏輯：用 seed 固定隨機抽 200 張（從全部 1342 張，不限 fuel-only — 讓 INT8 看到真實分佈含背景）

### 5.4 `_verify_rknn_vs_onnx.py`（重用 session 16）
- 3 張測試圖
- load_onnx + build + init_runtime(target=None) 走 simulator
- 比對：ONNX vs RKNN 9 個 output 的 cosine similarity
- 驗收：
  - INT8: class cos > 0.99、bbox DFL cos > 0.7（DFL 對 INT8 敏感、這是合理範圍）
  - FP16: class cos > 0.99、bbox DFL cos > 0.99（FP16 應近乎無損）

### 5.5 失敗處置
- INT8 bbox DFL cos < 0.7 → 可能 calibration 集不代表性，重抽或換 `quantized_algorithm='mmse'`
- FP16 bbox DFL cos < 0.99 → 轉換 bug，**停下回報**、不交付
- airockchip export 失敗 → 查 session 16 ERROR.md E34–E41

---

## 6. 不變動的檔案

明確列出**不動**的 repo 檔案（避免 scope creep）：
- `train_robot_model.py`（原 Python training pipeline，CLAUDE.md 列「絕對不動」）
- `train_fuel_yolo11x.ipynb`（session 14 原版，作為 fallback）
- `train_fuel_yolo11n.ipynb`（session 14 fuel-only 11n）
- `rknn_model_zoo/examples/yolo11/python/yolo11.py`（post-process，CLASSES/OBJ_THRESH 保 session 16 版）
- `web/`（Next.js annotation platform，與本次無關）

---

## 7. 測試策略

| 階段 | 測試 | 通過標準 | 失敗處理 |
|---|---|---|---|
| Stage 1 訓練中 | Ultralytics 自動 val/每 epoch | loss 正常下降、無 NaN | NaN/爆高 → 降 augmentation |
| Stage 1 完成 | `model.val()` final metrics | mAP50 ≥ 0.90、mAP50-95 ≥ 0.65 | 低於 → 停、降 augmentation 重訓 |
| Stage 3 INT8 | simulator cos | class > 0.99、bbox DFL > 0.7 | 低於 → 重抽 cal 或換 mmse |
| Stage 3 FP16 | simulator cos | class > 0.99、bbox DFL > 0.99 | 低於 → 停、不交付 |
| 板端（使用者） | 實測 FPS + 遮擋偵測率 | 使用者主觀驗收 | 不在本 spec |

---

## 8. Commit 策略

| 時間點 | commit 內容 |
|---|---|
| Stage 1 完成後 | `feat(train): add yolo11x v2 notebook with strengthened augmentation`（含 notebook + PROGRESS.md session 18 上半） |
| Stage 3 完成後 | `docs: session 18 RKNN v2 INT8/FP16 complete`（PROGRESS.md 下半 + 可能的 FINDINGS/ERROR 更新） |
| RKNN 檔 | **不進 repo**（`.gitignore` 已涵蓋、太大） |
| WSL 腳本 | **不進 repo**（`_*.sh` / `_*.py` 已 git untracked） |

---

## 9. 風險與 Blocker

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| Colab T4 idle disconnect | 中 | 訓練中斷 | 保持瀏覽器開、notebook 支援 `resume=True` 從 `last.pt` 續訓 |
| augmentation 過激進導致 loss 爆 | 低 | 需降參數重訓 | 前 5 epoch 監控、快速 fallback |
| Colab T4 batch=8 OOM（@ imgsz=640） | 低 | 需降 batch | session 14 已驗證 batch=8 @ 640 可跑 |
| airockchip export 失敗 | 低 | 停 Stage 2 | session 16 已驗證流程 |
| FP16 轉換 bbox cos < 0.99 | 低 | 停、不交付 | 轉換路徑跟 session 17 完全一致、session 17 已通過 |
| 板端實機效能不及預期 | 中 | 需走 session 17 改進 action plan | 不在本 spec、使用者決定 |

---

## 10. 不做什麼（明確 out-of-scope）

- 不訓練 3 類模型（明確 fuel-only）
- 不動 `train_robot_model.py`
- 不做 offline pre-augmentation（改用 Ultralytics online）
- 不跑 hybrid quantization / mmse（備案，等板端實測結果決定）
- 不改 post-process `OBJ_THRESH`（沿用 session 16 0.25；若板端偵不到可使用者改到 0.15）
- 不做板端實機測試（使用者自做）
- 不新寫 `rknn_model_zoo/examples/yolo11/python/yolo11.py` 的 post-process（沿用）

---

## 11. 下一步

完成本 spec 後：
1. 叫 writing-plans skill 產 implementation plan（含 step-by-step 執行序、檢查點、failure recovery）
2. 按 plan 開始實作（先 Stage 1 notebook、使用者上 Colab 跑、拿到 best_v2.pt 後再做 Stage 2/3）
