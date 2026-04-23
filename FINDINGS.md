# frc-train-review - 技術發現

記錄格式：問題 → 原因 → 解決方案 → 選擇理由

---

## 2026-04-23（第 18 次）fuel yolo11x v2 重訓 + RKNN 雙版 convert（session 16/17 延續）

### 發現 DDD-1：換模型版本時 calibration set 一定要重抽、不能重用舊 session 的 200 張

**問題**：session 18 用新 1342 張資料集重訓 fuel-only yolo11x（session 16 是 1088 張）。要產 INT8 RKNN 時面臨一個看似無害的選擇:`calib_images/` 資料夾裡還躺著 session 16 的 200 張 calibration set（從舊 1088 張抽的）、直接重用就能省 2 分鐘。使用者一開始也沒意識到這是個決策點。

**原因**：RKNN INT8 calibration 的本質是 per-tensor activation range 校準 — tool 跑 calibration set 的每張圖、紀錄每個 layer activation 的 min/max、用來算 scale/zero_point。若 calibration 集的分布**偏離當前模型權重分布**、quantization error 會被放大:

- Session 16 的 200 張 calibration 抽自 1088 張、對應 session 16 模型權重的 activation 分布
- Session 18 模型權重已變（新 254 張 + augmentation 強化、整個 feature space 移位了）
- 用舊 calibration 校新 weights、等於用「別的相機拍的直方圖校 RGB 曲線」

理論上這個 gap 不會破功能、但會讓 quantization error 放大。實際觀察:

| Session | Calibration 來源 | INT8 bbox DFL cos |
|---|---|---|
| 16（1088 張訓練） | 從 1088 抽 200 | 0.69 ~ 0.96 |
| 18（1342 張訓練） | **從 1342 重抽 200**（seed=42） | **0.90 ~ 0.99** |

Bbox DFL cos 下限從 0.69 拉到 0.90、差三個數量級的 quantization error。雖然 session 18 同時強化了 online augmentation（hsv_v=0.6 / degrees=15 / copy_paste=0.3 / mixup=0.15）、兩個因子耦合、沒做純 ablation、無法 100% 歸因給 calibration。但 augmentation 單獨很難讓量化誤差下限從 0.69 跳到 0.90(augmentation 主要改 generalization、不直接改 activation 分布)、calibration 重抽是主因的可能性高。

**解決方案**：每次換訓練 checkpoint 或換資料集、**一定重抽 calibration**:

```python
# seed 固定確保可重現
random.seed(42)
all_images = sorted(glob(f"{train_dir}/*.jpg"))
calib_200 = random.sample(all_images, 200)
```

成本:1–2 分鐘,收益:bbox DFL cos 下限從 0.69 提升到 0.90 等級。

**選擇理由**：
- **成本極低**:1–2 分鐘抽樣 + copy,vs quantization error 失效的下游成本(板端漏偵、返工重 train、使用者懷疑模型壞)成本巨大
- **不重抽的潛在收益為零**:省 2 分鐘、換一個潛在量化誤差放大問題、永遠不值得
- **不用糾結抽樣策略**:random 200 張對 fuel detection 夠用。若要更 defensively、可按場景分佈分層抽樣(ex: 比賽類型 / 遮擋程度 / 光照分 strata),但目前沒 evidence 需要

**未來重用**：任何 post-training quantization pipeline（RKNN / TensorRT INT8 / ONNX Runtime QDQ / TFLite INT8）都適用「calibration 集必須對應當前 weight 版本」原則。每次 fine-tune、加資料、換 backbone 都要重抽。把 calibration set 當 artifact 跟 model weight 綁在一起管理、不是獨立共用資源。

---

### 發現 DDD-2：Ultralytics augmentation 是連續 sampling、不是 binary 開關

**問題**：使用者看 `train_fuel_yolo11x.ipynb` 的 augmentation 參數時、一開始把 `degrees=15` / `hsv_v=0.6` / `copy_paste=0.3` 理解為「binary 開關」 — 以為設 `degrees=15` 就是「每張圖都旋轉 15°」、設 `copy_paste=0.3` 就是「30% 的圖做 copy-paste、70% 不動」。這個誤解影響對 augmentation 強度的估算、可能導致下次調參時不知道「拉 degrees 15 → 20」到底發生什麼。

**原因**：Ultralytics 的 augmentation pipeline 是**連續 per-image per-epoch 隨機 sampling**、不是開關型:

| 參數 | 實際語意 |
|---|---|
| `degrees=15` | 每張圖每 epoch 從 `U[-15°, +15°]` 連續取樣旋轉 |
| `hsv_v=0.6` | value channel 從 `U[-0.6, +0.6]` 連續取樣位移 |
| `copy_paste=0.3` | **30% 機率**觸發 copy-paste（這個是概率開關）、觸發後 paste 的物件位置/大小仍隨機 |
| `mixup=0.15` | **15% 機率**跟另一張圖做 mixup、alpha 混合比例也隨機 |
| `flipud=0` | **0% 機率**上下翻轉（fuel 有重力、上下翻轉物理上錯、所以關掉） |

概率類（copy_paste / mixup / flipud）是「0-1 之間的觸發機率」、連續類（degrees / hsv_v / translate / scale）是「random sampling 的上下界」。兩種都不是 binary。

對 session 18 的實際意義:
- 50 epochs × 1342 張 = 67,100 次 forward pass
- 每個 pass 的輸入圖都走過 `degrees / hsv / translate / scale / copy_paste / mixup` 的**獨立隨機組合**
- 實際「看過的不同變換組合」 ≈ 67,100 組（去掉 copy_paste / mixup 不觸發的部分、仍是數萬組）

這個量級遠超「offline augment 3 倍資料就當作有 4k 張」的直覺估算、是 online augmentation 真正便宜的原因(零磁碟成本、零 data leakage 風險、每 epoch 都是新組合)。

**解決方案**：心智模型改成「augmentation 是 distribution over transformations、不是 set of transformed images」。調參時:

- 調連續類參數（degrees, hsv_*, translate, scale, shear）= **調變換分布的方差**(範圍拉大 = 分布變寬)
- 調概率類參數（copy_paste, mixup, mosaic, flipud, fliplr）= **調觸發頻率**
- 兩種要分開想、不要混成「開強度」單一維度

**選擇理由**：
- 搞清楚語意後、下次調參就不會「拉 degrees 15 → 30 看看」(會讓旋轉分布過寬、很多樣本變成非 realistic 的極端角度、反而傷 generalization)、而是按場景真實分布決定範圍
- 概率類參數「15% 夠不夠」的問題有標準答案:看 mAP 訓練曲線、若 val loss 比 train loss 低太多、說明 regularization 夠、可降參數;反之加重

**未來重用**：所有以 Ultralytics 為骨幹的訓練（yolo11 / yolo12 / rtdetr）augmentation 都是這套語意。換 framework（例如 MMDetection / Detectron2 / PaddleDetection）、要重新查各自的語意、別直接套用 Ultralytics 的直覺。

---

### 發現 DDD-3：RKNN FP16 convert 的「全 NPU path」驗證靠 build log grep、不是執行時計時

**問題**：session 17 CCC-6 提到「FP16 build log 無 op fallback warning → 全圖在 NPU FP16 path」、但沒明文寫驗證方法。session 18 補上:要判斷一個 RKNN model 是否全 NPU 跑、最便宜的方式是 convert 階段 grep build log、不是部署後測延遲。

**原因**：有兩條思路判斷 RKNN model 是否 fallback CPU:

| 方法 | 成本 | 可信度 | 何時能用 |
|---|---|---|---|
| **Build log grep**（`fallback` / `not support` 關鍵字） | 幾秒 | 高(官方 toolkit 會明文列 fallback op) | convert 當下 |
| 板端 inference 延遲對比 | 要真板、10 分鐘 | 中(延遲差可能來自多因子) | 板子手上 |
| `rknn.eval_perf()` per-layer profile | 要板端連線、5 分鐘 | 最高(精確到每層時間) | 板子 + 會跑 profile |

Build log grep 是唯一在 convert 階段就能做的。rknn-toolkit2 build 過程對每個 unsupported op 會印:
```
W ... op 'XXX' is not supported by NPU, fallback to CPU
```
或類似 `not support`, `unsupport`。若整個 log 沒這類 warning、整張圖都在 NPU。

**解決方案**：convert 完立刻 grep:

```bash
# WSL 端
cd ~/rknn-work
grep -iE "fallback|not support|unsupport" convert_fp16.log convert_int8.log
# 無輸出 → 全 NPU path
```

Session 18 實測:
- `convert_fp16.log`:無 match → FP16 全 NPU ✓
- `convert_int8.log`:無 match → INT8 全 NPU ✓

只要是 airockchip fork 的 9-output 3-tail 結構（見 CCC-1）、fallback warning 正常應為零。若出現 warning、通常代表 export 時走錯 branch（走回官方 ultralytics export 路徑）、要回頭查 export 用的 fork 對不對。

**選擇理由**：
- **零額外成本**:log 本來就會產生、只是多 grep 一次
- **早於板端測試**:不用等硬體手上就能知道 convert 是否成功
- **hard evidence**:比「跑看看快不快」主觀判斷強;延遲差 10% 可能是 I/O、batch size、記憶體配置、fallback 都可能、不能單憑延遲判斷 op 分佈

**未來重用**：任何需要「全硬體加速」保證的 convert pipeline（RKNN / TensorRT `--strictTypeConstraints` / CoreML `useCPUOnly=False`）、都應該在 convert 階段 grep log 驗證 fallback 狀況、不要等部署後才 debug。CCC-1 / CCC-6 已建立「為何要全 NPU」的動機、DDD-3 補上「怎麼驗證有沒有做到」的操作 SOP。

---

## 2026-04-22（第 16 次）RKNN (RK3588 INT8) 部署 pipeline — fuel-only yolo11x

### 發現 CCC-1：官方 ultralytics ONNX 不適合 RKNN、必須用 airockchip/ultralytics_yolo11 fork

**問題**：直覺流程是「訓完 → `yolo export format=onnx` → rknn-toolkit2 load_onnx + build」。實測下來官方 export 產的 `best.onnx`（output shape `(1, 5, 8400)` for fuel-only）丟給 `rknn.load_onnx()` 再 build，要嘛 convert 本身失敗、要嘛 convert 通過但實際 inference 時大量 op fallback 到 CPU、NPU 完全沒加速。

**原因**：官方 ultralytics export 的尾段處理把 bbox + score 串成單 tensor `(1, 5, 8400)` 的 "decoded" 結構，這個結構包含：
- `NonMaxSuppression` op — NPU 不支援，fallback CPU
- `ScatterND` / dynamic `TopK` — 部分 NPU 不支援
- DFL regression 的 softmax-then-sum 已經 pre-computed 進 weights
- 很多 reshape / concat / transpose 是 decode 需要的，對 NPU 是純開銷

整條 post-process 在 ONNX graph 裡，NPU 做不了重要的 op、只能當 tensor 搬運工。

**解決方案**：用 [`airockchip/ultralytics_yolo11`](https://github.com/airockchip/ultralytics_yolo11) fork export。這個 fork 把 NMS + DFL decode 移出 graph、export 出 **9-output 3-tail 結構**：

```
Input: [1, 3, 640, 640]

Per stride (3 個 strides: 8 / 16 / 32):
  Tail 1 (stride=8,  80×80):
    out1: [1, 64, 80, 80]  — bbox DFL (4 coords × 16 bins)
    out2: [1, 1, 80, 80]   — objectness / score-sum
    out3: [1, nc, 80, 80]  — per-class logit (nc=1 for fuel)
  Tail 2 (stride=16, 40×40):
    out4: [1, 64, 40, 40]
    out5: [1, 1, 40, 40]
    out6: [1, nc, 40, 40]
  Tail 3 (stride=32, 20×20):
    out7: [1, 64, 20, 20]
    out8: [1, 1, 20, 20]
    out9: [1, nc, 20, 20]

Total: 9 outputs, all batch=1, 全部 static shape、全 conv-based
```

NPU 完整吃下 backbone + neck + head（純 conv / bn / silu / concat / upsample），NMS + DFL bbox decode 在 CPU post-process 裡做（`rknn_model_zoo/examples/yolo11/python/yolo11.py` 的 `post_process()`）。

**選擇理由**：
- NPU 加速價值最大化（重運算全在 NPU、輕後處理在 CPU）
- 9 個靜態 shape output 對 NPU 最友好、無動態 shape / dynamic op
- airockchip fork 官方維護、同 repo `rknn_model_zoo` 有配套 convert 腳本 + post-process reference
- 官方 ultralytics export 走的路 Rockchip 文件已 document「不要這樣做」— 硬走會浪費大量時間 debug

**踩坑補充**：airockchip 的 `RKOPT_README.md` 暗示 `export_rknn()` 會產出 `_rknnopt.torchscript`，但實際 `ultralytics/engine/exporter.py` 裡 torchscript 路徑被註解掉（不知為何留著文件但關閉實作），實際走 `torch.onnx.export(..., opset_version=12)` 直接產 `.onnx`。符合 RKNN 需求，但跟文件不符會讓第一次跑的人懷疑跑錯。

---

### 發現 CCC-2：rknn-toolkit2 2.3.2 的環境版本鎖（痛苦 pin 出來的依賴鏈）

**問題**：rknn-toolkit2 沒把依賴鎖死在 `setup.py` / `pyproject.toml`，pip install 後跑起來到處踩 breakage：`pkg_resources` 找不到、`onnx.mapping` 不存在、torch 被升到 2.11、numpy 被升到 2.2、`load_rknn + simulator` 組合不支援等。每踩一坑就要逆推「哪個 dep 的哪個版本開始 break」。

**原因**：rknn-toolkit2 2.3.2 的開發時間是 2024 Q3，背後隱含的版本假設：
- `torch <= 2.4.0`（API compat）
- `numpy <= 1.26.4`（尚未準備好 numpy 2.x）
- `onnx < 1.18`（仍用 `onnx.mapping` module，1.18 移除了）
- `setuptools < 81`（仍用 `pkg_resources`，81 拆成獨立 package）

但 2026 的 pip default 會把這些全部升到最新，任何一個超版都會炸。

**解決方案**：完整依賴鎖（conda env `rknn`，python 3.10）：
```
# Core
torch==2.4.0+cpu
torchvision==0.19.0+cpu
numpy==1.26.4
onnx==1.17.0
setuptools<80                  # 實測 79.0.1 OK
rknn-toolkit2==2.3.2           # 從 PyPI

# ultralytics airockchip fork (editable install)
ultralytics 8.3.9              # 對應 airockchip/ultralytics_yolo11 commit

# airockchip 要求 deps
protobuf scipy onnxruntime opencv-python fast-histogram

# ultralytics 要求 deps
matplotlib pandas seaborn pillow pyyaml requests py-cpuinfo ultralytics-thop
```

安裝順序（避免互相升級衝突）：
1. `conda create -n rknn python=3.10` + `conda tos accept`
2. `pip install --no-deps rknn-toolkit2==2.3.2` 先裝本體、不裝依賴
3. 裝 airockchip pinned requirements
4. `pip install 'setuptools<80'`
5. `cd ultralytics_yolo11 && pip install --no-deps -e .`（`--no-deps` 避免 torch 被升）
6. 補 ultralytics 其他 deps（matplotlib, pandas, seaborn, torchvision==0.19.0 等）
7. `pip install --force-reinstall torch==2.4.0 torchvision==0.19.0 --extra-index-url https://download.pytorch.org/whl/cpu`（torchvision 安裝時會把 torch 拉回 2.11、要 force-reinstall 壓回去）
8. `pip install numpy==1.26.4`（force-reinstall 時順帶裝 numpy 2.x，要壓回）
9. `pip install onnx==1.17.0`

**選擇理由**：
- WSL2 直裝而非 Docker：rknn-toolkit2 官方 image 很大（~6 GB）、本地 debug 不方便
- conda 而非 venv：miniconda 在 WSL Ubuntu 24.04 bare install 沒 pip 的狀態下、`conda create` 比 `python3 -m venv`（缺 ensurepip）簡單
- `--no-deps` + 手動補依賴：比自動解析快又準、pip 的 resolver 在這種多重版本 constraint 下會 hang 很久或解出錯誤版本

**預防未來忘記**：rknn-toolkit2 出新版（例如 2.4.x）時重跑這個版本鎖可能全部失效，要根據新版 release note 重新 pin。建議每次升版前先在 disposable env 試裝、不要直接升既有 env。

---

### 發現 CCC-3：量化誤差驗證 — RKNN simulator 只能走 load_onnx + build + init_runtime(target=None)

**問題**：轉完 `best.rknn` 後想驗證「RKNN INT8 推論結果跟原 ONNX FP32 差多少」。直覺走：
```python
rknn = RKNN()
rknn.load_rknn('./best.rknn')
rknn.init_runtime(target=None)   # None = simulator mode
# → Error: RKNN model that loaded by 'load_rknn' not support inference on the simulator, please set 'target' first!
```

錯誤訊息誤導人以為要指定 target、但本機沒實機板子。

**原因**：rknn-toolkit2 的 `load_rknn()` 是給「已 converted、上實機跑」用的。載入 `.rknn` 後、不能再走 simulator 路徑。simulator 必須從 ONNX source 開始完整 convert → simulate，因為 simulator 需要 graph 中間狀態（中間 activation）、而 `.rknn` file 是 hardware-specific binary 不含 debug metadata。

**解決方案**：驗證流程必須完整重做 quantization：
```python
rknn = RKNN()
rknn.config(target_platform='rk3588', mean_values=[[0,0,0]], std_values=[[255,255,255]],
            quantized_dtype='asymmetric_quantized-8', quantized_algorithm='normal')
rknn.load_onnx(model='./best.onnx')
rknn.build(do_quantization=True, dataset='./calibration.txt')
rknn.init_runtime(target=None)   # simulator 走這條就 OK
outputs = rknn.inference(inputs=[test_img])
# 對比 onnxruntime.InferenceSession 跑同一張圖的 FP32 output
```

**量化誤差實測結果**（3 張測試圖、INT8 vs FP32 output cosine similarity）：
- **Class prob / score-sum**：`cos > 0.99` — 分類 confidence 幾乎無損，偵測「有沒有 fuel」完全 OK
- **BBox DFL（64 channel, 4 coords × 16 bins）**：`cos 0.69 ~ 0.96` — DFL distribution 對 INT8 量化最敏感
- **Stride 32 (20×20) class outputs 全 0**：fuel 是 ball 小物件（image 中約 30–60 px）、最大下採樣 stride 32 偵不到小物件是合理的、非 bug

**結論**：INT8 量化對 fuel detection 的實戰影響預期：
- 分類「有 / 沒有 fuel」無損（class prob cos > 0.99）
- bbox 邊界可能差 1–2 px（DFL cos ~0.7 ~ 0.9）
- counting 任務可接受，precise localization 任務需評估

**選擇理由**：
- 每次驗證都重跑 quantization 成本（~200 張校正集、~1 分鐘）可接受
- 若改 `quantized_algorithm='mmse'`（minimize mean square error）bbox cos 會拉高、但分類不受影響（已 > 0.99）
- Hybrid quantization（某些敏感 layer 改 FP16）會讓模型 size 與推論時間變大、先撐 INT8 實戰試試

---

### 發現 CCC-4：板端部署 API 跟轉換 API 是兩個不同 package

**問題**：轉換完 `best.rknn` 後，在板端（RK3588 Linux）跑推論要 import 什麼？`from rknn.api import RKNN` 跟轉換時一樣嗎？

**原因**：rknn-toolkit2 是 **x86 PC 端**用來 convert 模型（load_onnx → build → export_rknn），體積大（含 simulator、量化工具、debug 工具）、跑 NPU inference 沒用；板端需要的是 **ARM 端 runtime** `rknn-toolkit-lite2`，只做「load 已 converted `.rknn` + inference」，API 精簡。

**解決方案**：板端 script 的 import：
```python
from rknnlite.api import RKNNLite   # NOT rknn.api.RKNN

rknn_lite = RKNNLite()
rknn_lite.load_rknn('./best.rknn')
rknn_lite.init_runtime()    # 不用指定 target，在板上自動偵測 NPU
outputs = rknn_lite.inference(inputs=[img])
```

Post-process（9 output → bbox + score + class → NMS）參考 [`rknn_model_zoo/examples/yolo11/python/yolo11.py`](https://github.com/airockchip/rknn_model_zoo/blob/main/examples/yolo11/python/yolo11.py) 的 `post_process()` function、改 `CLASSES = ('fuel',)` 即可。

**RK3588 性能預估**：
- yolo11x @ 640 on RK3588 NPU (6 TOPS INT8)：**3–7 FPS**
- yolo11n @ 640 on RK3588 NPU：**60+ FPS**（若未來要做場內即時偵測、建議再轉一版 11n）
- yolo11x 選擇理由是使用者要精度優先、推測 offline 分析或 pre-screening 用途

**選擇理由**：
- 板端 runtime 獨立 package 是業界通例（TensorRT / OpenVINO / CoreML 都類似）— x86 轉換工具跟 ARM runtime 分家、ARM image 小、可上 resource-constrained 裝置
- `rknnlite` 只做 inference、沒有 debug / 量化路徑，API 簡潔不易誤用

---

### 發現 CCC-5：9-output 3-tail 結構的 decode 公式

**問題**：RKNN inference 回 9 個 tensor，每個 per-stride、per-channel 分解。怎麼從這 9 個數字回到 `(x, y, w, h, score, class)` 的 detection list？

**原因**：airockchip fork 把 YOLO head decode 從 ONNX graph 外拋到 CPU post-process，所以板端 script 必須自己做 DFL → bbox 的 decode 與 per-stride → 全畫面 coord 的 transform。

**解決方案**（摘自 `rknn_model_zoo/examples/yolo11/python/yolo11.py`）：

```python
def post_process(outputs, img_w=640, img_h=640, conf_thres=0.25, iou_thres=0.45):
    # outputs: 9 tensors, 3 strides × (bbox_64ch, score_1ch, cls_ncCh)
    strides = [8, 16, 32]
    detections = []

    for i, stride in enumerate(strides):
        bbox_dfl  = outputs[i * 3]       # [1, 64, H, W]  where H=W=img_h/stride
        score_sum = outputs[i * 3 + 1]   # [1, 1, H, W]
        cls_logit = outputs[i * 3 + 2]   # [1, nc, H, W]

        # 1) score filter: score_sum is sum over classes; pre-filter before DFL decode
        mask = score_sum > conf_thres

        # 2) DFL decode: bbox_dfl is 4 coords × 16 bins softmax distribution
        #    每 coord 的最終值 = sum(softmax(bins) * [0,1,...,15])
        bbox_dfl = bbox_dfl.reshape(4, 16, H, W)
        bbox_dfl = softmax(bbox_dfl, axis=1)
        bbox_ltrb = (bbox_dfl * np.arange(16)).sum(axis=1)  # [4, H, W]

        # 3) grid transform: bbox_ltrb 是相對 grid cell 中心的 (l, t, r, b) distance
        grid_x, grid_y = np.meshgrid(np.arange(W), np.arange(H))
        x1 = (grid_x - bbox_ltrb[0]) * stride
        y1 = (grid_y - bbox_ltrb[1]) * stride
        x2 = (grid_x + bbox_ltrb[2]) * stride
        y2 = (grid_y + bbox_ltrb[3]) * stride

        # 4) class + score 合併、NMS
        ...

    return detections
```

**選擇理由**：
- DFL（Distribution Focal Loss）是 YOLO v8+ 的 regression head、比 L1 / IoU loss 準度高；代價是 decode 從 4 channel 變 64 channel（4×16 bins），但 CPU 做這個 decode 毫秒級
- 9 output 對 NPU 最友好、decode 外拋給 CPU 幾乎無 penalty（整張圖 post-process < 5 ms）
- rknn_model_zoo 已經寫好這段 reference code、複製貼上改 CLASSES 名稱即可

**未來重用**：若要轉其他 YOLO 變體（11n / 11s / 三類聯訓），decode 公式完全一樣、只改 `nc`（class 數量）與 `CLASSES` tuple。multi-class 情況下 `cls_logit` 要 softmax 後取 argmax。

---

## 2026-04-22（第 17 次）RKNN 板端實測反饋 + FP16 轉換（session 16 延續）

### 發現 CCC-6：RK3588 NPU 的 dtype 實際選項只有 INT8 與 FP16、不含 FP32

**問題**:session 16 交付 INT8 `.rknn` 後、使用者板端實測漏偵遮擋 fuel,直覺歸因為量化、要求「練一個沒量化過的」直接上板比對。第一反應是 export FP32 ONNX 直接上 RK3588、但這條路行不通。

**原因**:RK3588 NPU 硬體只有 INT8（6 TOPS）與 FP16（~3 TFLOPS）兩條路徑、**沒 FP32 硬體加速**。ONNX FP32 丟進 rknn-toolkit2 會發生:
- 大部分 op convert 後仍保留 FP32、inference 時 fallback 到 ARM CPU
- 小部分 op 自動轉 FP16 / INT8 跑 NPU
- 整張圖 CPU + NPU 混跑、實際效能遠低於純 FP16 NPU、且 inference 結果不具可比較性（混精度邊界難控制）

rknn_model_zoo 的 `convert.py` CLI dtype 選項:
```
python convert.py <onnx> <platform> <i8|u8|fp> <output.rknn>
```
其中 `fp` **不是** FP32、而是 FP16。這是命名陷阱:rknn_model_zoo 把「non-quantized」跟「FP16」等價、因為 FP32 對 NPU 沒意義。使用者說「沒量化」、在 RK3588 上唯一對等的實際選項就是 FP16。

**解決方案**:接受「RK3588 上 no-quantization = FP16」這個事實、直接跑:
```bash
python convert.py best.onnx rk3588 fp best_fp16.rknn
```
產物 119.3 MB（ONNX 217 MB 的 0.55x、INT8 61.8 MB 的 2x,符合 FP16 理論值）。Build log **無 op fallback warning** → 全圖在 NPU FP16 path、不會因 CPU fallback 爆慢。

**選擇理由**:
- 硬體 constraint 先行:糾結 FP32 是浪費時間,硬體沒路徑不管怎麼 config 都跑不動
- FP16 仍是有效 A/B 對比工具:能 rule out INT8 量化是否是主因、cost 只是 1 分鐘 convert 時間
- 比 hybrid quantization 簡單:hybrid 需要指定哪些 layer FP16 / 哪些 INT8、調參空間大,作為 escalation 選項不是起手式

**未來重用**:若要在其他 Rockchip 晶片（RK3576 / RK3566 / RV1103 / RV1106 等）部署,先查對應 spec 的 NPU 支援 dtype:
- RK3588 / RK3576:INT8 + FP16
- RK3566 / RK3568:只 INT8（沒 FP16 路徑）
- RV1103 / RV1106:INT8 + INT4（尾部 low-power）

不同晶片「沒量化」的實際 fallback option 不同、不是所有板子都能跑 FP16 比對。

---

### 發現 CCC-7：量化 vs 資料 vs 閾值 — 板端漏偵的三層歸因方法學

**問題**:使用者板端實測「前方 fuel 偵得到、後方被遮擋的 fuel 偵不到」、直覺歸因為量化、想重訓「沒量化過的」。這個歸因很可能錯、但直接反駁會沒說服力（使用者沒親眼看過 FP16 結果）。需要一套系統化歸因流程避免跳過便宜驗證、直接跳到重訓。

**原因**:模型部署後偵測失效有多種來源、且誤歸因成本差異極大:

| 可能主因 | 典型表現 | 驗證成本 | fix 成本 |
|---|---|---|---|
| 量化（INT8 DFL 量化誤差） | bbox 偏 1–3 px、conf 略降（1–5%） | FP16 A/B：1 分鐘 convert + 實測 | mmse / hybrid：10–30 分鐘 |
| Post-process 閾值 | 特定範圍 obj 完全不出現（bbox 與 conf 都 0） | 改 `OBJ_THRESH=0.15` 跑 inference：30 秒 | 0（一行 code） |
| 模型本身（資料覆蓋不足） | 特定場景完全不出現或誤偵 | 分析訓練資料分布：數小時 | 收資料 + 重訓：數天–數週 |

使用者的症狀是「完全漏偵」、不是「bbox 偏 1–3 px」。量化典型失效模式是後者、前者通常不是量化害的。session 16 INT8 驗證結果已佐證這點:class prob cos > 0.99（分類幾乎無損）、bbox DFL cos 0.69–0.96（只讓 bbox 偏、不會讓 obj 完全消失）。

**解決方案**:建立三層歸因決策流程、從便宜驗證起跳:

**Step 1:post-process 閾值對齊（30 秒,0 成本）**
- 改 `OBJ_THRESH = 0.25 → 0.15`、同張圖重跑 inference
- 若遮擋 fuel 偵到了 → 根因是閾值過高、fix 完成
- 若遮擋 fuel 仍不出現 → 進 Step 2

**Step 2:量化 A/B 對比（1 分鐘 convert + 實測）**
- 跑 FP16 convert 產出第二版 `.rknn`
- 同場景對比 INT8 / FP16 結果:

| INT8 vs FP16 | 診斷 | 下一步 |
|---|---|---|
| FP16 救回、INT8 漏 | 量化影響大 | `quantized_algorithm='mmse'` 或 hybrid quantization |
| 兩版都漏 | 不是量化 | 進 Step 3 |
| FP16 漏、INT8 偵到 | 極少見、可能 calibration 集分布異常 | 重新取 calibration set 再 convert |

**Step 3:資料 / 模型層歸因（數小時分析 + 數天重訓）**
- 分析訓練集中「遮擋 fuel 樣本」的數量與多樣性
- 通常發現:比賽影片中 fuel 被 robot 遮擋、或 fuel 堆疊互遮的場景標得少
- Fix:re-label 既有影片補遮擋樣本、或 re-train with imgsz=960（小物件友好）

**選擇理由**:
- 便宜優先:step 1 30 秒、step 2 1 分鐘、step 3 數天。跳過 step 1/2 直接重訓是「燒時間賭假設」
- 量化失效模式 ≠ 遮擋失效模式:量化典型不會讓 obj 完全消失、症狀不符的話概率就低
- A/B 證據比純理論說服力強:對 stakeholder 講「我算過應該不是量化」不如「FP16 也漏、所以確認不是量化」

**未來重用**:這套三層歸因流程對任何 edge-device 模型部署都適用、不限 RKNN。TensorRT / CoreML / OpenVINO 遇到類似「板上偵測率遠低於 training val」也走同樣順序（閾值 → FP16/FP32 對比 → 資料分析）。關鍵是**不要跳過 step 1 / 2**、直接懷疑模型本身通常是 sunk cost 最高的診斷。

---

### 發現 CCC-8：模型效能改進的優先級 checklist（成本 / 成效排序）

**問題**:板端實測不佳、使用者腦中直接跳「重訓」。但重訓在 bayes 先驗下通常 **不** 是首選（成本最高、成效不一定）。需要一份按成本 / 成效排序的 checklist、避免跳過便宜選項直接跳到最貴的。

**原因**:模型效能改進手段跨度極大、各路徑的 ROI 差異可達百倍:

| 路徑 | 預估 dev 成本 | 預估效果範圍 | ROI |
|---|---|---|---|
| Post-process 閾值調整 | 30 秒 | 5–50%（若 logit 剛好卡範圍） | ★★★★★ |
| 量化策略（mmse / hybrid） | 1 小時 | 2–10%（bbox 精度） | ★★★ |
| 輸入解析度升級（640→960） | 2 小時 GPU 重訓 | 5–20%（小物件） | ★★★ |
| 資料補充（遮擋 / 罕見場景） | 1 週標註 + 重訓 | 10–40%（特定場景） | ★★★ |
| Two-stage（detect→crop→detect） | 1 週 dev + 延遲加倍 | 10–30%（小物件） | ★★ |
| 換模型大小（x / l / m / s / n） | 數小時重訓 | ±10%（不確定方向） | ★ |

直接跳到「重訓用 imgsz=960」或「換 two-stage」是中高成本選項、跳過閾值調整與量化 A/B 這兩個 0–1 小時成本路徑。

**解決方案**:按以下優先級嘗試、每一步都 A/B 驗證:

**Tier 1:零成本驗證（先做）**
1. **調 `OBJ_THRESH`**:0.25 → 0.15 / 0.1。若偵測率拉回、根本不用動模型
2. **調 `NMS_IOU_THRESH`**:若相鄰 fuel 互相 suppress、降 IOU 閾值（0.45 → 0.3）

**Tier 2:低成本改進（若 Tier 1 不夠）**
3. **量化策略**:若 INT8 vs FP16 有差、用 `quantized_algorithm='mmse'` 重做 INT8（對 DFL 友好)
4. **Hybrid quantization**:若 mmse 仍不夠、把 DFL head 改 FP16、其餘 INT8

**Tier 3:資料改進（若 Tier 1/2 證明是模型問題）**
5. **收遮擋 / 罕見場景**:分析 failure case、re-label 補這類樣本
6. **Data augmentation**:若收資料慢、加 cutout / mixup / mosaic 強化遮擋 robustness

**Tier 4:模型結構 / 重訓（最後手段）**
7. **imgsz=960 重訓**:小物件專用（如 fuel）
8. **Two-stage pipeline**:部署成本高、延遲加倍、最後手段
9. **換模型大小**:`x` 對小資料可能 overfit、試 `l` / `m`。但方向不確定、不建議作首選

**選擇理由**:
- **先便宜後貴**:ROI 排序明確、Tier 1 / 2 做完至少確認根因、Tier 3 / 4 才不是賭
- **A/B 驗證每一步**:每 tier 做完都要實測、確認該 tier 的假設成立再往下一 tier。不要連跳兩 tier 同時改多項、因為歸因會亂
- **重訓不是萬能 fix**:資料沒覆蓋的 edge case 重訓不會變好、換模型大小也不會。跳過資料分析直接重訓常見浪費

**未來重用**:這份 checklist 對所有「部署後精度不如預期」場景適用、不限 fuel detection。遇到其他部署問題（ex: 未來 three-class 模型上板、或其他 YOLO 變體上板）、照這 9 步從上到下試、通常 Tier 1 / 2 就能解掉一半問題。

**原則**:**永遠從最便宜的驗證起跳、最貴的重訓放最後**。使用者的直覺路徑（直接跳到重訓）恰好反向,這個 checklist 是用來矯正直覺偏差的 anchor。

---

## 2026-04-20（第 14 次）首版 YOLO 訓練結果解讀 + Colab 並行訓練工程模式

### 發現 BBB-1：fuel class mAP50 = 0.954 但 mAP50-95 = 0.746 是小物件的常態、不是模型壞

**問題**：首版 3 類 yolo11n 訓練出來後看 per-class metrics：
- red_robot：mAP50=0.993, mAP50-95=0.865（gap 0.128）
- blue_robot：mAP50=0.995, mAP50-95=0.910（gap 0.085）
- fuel：mAP50=0.954, mAP50-95=0.746（**gap 0.208，幾乎是 robot 的 2 倍**）

直覺會懷疑「fuel 標註品質差」或「模型對小球 under-fit」。

**原因**：mAP50-95 是 IOU threshold 從 0.5 掃到 0.95（步長 0.05）的 AP 平均。對小物件：
1. **IOU 對 bbox 邊界誤差極敏感**：一顆半徑 20 px 的球，bbox ≈ 40×40 = 1600 px²。預測框偏 2 px → IOU 大約掉 0.1。同樣 2 px 偏移對 200×400 px 的 robot bbox 幾乎不影響（從 80000 px² 掉 2%）
2. **COCO 小物件類別的 mAP50-95 普遍 0.3–0.6**：sports ball 在 COCO 甚至 mAP50-95 < 0.4。fuel 在 0.746 已屬相對優秀
3. **mAP50 仍 0.954 代表「抓得到」**：IOU 0.5 容忍度下模型確實能 detect 每顆 fuel，只是邊界不到 pixel-perfect

所以 gap 大不等於模型差，是小物件 + 嚴格 IOU 的幾何必然。**診斷重點應該是 mAP50 而不是 mAP50-95，除非下游任務真的需要精確邊界（例如分割、pose estimation）**。FRC 場景是 detection + counting，mAP50 夠用。

**解決方案**：
- 不盲目追求 fuel mAP50-95。目標是 mAP50 ≥ 0.95 就算合格
- 若真要縮 gap：(a) 升 imgsz 640 → 960 讓小物件占 pixel 更多、(b) 更多樣 fuel 角度 / 光線資料、(c) 用 multi-scale augmentation。不是靠 loss function 調整或 backbone 換大
- fuel-only 獨立訓練的意義：可以獨立用 imgsz=960 不拖 robot class 訓練時間

**選擇理由**：與其在 3 類聯訓裡調 fuel 超參（會影響 robot），獨立 fuel-only 訓練是隔離實驗。先 yolo11n batch=16 建 baseline（~30 min），再 yolo11x batch=8（~3 hr）比對 model capacity 上限。

---

### 發現 BBB-2：Notebook 生成器模式 — 用 Python 模板產多個 ipynb 避免漂移

**問題**：需要同時準備 yolo11n（batch=16）與 yolo11x（batch=8）兩個 Colab notebook，共用 24 cells 裡的 22 cells 邏輯，只差 `MODEL_SIZE` / `BATCH` / `RUN_NAME` 三個常數。手寫兩個 ipynb 的代價：
- 任何流程改動（例如改 epoch 數、改 ONNX opset、改 data.yaml 格式）要同步改兩個檔案
- ipynb 是 JSON、手動 diff 難讀、copy-paste 容易漏一格
- 未來加 yolo11s / yolo11m 會更慘

**原因**：ipynb 的「Notebook as source code」antipattern — 把應該靠模板生成的 artifact 當成手寫 source 維護。

**解決方案**：`_gen_fuel_notebooks.py` pattern：
```python
VARIANTS = [
    ('n', 16),   # yolo11n, batch=16, ~30 min
    ('x', 8),    # yolo11x, batch=8, ~3 hr
]

def build_notebook(size: str, batch: int) -> dict:
    run_name = f'frc_fuel_yolo11{size}'
    cells = [
        make_markdown_cell(f'# FRC fuel-only yolo11{size}'),
        make_code_cell(f'MODEL_SIZE = "{size}"'),
        make_code_cell(f'BATCH = {batch}'),
        # ... 共用 cells
    ]
    return {'cells': cells, 'metadata': {...}, 'nbformat': 4, 'nbformat_minor': 5}

for size, batch in VARIANTS:
    path = f'train_fuel_yolo11{size}.ipynb'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(build_notebook(size, batch), f, ensure_ascii=False, indent=1)
```

改超參時：
- 改 epoch：改模板裡的 `EPOCHS = 50` 常數、重跑 `python _gen_fuel_notebooks.py`、兩個 ipynb 同步更新
- 新增變體：在 `VARIANTS` 加一行 `('s', 16)` 就生第三個 notebook

**選擇理由**：
- ipynb 當 artifact 而非 source、generator 當 source of truth
- 未來加 yolo11s/m 成本 O(1)、而非手寫 O(n)
- diff 只要看 generator `.py` 一個檔、不用跨 ipynb 對照
- 唯一 trade-off：generator 裡 embed code 少了 IDE 語法高亮；解法是把每個 cell 的 code 寫成 `"""..."""` triple-quoted，IDE 可以認成 Python（本 session 其實直接 embed 字串沒差，cells 內容不長）

---

### 發現 BBB-3：Colab 雙帳號並行訓練的工程模式

**問題**：使用者要同時跑 fuel yolo11n（~30 min）+ yolo11x（~3 hr）。Colab free tier 單帳號同時只能 1 個 GPU session，11x 跑 3 小時會擋住 11n 的 slot。時間軸不能接受。

**原因**：Colab 依帳號分配 GPU quota，不是依 notebook。同帳號第二個 notebook 要搶 GPU 會被排隊。

**解決方案**：
1. **兩個 Google 帳號各跑一本**：帳號 A 跑 yolo11x（長的）、帳號 B 跑 yolo11n（短的）。兩個獨立 Colab session 不互相排隊
2. **Drive 分享資料集**：FRC-2026-04-18-auto.zip 放一個帳號的 Drive、另一個帳號用 shared link 或加到 My Drive；notebook 的 `%cd /content/drive/MyDrive/frc-train` 路徑要能在兩帳號都 resolve
3. **RUN_NAME 分開不互蓋**：兩版輸出路徑自動分叉（`frc_fuel_yolo11n-*` / `frc_fuel_yolo11x-*`），即使共用 Drive 也不衝突
4. **保活**：連點器每 15 分鐘按一次頁面任意處，Colab idle 90 分鐘 kick 出來的計時就不會累積

**選擇理由**：
- 比起花 Colab Pro $10/mo 或等 11x 跑完再跑 11n，雙帳號是零成本的 parallelism
- 機械式保活比寫 JS / extension 可靠（Colab 防 bot script，用純物理點擊不會被判）
- 兩版獨立執行 metrics 可以乾淨比較（不會互相 taint 狀態）

**預防未來忘記**：
- 資料集 upload 到 Drive 後一定要在另一個帳號確認可讀（至少可以 `!ls` 到 zip）
- 長訓練跑之前確認 Drive 剩餘容量 > 1 GB（weights + ONNX + curves 總 ~50 MB，但若 append 多次 run 會累積）
- 記錄兩帳號 runs 路徑到 PROGRESS.md，不然明天回來忘記哪個在哪

---

## 2026-04-19（第 13 次）從 CORS-tainted Konva canvas 抽圖 — 未來 Web 端截圖/PDF 匯出的可重用技巧

### 發現 AAA：被 CORS taint 的 Konva canvas 無法 toBlob / html2canvas，必須從 Konva node tree 讀資料、在乾淨 canvas 重繪

**問題**：session 13 為了在工程筆記嵌入標註編輯器真實畫面，想從 production（https://frc-annotation.vercel.app）自動化截圖 `/annotate/[imageId]` 頁面。直接跑：
```js
const canvas = document.querySelector('canvas');
canvas.toBlob(blob => ...); // SecurityError
// 或
html2canvasPro(document.body).then(canvas => canvas.toBlob(...)); // 出來的 canvas 在標註區域空白
```
都拿不到帶標註框的完整畫面。

**原因**：三層耦合：

1. **Konva 載圖未帶 crossOrigin**：`web/components/AnnotationCanvas.tsx` 用 `new window.Image(); img.src = signedUrl` 載入 Vercel Blob signed URL、沒設 `img.crossOrigin = 'anonymous'`。雖然 Vercel Blob 回應有 `Access-Control-Allow-Origin: *` header、CORS 技術上允許，但瀏覽器判定一張圖是否「CORS-clean」只看 request 端有沒有帶 `crossOrigin` attribute、不看 response header。沒帶就視為 opaque
2. **Opaque image 畫進 canvas 會 taint**：Konva `Image` node 把這張 opaque img draw 上 canvas 後、那塊 canvas 被標記 `origin-clean = false`。`canvas.toBlob` / `getImageData` / `toDataURL` 全部拋 `SecurityError: The operation is insecure`
3. **html2canvas 對 tainted canvas 的處置**：
   - html2canvas 1.4.1 雖然偵測到 tainted canvas 會 fallback 畫空白、但更早一步就被 Tailwind v4 的 `lab()` / `oklch()` 色域炸掉（`Attempting to parse an unsupported color function "lab"`），完全跑不起來
   - 換 `html2canvas-pro`（社群 fork，支援 lab/oklch）可以跑，但遇到 tainted canvas 時依然 fallback 空白、而且 `ignoreElements` 排除 tainted canvas 後、剩下的 DOM tree **不包含標註框**（Konva 是在 canvas 上畫框、不是 DOM element，排除 canvas 就沒有框了）

這三層合起來的實質含義：**只要 Konva canvas 載圖時沒帶 crossOrigin，就沒有任何純客戶端方案能把帶標註框的畫面截出來** — 必須從底層重做。

**解決方案**：從 Konva stage 的 node tree 抽資料、在乾淨 canvas 重繪：

```js
// 1) 取 Konva stage（Konva 暴露 global Konva.stages 陣列）
const stage = Konva.stages[0];
const imgNode = stage.findOne('Image');
const rects = stage.find('Rect');
const texts = stage.find('Text');

// 2) 用 fetch 重抓原圖，這次瀏覽器 request 是 CORS 模式（帶 Origin header）
//    Vercel Blob 回 CORS-allow → response 是 clean blob
const resp = await fetch(imgNode.image().src, { mode: 'cors' });
const blob = await resp.blob();
const cleanImg = await createImageBitmap(blob);

// 3) 開新的乾淨 canvas、手動重繪 image + 所有 Rect（標註框）+ 所有 Text（label）
const c = document.createElement('canvas');
c.width = stage.width(); c.height = stage.height();
const ctx = c.getContext('2d');
ctx.drawImage(cleanImg, 0, 0, c.width, c.height);
for (const r of rects) {
  ctx.strokeStyle = r.stroke(); ctx.lineWidth = r.strokeWidth();
  if (r.dash() && r.dash().length) ctx.setLineDash(r.dash()); else ctx.setLineDash([]);
  ctx.strokeRect(r.x(), r.y(), r.width(), r.height());
}
for (const t of texts) {
  ctx.fillStyle = t.fill(); ctx.font = `${t.fontSize()}px ${t.fontFamily()}`;
  ctx.fillText(t.text(), t.x(), t.y() + t.fontSize());
}

// 4) 把新 canvas 插進 DOM、跑 html2canvas-pro 含周邊 UI（class palette 等）
//    ignoreElements 排除原 tainted canvas 避免 fallback 空白
const overlay = document.createElement('div');
overlay.appendChild(c);
document.body.appendChild(overlay);
const shot = await html2canvasPro(overlay.parentElement, {
  ignoreElements: el => el.tagName === 'CANVAS' && el !== c,
});
shot.toBlob(blob => {
  // 5) POST 到本地 Python HTTP server（localhost:8765）
  //    不走 Chrome a.download 因為 Chromium 對同一 tab 第二張 PNG 之後 silent block
  fetch('http://localhost:8765/upload', { method: 'POST', body: blob });
});
```

搭配本地 Python server：
```python
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers['Content-Length'])
        open(f'shot_{time.time()}.png', 'wb').write(self.rfile.read(n))
        self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(200); self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST'); self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.end_headers()
HTTPServer(('localhost', 8765), H).serve_forever()
```

**選擇理由**：
- **為何不直接修 `AnnotationCanvas.tsx` 加 `img.crossOrigin = 'anonymous'`**：治本方案，但要重新 deploy、加 Vercel Blob 的 signed URL CORS 確認，且會改變 production 行為（若 Vercel Blob 將來改 CORS policy 圖會直接載不到）。session 13 只是為了截 7 張圖、不值得動 prod。重繪技巧完全 client-side、0 風險
- **為何 `html2canvas-pro` 而非原版**：原版 1.4.1 撞 Tailwind v4 的 lab/oklch 色域直接 parse error、連 tainted canvas 議題都走不到。pro fork 專門補上 modern color spaces。Tailwind v4 專案幾乎都必須用 pro
- **為何 HTTP server 而非 Chrome 下載**：Chromium 對同一 tab 連續觸發 `a.download` 從第二張開始 silent block（使用者設定或 heuristic）。沒有可靠的 front-end 解法。POST 到 localhost server 是最穩的繞過
- **為何不用 Playwright 另起瀏覽器**：production 站需要 Google SSO + Rick 的 reviewer session + step-up authentication。Playwright 新 browser 要跑完整登入流程，非常容易卡住。使用者桌面 Chrome 已登入、直接接管（chrome-in-chrome MCP via DevTools Protocol）可以跳過登入

**跨專案通用教訓**：
1. 在 Web 端做截圖 / PDF 匯出時，若畫布是 canvas-based library（Konva / Fabric / PixiJS），**第一件事檢查載圖路徑有沒有 `crossOrigin='anonymous'`**。沒帶就註定 tainted
2. 若不能改載圖路徑（legacy / third-party / 不敢動 prod），用 **「從 library 的 scene graph 讀資料、乾淨 canvas 重繪」** 是唯一穩路徑。代價是要重現 library 的繪圖邏輯（stroke / fill / dash / font），但通常幾十行能覆蓋
3. Tailwind v4 專案用 html2canvas 幾乎一定要上 `html2canvas-pro`
4. Chrome download 不可靠用於多張自動化下載；localhost HTTP server + POST 是 2-3 行 Python 就能解的最穩替代

**未來可重用場景**（本 repo 若做）：
- Web 端「匯出單張圖的 annotation preview PNG」功能（使用者在 approve 後想留存歷史快照）
- Web 端「批次審核結果 PDF 報告」功能（把 approved 圖 + 標註 + reviewer 簽名組 PDF）
- 兩者都會撞同樣的 Konva tainted canvas，直接套用本技巧

**證據**：
- `web/components/AnnotationCanvas.tsx` — Konva Image 載入處（沒設 crossOrigin）
- `D:\FRC\frc-train-review\docs\工筆截圖\shot04_annotator.png` / `shot05_review_tray.png` — 實際用這套技巧產出的截圖
- session 13 產出 `C:\Users\USER\Downloads\Rebuilt工筆_新增章節.docx` 裡第 4、5 張圖

---

## 2026-04-19（第 12 次）Fast-path 優化打破系統不變量 — 移除比擴充 invariant 便宜

### 發現 ZZ：submit fast-path 跨越 state-machine / queue / readOnly 三層 invariant、移除比同步擴充三層便宜

**問題**：session 8（commit `59a0f07`）為了支援「partial-promote 後 trickle 送審」，在 `web/app/api/images/[id]/submit/route.ts` 加 fast-path：
```ts
const batchPromoted = img.batch.state === 'under_review';
newState = batchPromoted ? 'under_review' : 'annotated';
```
原意：batch 已經送審中，新 submit 的圖也一起送審、reviewer 立刻看得到。但這條 fast-path 在 session 12 被標註者回報產生兩個 bug：
1. 按 S 偶爾跳 alert「送出失敗（圖片 jydr02）：Illegal submit from under_review」
2. 按 S 後 queue counter `3/374` 變 `3/373`（total -1、idx 不動）

**原因**：fast-path 跨越了三層 invariant，卻只改了 state machine 那一層：
- **Layer 1（state machine, `web/lib/state-machine.ts`）**：fast-path 讓 `assigned → under_review` 變成合法 transition
- **Layer 2（queue filter, `web/app/(protected)/annotate/[imageId]/page.tsx:30`）**：annotator queue 只收 `state IN ('assigned', 'needs_rework', 'annotated')`，**不含** `under_review`
- **Layer 3（editor readOnly, `editor.tsx:43`）**：editor 只把 `annotated` 當 readOnly、**不含** `under_review`

兩個症狀對應兩個 invariant 違反：
- 症狀 2（counter drift）：fast-path 把圖直寫 under_review → 下次 queue 查詢時該圖被 Layer 2 filter 掉 → `images.length` 從 374 減到 373、但 `idx` 仍指向剛 submit 的位置（已不存在） → 顯示 `3/373` 而非 `4/374`
- 症狀 1（alert）：Layer 3 不把 under_review 當 readOnly → 使用者用瀏覽器返回 / URL 貼回到那張 under_review 圖、editor 允許編輯、按 S 觸發 POST submit → Layer 1 的 state machine 擋住 `under_review → *`（其實 fast-path 只放寬 `assigned → under_review`，`under_review → under_review` 仍不合法） → 回 400「Illegal submit from under_review」

關鍵：fast-path 的隱形假設是「batch-level state 可以決定 image-level transition」，但 Layer 2/3 是 pure image-level 決策，不看 batch。這個落差只要有一條 batch 停留在 under_review 就會持續洩漏 under_review 圖到 annotator queue 不該有的狀態。

**解決方案**：commit `194d0d6`。移除 fast-path：
- `submit/route.ts`：永遠 `assigned → annotated`（`needs_rework → under_review` 保留給 resubmit — session 11 reject-all 的反向 flip，邏輯獨立不受影響）
- `editor.tsx`：`readOnly` 收 under_review、按鈕條件三分（annotated 解鎖重標 / under_review 已送審核靜態文字 / 其他 Submit）— 這是防禦性補強，就算未來別條路徑產生 under_review 圖，editor 也不會再觸發 illegal submit

**選擇理由（為何 revert fast-path 而非擴充 Layer 2/3）**：
- 擴充成本：queue filter 改三個位置（annotator queue 頁、editor 頁 guard、editor readOnly 判斷），還要所有 future state-machine 擴充都重新 audit「這個 state 要不要進 queue / 要不要當 readOnly」，cognitive overhead 翻倍
- 撤回成本：fast-path 本來就在單一檔案單一分支，revert 乾淨
- UX 價值不值得：使用者實際行為模式是「批次送審」（explicit 按「送出目前進度給審核」）而非「trickle」，fast-path 沒帶來明顯 UX 價值
- 既存 under_review 資料不回滾：那些圖是使用者 intent 送審、reviewer 照審即可

**跨專案通用教訓**：**某個操作的「便利 shortcut」跨越不同 layer（state / filter / UI readOnly / audit / notification）時，要同時維持所有 layer 的 invariant；做不到就不該 shortcut**。具體 checklist：
1. 寫跨 state fast-path 之前，列出「這個 state 在系統內其他 layer 的行為契約」 — 不只 state machine，還要包括 list / filter queries、UI readOnly 條件、notification triggers、audit records
2. 任何 layer 沒被同步更新、就是一個未來 bug
3. fast-path 越靠近 container-level state（batch、project）、就越容易踩 image-level / row-level invariant，因為下層 layer 通常是 row-level decision
4. 如果某條 shortcut 只有在某個 rare state 才觸發（例如本例的「batch 已在 under_review」），bug 會潛伏很久才爆 — test coverage 必須 explicit 覆蓋這條 rare path（session 12 補的 regression test `keeps submits as annotated after partial-promote flipped batch to under_review` 就是這種）

**證據**：
- `web/lib/state-machine.ts` — error message「Illegal submit from ...」來源
- `web/app/(protected)/annotate/[imageId]/page.tsx:30` — queue filter 三態允收清單
- `web/app/(protected)/annotate/[imageId]/editor.tsx:43` — readOnly 判斷
- `web/app/api/images/[id]/submit/route.ts`（session 8 前的版本與 session 12 後的版本）— fast-path 出現與消失的 diff

---

## 2026-04-19（第 11 次）大檔 streaming upload 的 retry + ReadableStream 陷阱

### 發現 YY：`@vercel/blob` v2 `put()` 不帶 `multipart: true` 時 retry 會撞 undici ReadableStream disturbed/locked

**問題**：`web/app/api/projects/[id]/export/route.ts:132` 用
```ts
await put(key, stream, {
  access: 'public',
  contentType: 'application/zip',
  addRandomSuffix: false,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
```
streaming 上傳 YOLO dataset zip。小 batch（100 張）從來沒事；大 batch（710 張）炸 500 回 `The response body object should not be disturbed or locked`（Chrome auto-translate 中文版即「響應體物件不應受到干擾或鎖定」）。

**原因**：`@vercel/blob` v2 內部結構：
1. `put()` → `createPutMethod()` → `requestApi()`（`node_modules/@vercel/blob/dist/chunk-WLMB4XQD.js:1271, 1287`）
2. `requestApi()` 用 `async-retry` 包一層 HTTP retry，預設重試 `VERCEL_BLOB_RETRIES=10` 次（`chunk-WLMB4XQD.js:575, 658`）
3. 非 multipart 路徑的上傳邏輯直接是 `fetch(uploadUrl, { method: 'PUT', body: stream })`（`chunk-WLMB4XQD.js:1226` 的 `createPutMethod` 分支）
4. 第一次 PUT 失敗（edge timeout / 5xx / 網路抖動）時，`async-retry` 想重新呼叫同一個 fetch、把**同一個** `ReadableStream` 當 body 再送一次
5. 但第一次 fetch 的 undici 底層已經開始從 stream 讀 chunks — 無論是已讀完還是讀到一半 `AbortError` 中斷，stream 都已進入 "disturbed" / "locked" 狀態
6. Web Streams spec: 一個 `ReadableStream` 只能被消耗一次；第二次 fetch 撞到就 throw `The response body object should not be disturbed or locked`
7. 錯誤冒到 `requestApi` 外層的 export route `try/catch` → 回 500 給 client

為什麼小 batch 沒事：單一 PUT 一次成功、沒觸發 retry 路徑，bug 隱形存在。710 張邊組 zip 邊上傳比較慢，第一次 PUT 撞到 Vercel edge timeout 就暴露。

**解決方案**：加 `multipart: true`：
```ts
await put(key, stream, {
  access: 'public',
  contentType: 'application/zip',
  addRandomSuffix: false,
  multipart: true,           // ← 大檔 streaming 必加
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
```
multipart 路徑走 `uncontrolled.ts` 的 `uncontrolledMultipartUpload`（參考 `@vercel/blob` v2 source），行為：
- 從 stream 讀固定大小 chunk（預設 8MB）切成 parts
- 每個 part 獨立發一次 PUT、**獨立 retry**
- 失敗 part 不需要重讀整條 stream — 它手上已經是 buffered Uint8Array
- stream 只被讀一次（順序、一次性），不會有 "disturbed on retry" 的問題

**選擇理由**：
- 不用 `VERCEL_BLOB_RETRIES=0` 關 retry — 吞掉症狀、但大檔 streaming 失去容錯、單一 PUT timeout 就整個匯出失敗
- 不用 `Buffer.from(await stream.readable)` 先全部讀進記憶體再丟非 stream `put()` — 710 張 zip 約幾百 MB，Vercel Function 記憶體上限 1.5GB 容易爆
- 不用自己包 `async-retry` 重跑 `pipeline()` + 新 stream — 等於重寫 `@vercel/blob` 的 multipart 邏輯
- multipart 是 Vercel Blob 官方對「大檔 / streaming / 不確定大小」的建議，每 part 獨立 retry 是正解
- **通用原則**：**任何以 `ReadableStream` 為 body 的單一 PUT + 外層 retry 組合都有 disturbed/locked 風險；大檔 streaming upload 一律用支援 multipart 的 API，不要靠外層 retry**

**證據（`@vercel/blob` v2 source，以本 repo `node_modules/@vercel/blob/dist/chunk-WLMB4XQD.js` 為準）**：
- `:575` — `async-retry` 包裝 `requestApi` 函數，retries 讀自 `VERCEL_BLOB_RETRIES` env
- `:658` — retry factor / minTimeout / maxTimeout 設定
- `:1226` — `createPutMethod` 的非 multipart PUT 分支，`body: stream` 直接餵
- `:1271, :1287` — `put()` entry point 導向 `createPutMethod` → `requestApi`

---

## 2026-04-19（第 10 次，深夜）annotator / reviewer 切圖效能優化期技術發現

### 發現 VV：React state → ref sync via `useEffect` 在同步 `await` 後會讀到 stale 值

**問題**：`web/app/(protected)/annotate/[imageId]/editor.tsx` 的 `updatedAtRef` 透過 `useEffect([updatedAt])` 同步：
```ts
const [updatedAt, setUpdatedAt] = useState(initial);
const updatedAtRef = useRef(updatedAt);
useEffect(() => { updatedAtRef.current = updatedAt; }, [updatedAt]);
```
autosave 的 `doSave` 成功後 `setUpdatedAt(json.updatedAt)`。但 S 鍵 handler 是：
```ts
await inFlightSave.current;           // 等 autosave 完成
const lastKnown = updatedAtRef.current;  // 讀 ref
fetch('/api/images/.../submit', { body: { lastKnownUpdatedAt: lastKnown } });
```
submit 送出去的 lastKnown 是**舊值**、server CAS 失敗 → 409。

**原因**：React 的 state update 不是同步的 — `setUpdatedAt(newVal)` 只排入 update queue；**ref 透過 useEffect 同步的行為要等 React 下一次 commit + effect pass 跑完才生效**。`inFlightSave` Promise resolve 時 React 還沒 commit，effect 還沒跑，ref 還是舊的。`await` 不等 React render。這條坑在 React 18 已存在，但 concurrent rendering / transition 讓時序更糟。

**解決方案**：`doSave` 成功分支裡**同時雙寫**ref 與 state：
```ts
const json = await res.json();
updatedAtRef.current = json.updatedAt;   // 直接寫 ref，不等 effect
setUpdatedAt(json.updatedAt);             // state 照常更新給 render 用
```

**選擇理由**：
- 不用 `flushSync` — 它會強制同步 render、阻塞 autosave loop；對每 5 秒跑一次的 hot path 太貴
- 不改用 `useSyncExternalStore` — 架構大動、且 state + ref 雙寫只差一行
- Ref 的「即時值」語意本來就比 state「下次 render 值」適合這種「最新 server-known timestamp」用途，只是之前誤信 useEffect 能 bridge
- 通用 pattern：**任何「state 必須在 async 段中被讀到」的情境，不要靠 useEffect sync ref — 在 set 點同步寫 ref**

---

### 發現 WW：Optimistic submit 要移除 updatedAt CAS，否則與 in-flight autosave race condition

**問題**：Session 9 加了 optimistic submit（S 鍵 → 立刻 `router.push(next)` → 背景打 submit），使用者回報偶爾出現「送出失敗」alert。trace 下去看到 submit API 回 409 Stale write。

**原因**：流程時序：
```
t0   使用者畫完框，autosave（PATCH annotations）排隊中
t1   使用者按 S
t2   editor snapshot updatedAtRef.current → 當成 lastKnown 傳給 submit
t3   router.push 觸發、editor unmount
t4   背景 autosave PATCH 完成、server updatedAt bump 成 T2
t5   背景 submit 到達 server，CAS where { updatedAt: lastKnown_T1 } → 0 rows → 409
```
原本的 submit route updateMany where clause 同時檢 `state: img.state` 和 `updatedAt: lastKnown`。前者是必要的防重複 submit；後者在 optimistic + 不 await autosave 的場景會必然 race。

**解決方案**：移除 updateMany 的 `updatedAt: lastKnown` 條件，只保留 `state: img.state`：
```ts
const { count } = await tx.image.updateMany({
  where: { id, assignedToId: session.user.id, state: img.state },
  data: { state: 'annotated', annotations: ..., updatedAt: new Date() },
});
```

**選擇理由**：
- State check 本身就足以防重複 submit — 第二次 submit handler 進來時 `img.state` snapshot 已是 `annotated`，updateMany 找不到 `state: assigned` 的 row、count=0、回 409，是正確的防重複行為
- 不讓 optimistic 流程 `await autosave`：會把「optimistic」的好處吃掉（使用者要等 autosave 才能換頁）
- 不在 client 端「延後 submit 直到 autosave done」：client 要多維護 promise chain、錯誤路徑複雜、拿捏不好又退化回序列化行為
- 通用原則：**CAS 的成本是「client 必須持有最新 token」，optimistic navigation 的成本是「client 必然離開新鮮 token 源」，兩者互斥。選 optimistic 就要改用其他 idempotency guard（本例是 state machine）**

---

### 發現 XX：`router.push` 觸發舊頁 unmount 的 cleanup effect 會在 submit 之後再打一發 spurious PATCH

**問題**：optimistic submit 流程下，editor 的 unmount cleanup（原本設計是「離開頁面時 flush 未存 boxes」）會在 `router.push` 後觸發 `doSave()`，此時 image state 已被 submit 翻到 `annotated`，PATCH annotations 進來找不到 `state in ['assigned','needs_rework']` 的 row → 409 Stale write。使用者看到 Vercel log 有 noise 409，且 client 會多一發不必要的網路請求。

**原因**：`useEffect(() => { return () => { flushSave(); }; }, [])` 對絕大多數情境（使用者切頁、關 tab）是正確的；但 optimistic submit 的語意是「我已經主動處理了 boxes → submit，不需要再 flush」。cleanup 不知情、照樣打。

**解決方案**：新增 `submittedRef = useRef(false)`，submit handler 發起時立刻 `submittedRef.current = true`，cleanup 先檢查再決定要不要 flush：
```ts
useEffect(() => {
  return () => {
    if (submittedRef.current) return;   // submit 已接手，不要再 flush
    if (hasUnsavedChanges.current) flushSave();
  };
}, []);
```

**選擇理由**：
- 不移除 cleanup flush — 其他離開情境（F5、關 tab、切 route 非 submit）仍需要它
- 不用 state `submitted` — state 更新是 async、cleanup 跑時可能讀到舊值，必須用 ref
- 不靠 server-side idempotency 吞掉 409 — noise 仍在 log 裡、且 client 會誤判「網路錯」顯示 alert 困擾使用者
- 通用原則：**當同一個 unmount 可以由多種路徑觸發（使用者主動 / 程式自動 / 意外），cleanup effect 要有「我是主動提交了所以不需 flush」的 opt-out flag。用 ref 不用 state。**

### 推論出的通用原則（橫跨 VV / WW / XX）
這三個發現其實是同一個 meta-pattern：**「讓 UI 立即動、讓 server 在背景追」的 optimistic 架構，需要一整套 invariant 重新設計**：
1. 所有「送出時需要的最新值」不能依賴 React state / useEffect sync — 必須用 ref 雙寫（VV）
2. 所有伺服器端 CAS 都要重新審視「client 是否還能持有最新 token」— 若 optimistic 流程不能等 token 回流，就要改 state-machine guard（WW）
3. 所有 unmount cleanup 要有「我是主動完成了，不要再做補救」的 opt-out flag（XX）

違反任何一條就會出現 race / spurious request / stale 409。這次 session 是在一天內連續踩三個才補齊，未來其他頁面（例如未來若把 annotator 改 SPA）改 optimistic 時可以直接套這三條 checklist。

---

## 2026-04-19（第 9 次）partial-promote count=0 邊界 bug 期技術發現

### 發現 UU：bulk `updateMany` 後依賴 count 的 state transition 必須檢查 count>0，否則 0-row update 也會 flip container

**問題**：partial-promote endpoint 在「annotator 身上沒任何已標註 image」的情況下被按下，整批仍被 flip 到 `under_review`，reviewer dashboard 多出 0 images 的空 batch。

**原因**：原程式流程
```ts
const { count } = await tx.image.updateMany({
  where: { batchId, state: 'annotated' },
  data: { state: 'under_review' },
});
if (batch.state === 'in_annotation') {
  await tx.batch.update({ where: { id: batchId }, data: { state: 'under_review' } });
}
```
count=0 是合法的 Prisma result（沒符合 where 的 row）、不會 throw，但第二段 batch flip 的 guard 只問「batch 本來在 `in_annotation` 嗎」、沒問「剛剛到底 flip 了幾張」。結果「空 promote」仍然改動 container state。

**解決方案**：在 `updateMany` 後立刻判斷 `if (count === 0) throw new HttpError(400, '目前沒有已標註的圖可送審')`；batch state 的 flip 放在 count>0 的分支後才執行。前端 `editor.tsx` 的 `setStatus(msg)` 會把這個訊息秀在 footer，annotator 體感直接理解「我還沒提交任何一張」。

**選擇理由**：
- 不在 client 端 disable button — client 沒有「本 batch 當下的 annotated count」資料，要嚴謹做得多拉一支 API 或把 count 壓進 page props，擴散半徑不划算
- 不用自動把當下編輯中那張 auto-submit — 語意混淆（使用者按「送出進度」不是要把當前未完成的圖當成完成品送審）
- Server-side 400 + 明確中文錯誤訊息是最小改動，edge case 發生率低、不值得前置 UI 工程

### 推論出的通用原則
當一個 endpoint「先 bulk update child rows、再根據某種前置 state flip container」時，container flip 的 guard **必須同時**包含：
1. container state 是否允許 transition（`batch.state === 'in_annotation'`）
2. bulk update 實際影響幾 row（`count > 0`）

只問 1 不問 2 會讓「client 誤觸但其實沒東西可改」的 request 對 container 留下副作用。這個 pattern 在 partial-*/ bulk-* 類 UX 都適用：例如 partial-reject、bulk-approve、bulk-delete 的實作若有 container-level state 變更，都要加 count>0 guard。

### 衍生注意
session 8 的 submit route 新邏輯「batch 已 under_review → image 跳過 annotated 中繼直寫 under_review」放大了這次 bug 的爆炸半徑 — 一旦 batch 被錯誤 flip，後續 submit 會自動接上「連續動態 review」模式，把本應進 annotated 中繼的 image 直推 under_review，資料狀態更亂、越多人按越糟。兩段邏輯本身都正確，但組合起來對「錯誤 flip」零容忍。**設計跨 state-transition 的 fast-path 時，前置條件的 precondition 必須收緊到不接受任何「allowed but wrong」的狀態**。

---

## 2026-04-18（第 8 次）partial-promote 機制期技術發現

### 發現 TT：Partial-promote 需同時 flip batch.state 與 image.state，否則 reviewer 看不到 — state-machine 雙軌耦合

**問題**：需求是「標註者標到一半把已完成的圖先送給審核者看」。最直覺的做法是只把已完成的 `annotated` image 轉成 `under_review`、保留 `batch.state='in_annotation'`，這樣標註者可以繼續標剩下的圖。但實做後 reviewer dashboard 完全看不到這個 batch。

**原因**：現有 query 雙軌設計：
- reviewer dashboard 列出可審 batch 的條件：`batch.state='under_review'`（batch 層）
- review page 內列出可審 image 的條件：`image.state='under_review'`（image 層）

這兩層必須同時對齊才會顯示。只 flip image 不 flip batch → dashboard 的 batch-layer filter 擋掉整個 batch，reviewer 點不進去。反過來只 flip batch 不 flip image → dashboard 顯示了但 review page 空白。

**解決方案**：
1. Promote endpoint 同時 flip 兩層：batch 層 `in_annotation → under_review`；image 層把所有 `annotated` 推到 `under_review`
2. 副作用處理：batch 已在 `under_review` 後，後續標註者每張 submit 若只停在 `annotated` 中繼狀態就會卡住（reviewer 看不到新 submit 的那張）。所以在 submit route 裡判斷「batch 已 under_review → 跳過 `annotated` 中繼，直接寫 `under_review`」
3. 結果：整個 batch 轉成「連續動態 review」模式 — 標註者送一張、reviewer 即時多看到一張，不需等整批

**選擇理由**：
- 不拆 query 雙軌（把 dashboard filter 改成只看 image-state）— 會影響既有所有 reviewer 流程、擴散半徑大、可能讓 batch 生命週期語意模糊
- 不新增第三個中間 state（例如 `partially_under_review`）— state machine 會暴增邊，維護成本高
- 選擇 coupling flip + submit 條件短路：加了一條 `promote` transition + submit route 的 batch-level 條件判斷，改動小、語意清晰（「按下 promote 後，batch 進入連續 review 模式」）
- Trade-off：promote 後就回不去「batch 未審 + image 全 annotated」的純批次狀態；但實務上標註者按了這個鈕就是要連續送審，沒人會想 roll back

### 推論出的通用原則
當系統用兩層（container + child）state 同時 filter「是否可見/可操作」時，任何跨 state 的 transition 都必須保持兩層對齊；新增「半完成提早送審」這類 UX 需求時，要優先考慮 flip 兩層或是整併成單層，不要只改一層然後被另一層默默擋掉。Submit route 本身也要依 container state 做條件寫入，否則後續 submit 會形成「寫了但被上層擋住」的幽靈 image。

---

## 2026-04-18（第 7 次，深夜接續）auto pipeline 增量 import 期技術發現

### 發現 PP：Repack 與 Import 之間的 idempotency 陷阱 — batch name 不可當 skip key

**問題**：`repack_per_owner.py` 每次都是 wipe + 全重建 + greedy bin-pack by size，看似 deterministic，但當某 owner 多了新檔案，greedy split 可能把「原本 1 個 batch `foo`」重切為「`foo-1` + `foo-2`」；舊 batch name 消失、新 batch name 出現。任何以 batch **name** 為 skip-key 的 resume 邏輯都會踩雷：
- 若採「batch name 存在 → skip」：整批漏掉（`foo-1` 被當新 batch 建、但 stem 已在 DB 的 `foo`，結果是 duplicate stem）
- 若採「batch name 不存在 → 全建」：整批 dup（把舊 `foo` 的 image 全當新的又 PUT 一輪）

**原因**：import script 做 cross-run resume 時假設 batch 是穩定 identity，但真正 stable identity 是 image stem（檔名去副檔名），不是 batch name。

**解決方案**：import 開頭一次 fetch 整個 project 的 `Image.blobPath`，做 basename → stem Set，之後每一張要 upload 的 image 都先查 Set。如果命中則 skip；miss 就 PUT。Batch 本身用「依 manifest batch name 找現有 batch；找不到則 create」做 upsert，不以 batch 為 dedupe 粒度。

**選擇理由**：
- 唯一 robust 策略 — 完全不信 batch name 的穩定性
- Cost：一次 `findMany` fetch 整個 project blobPath 清單，N 通常 < 10k，一次載入後 O(1) lookup，代價可忽略
- 配合 import 遇到現有 batch 時用 `connectOrCreate` / `upsert` 語意，append image 進去而不是 create fresh batch

### 發現 QQ：Vercel Blob `put()` 對非 ASCII pathname 自動 URL-encode

**問題**：import 第二輪當 `globalExistingFilenames` Set 以 stem 查找時，中文 owner（如 `隊員A`）的 image 全部 skip miss，當作新的再傳一輪。ASCII-only owner（`Anna`）完全沒事。

**原因**：`put({ pathname: 'batches/xxx/隊員A__foo.jpg' })` 回傳的 url 是 `https://.../batches/xxx/%E5%90%B3%E8%A1%A3%E7%B5%9C__foo.jpg`。儲存到 `Image.blobPath` 就是 URL-encoded 版本。Import 從 DB 拉 blobPath、取 `path.basename()`、去副檔名得 stem，這個 stem 是 `%E5%90%B3%E8%A1%A3%E7%B5%9C__foo`；但 zip entry name 是原生 UTF-8 `隊員A__foo`，兩者永遠對不上 → 每次重跑都當新 image。

**解決方案**：`decodeURIComponent(path.basename(blobPath))` 之後再取 stem。

**選擇理由**：
- Vercel Blob 的行為可視為合約（URL 必 escape），不能改；只能在比對時 decode
- 易漏測：開發時跑 `Anna` 測通過 → production 跑中文 owner 才炸，需要在 test fixture 刻意放非 ASCII filename
- 另一種做法是「儲存時先 encode，比對時也 encode」— 可行但一樣要全 codebase 統一方向，不如 decode 在 import 端處理簡單

### 發現 RR：Neon pooled connection（pgbouncer + WebSocket）在長駐 INSERT script 下會斷線

**問題**：import v4 跑 94 秒後 WebSocket 掛掉、v5 跑 33 秒掛。client 端吃到 `Error: Connection terminated unexpectedly` 整個 process exit。

**原因**：Neon 發的 env 有兩條 URL：
- `DATABASE_URL` — 走 `ep-XXX-pooler.xxx.neon.tech`，pgbouncer transaction mode + WebSocket（for serverless edge）
- `DATABASE_URL_UNPOOLED` — 直接打 Postgres

Pooled 為 serverless short-lived request 設計。長時間大量 INSERT（上千筆）會撞到下列其中之一：
- pgbouncer transaction-mode 的連線時間限制
- Neon 對閒置 pooler WebSocket 的 idle timeout
- WebSocket frame size 累積過大

**解決方案**：長駐 script 在 `import('@/lib/db')` 之前：
```ts
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}
```
同時把 concurrency 降低（8 → 4）避免單位時間 INSERT peak 太高。

**選擇理由**：
- Neon 官方建議：serverless → pooled；long-running / migration / batch job → unpooled，這是官方分工
- Prisma adapter 會讀第一次 load 時 snapshot 的 DATABASE_URL，swap 必須在 load 前
- Concurrency 降 4 是保險；實測 unpooled 就算 8 也穩，但無必要在 production script 冒險

### 發現 SS：長駐 import script 的中斷 recovery pattern — updateMany scope 要用 batchId 不是 imageIds

**問題**：v3 跑到一半被使用者 Ctrl+C（因為速度不對勁想先診斷），留下一些 `state=unassigned` 的 image 孤兒。重跑 v4 時 script 只 `updateMany({ where: { id: { in: imageIdsFromThisRun } } })`，scope 是「這一輪新 create 的 imageIds」，完全漏掉「上一輪 create 成功、但 state transition 還沒跑」的 orphan。

**原因**：state transition 是 import 流程的最後一步（先 `create Image (state=unassigned)` → 最後 `updateMany to assigned`），如果在兩步之間中斷，orphan 就永遠停在 unassigned。以「這一輪的 imageIds」當 scope 的 updateMany 無法 heal previous run。

**解決方案**：改 scope 為 `{ batchId: batch.id, state: 'unassigned' }`，把 batch 內所有還停留在 unassigned 的 image 一起推進去。

**選擇理由**：
- 長駐 script 重跑就要「收拾上次的尾」是通用原則
- Batch 範圍的 updateMany 是「自我癒合」的 idempotent write — 重跑 N 次結果都一樣
- Trade-off：若未來 batch 內刻意保留 unassigned image（例如 reviewer 手動 unassign 某張），這個 updateMany 會把它也推進去；但目前 state machine 沒有這種 case，未來若有要改 scope condition（加 `createdAt >= runStart` 之類）

---

## 2026-04-18（第 6 次，深夜接續）標註者實戰 bug 熱修期技術發現

### 發現 LL：React 19 concurrent rendering 下 setState functional updater 禁止 deref 可變 ref

**問題**：`AnnotationCanvas.tsx` 右鍵 / 中鍵 pan 時整個 Editor 突然掛掉，Edge 彈出「This page couldn't load / Reload / Back」黑底 fallback。console 只看到 `Cannot read properties of null (reading 'panX')`，沒有 error boundary 接住。

**原因**：mousemove handler 長這樣：
```ts
setVp((cur) => {
  const base = panState.current!;   // ← ref dereference 在 updater 內部
  return { x: base.vpX - dx, y: base.vpY - dy, scale: cur.scale };
});
```
React 19 concurrent rendering 可能把 state updater **延後執行或重跑**（非同步調度、StrictMode double-invoke、tearing recovery 皆可能）。當 `mouseup` 先一步跑完把 `panState.current = null`，updater 再跑時就 throw `TypeError: null.panX`。render phase 的 throw 沒 error boundary 就往上冒到 App root → React unmount 整棵 tree → 瀏覽器把「空白 app」誤判為 navigation 失敗顯示 fallback UI（這是 Edge 常見行為，Chrome 會顯示白畫面）。

**解決方案**：在呼叫 `setVp` 前先把 ref snapshot 到 local const，updater closure 裡只讀這個 local：
```ts
const base = panState.current;
if (!base) return;
setVp((cur) => ({ x: base.vpX - dx, y: base.vpY - dy, scale: cur.scale }));
```

**選擇理由**：React 19 官方文件明講 functional updater **必須是 pure function**，不能依賴 render time 之外的外部可變狀態。snapshot 是 zero-cost 且語意清晰；試過的替代方案（在 updater 裡 `if (!panState.current) return cur;`）只遮住 crash 但行為仍錯（pan 會「凍」一幀）。這條是通用 pattern — 任何 `setState(fn)` 內 deref ref / mutable global / latest closure 都該先 snapshot。

---

### 發現 MM：長駐單頁 SPA（editor 類）的 Auth.js JWT rotation 陷阱

**問題**：標註者連續在同一張圖上標 > 1 小時後，autosave / submit 全部失敗（E24）。F5 重新整理一次 → 好了。過一陣子又壞。

**原因**：Auth.js v5 的 JWT rotation 機制是「每次 server-side request 觸發 `jwt` callback → 重簽 token → 重下 cookie」。觸發時機只有：RSC 請求、API route、proxy middleware、server action。純 client-side 行為（Konva 拖框、local state、autosave PATCH 自己不算 — PATCH 走 API route 本來會觸發，但下面會解釋為什麼也救不了）完全不觸發。連續標註同一頁時：
- 沒有 SSR navigation（同 route）
- API PATCH 確實會跑 proxy middleware → 但 proxy 本身要先解 JWT 才能 authorize，**已過期的 JWT 在 proxy 層就被判 401**，根本進不到 jwt callback rotate 分支
- session.maxAge 若設短（我們原本 1h）→ 活躍使用者也會被踢，違反直覺

**解決方案**：`session.maxAge = 60 * 60 * 24 * 30`（30 天），對齊 Auth.js 預設。搭配 client 層攔 401 → 自動 redirect `/login`（覆蓋「萬一真的過期」case）。

**選擇理由**：有三個方向：
1. 縮短 maxAge + 加 client heartbeat：需要在 editor 起定時 ping server 確保 rotation，增加架構複雜度，且 ping fail 要怎麼處理又是另一坑
2. 長 maxAge（30d）+ 401 redirect fallback：沒有 client 定時器，讓 Auth.js 自己管；過期就踢回 login，使用者重登一次就好
3. 砍掉 JWT 改走 DB session：改動面太大

選 2。editor 類 UI 的特性是「連續互動」，跟 CRUD 頁面（每個動作都切頁）根本不同場景，拿預設 1h 套 editor 就是設計錯了。30 天 + 401 fallback 是標註工具業界普遍做法（Roboflow / CVAT 都是類似的長 session）。

---

### 發現 NN：E12 pattern 漸進遷移進度盤點（App Router route handler 禁用 `throw`）

**問題**：E12 早就記錄過 Next.js 16 App Router 的 route handler `throw Error` 會被吞成空 body 500，但整個 codebase 的 route handler 當時只遷了 approve / reject 兩支，其他散落各處沒掃乾淨。本 session 追 E24 時撞到 annotations PATCH 的 401 被吞成 500，才發現還有遷移債。

**原因**：遷移不是一次性改寫 — 每次新 handler 都要手動避開 throw pattern，但 review 階段很難抓出這類 regression（因為 happy path 測試看起來正常，只有 error path 會炸）。

**解決方案（本 session 遷）**：
- `web/app/api/images/[id]/annotations/route.ts`
- `web/app/api/images/[id]/submit/route.ts`
- `web/app/api/images/[id]/signed-url/route.ts`

新增 `HttpError` class 集中化 status + message，route handler `catch (err) { if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status }); throw err; }`。

**剩餘未遷**（`grep` 到 7 支 route 仍用舊 `throw Object.assign` pattern）：
- `api/projects/route.ts`
- `api/projects/[id]/route.ts`
- `api/projects/[id]/batches/route.ts`
- `api/images/[id]/approve/route.ts`
- `api/images/[id]/reject/route.ts`
- `api/batches/[id]/assign/route.ts`
- `api/me/queue/route.ts`

**選擇理由**：不一次遷完是刻意選擇。本 session 在 production hot-fix 模式，只修標註者實際撞到的 path（annotate 頁用到的三支）；未撞到的剩下七支放進 tech debt backlog，等有空再整批換成 `HttpError`。Premature refactor 在 hot-fix 階段是反模式。

---

### 發現 OO：Keyboard handler 的 `e.repeat` guard 是 SPA 導航通用要求

**問題**：按住方向鍵不放 → `router.push(nextId)` 連續執行幾十次，整個 app 卡在 navigation queue，ErrorBoundary 或記憶體疲軟。

**原因**：Windows keyboard 預設 repeat rate ~30Hz，`keydown` event 會以 ~33ms 間隔連發，`event.repeat === true`。瀏覽器原生按鈕（hyperlink / button）對 keyboard repeat 有 UA 層 debounce，**自訂 keyboard shortcut 不會自動 debounce**。handler 把每個 repeat 都當獨立 key press 處理 → 疊太多 navigate。

**解決方案**：每個 keyboard handler 最前面加：
```ts
if (e.repeat) return;
```

**選擇理由**：三種選項：
1. debounce（lodash `debounce`）：改變原本 responsive 的單次按鍵行為，不好
2. 每個 navigate 加 inflight flag：state 維護多
3. `e.repeat` guard：瀏覽器原生提供的資訊，一行 `return`，零副作用

選 3，這是 SPA 界的通用 pattern。適用時機：**navigate / 觸發 mutation / 播放 sound / 任何非冪等動作**。不適用：text input 的字元輸入（那需要 repeat 才能打字）。

---

### 發現 PP：annotation hit-test edge-only 命中 vs 整框命中的 UX 取捨

**問題**：標註者希望「點框邊緣才選取，點框內部可以畫新框（nested）」。原本的 hitTestBox 是整框 AABB 命中 → 在大框裡面畫新框就會先被外框 intercept，得先按 deselect 才能畫。

**解決方案**：`hit-test.ts` 的 `hitTestBox` 改 edge band 模式：
- 點在 `[outer−8px, outer+8px] ∪ [inner−8px, inner+8px]`（邊框 ±8px）→ 命中該框
- 點在內部（離所有邊 > 8px）→ 不命中任何框 → 落到 draw handler → 開始畫新框
- 邊長 < 2*edgeWidth（16px）的小框 → 「邊帶」會重疊吃掉整個內部，這種超小框整個可點（deadzone 崩陷）

**選擇理由**：
- **Why edge-only**：標註界（CVAT、Labelbox、Roboflow）都走類似 pattern，使用者心智模型是「框是輪廓、內部是空白」，nested box 是高頻使用情境
- **Why 8px**：太窄（3-4px）點不到，太寬（15px+）小框整個變 deadzone。8px 是 Roboflow 用的值，實測手感好
- **Why 小框 deadzone 崩陷**：如果不崩陷，邊長 10px 的框會完全無法點（10 < 2*8），UX 破
- **Why 不做「alt+click 才是 draw、普通 click 永遠 select」**：多一個 modifier key 對高頻操作是沉重負擔，標註者一小時點幾百次

---

### 發現 QQ：Queue 排序要用 immutable 欄位而非 `updatedAt`，否則破壞 spatial navigation 直覺

**問題**：標註者回報「←/→ 切張順序，跟左側 sidebar 列表順序不一樣」。

**原因**：queue select 用 `orderBy: { updatedAt: 'asc' }`。每次 autosave PATCH 會 bump `Image.updatedAt`（Prisma 自動），所以**正在編的圖會持續跑到 queue 尾巴**。畫一下 → 自己變 last item → ←/→ 算出的 next / prev 就跟剛剛不一樣。sidebar 讀 queue 也是同一份，但 sidebar 讀的是某個瞬間的 snapshot → 與 ←/→ 即時算的 index 不同步。

**解決方案**：改 `orderBy: [{ batchId: 'asc' }, { id: 'asc' }]`。`batchId` + cuid `id` 都是 immutable，排序結果 = 匯入順序，使用者編輯任何一張都不改變它的位置。

**選擇理由**：`updatedAt` 排序本來是「讓剛改過的先出現」這類 inbox 型 UX 的預設，不適合 spatial navigation（使用者的心智模型是「圖的位置是固定的，我用 ←/→ 在空間中移動」）。任何會因為使用者動作就重排的欄位都不該用於 navigation queue。可選的 immutable 欄位：`id` (cuid 帶 timestamp prefix → 穩定)、`filename`（自然排序對人類友好，但 cuid 已足夠，無須 filename collation）、`createdAt`（等同 import order）。選 `batchId + id` 是因為 multi-batch 情況下要先按 batch group 再按 import 順序，這符合使用者的 mental model。

---

## 2026-04-18（深夜）import 上雲 + DB 安全防護期技術發現

### 發現 II：Vercel Blob Hobby plan 1GB 上限對 dataset import 太緊

**問題**：`web/scripts/import-per-owner.ts` 跑到第 2312 imgs（約 ~1GB 累計）時 `BlobError: storage quota exceeded`，整個 import 中斷。FRC 視覺 dataset 預估總量 ~1.5GB（3775 imgs × 平均 ~400KB），Hobby 1GB 連一次 import 都撐不完。

**原因**：Vercel Blob Hobby plan 限 1GB 總 storage（不是 monthly bandwidth），對影像類資料集明顯不夠。Pro plan $20/mo 給 100GB，是接下來增加 batch 與 export zip 累積的合理量級。

**解決方案**：升 Pro。沒有「分多個 Blob store 繞過 quota」的合法做法，hobby 限制是 account-wide。

**選擇理由**：YOLO dataset 的單張影像就 ~400KB，3 個 active project × 3000 imgs 就要 3.6GB 起跳，Hobby 100% 不可行。Pro 的 100GB 對單 team 內部審核平台夠用半年以上，不需要再考慮 S3 / R2 自帶 storage。

---

### 發現 JJ：import script 並行化把吞吐量從 0.3 → 3.2 img/s（10x）

**問題**：原版 `import-per-owner.ts` 對每個 image sequential 跑「fetch Drive → upload Blob → DB row」，10 個 owner、3775 imgs 估算要 3+ 小時，實測 0.3 img/s。

**原因**：每個 image 的瓶頸是 network IO（Drive download + Blob upload，兩段都是 round-trip latency-bound），CPU 與 DB 都閒著。Sequential 模式相當於 worker=1，浪費 99% 容量。

**解決方案**：改 `CONCURRENCY=8` worker pool（promise queue with bounded parallelism），實測升到 3.2 img/s，3775 張 ~20 分鐘完成（含 batch finalize + assignment 共 ~35 分鐘）。

**選擇理由**：
- 8 worker 是「Drive API 不抱怨 + Vercel Blob put 不 throttle + Neon connection pool 不爆」的甜蜜點
- 16 worker 試過會偶發 Drive 429，得加 backoff，不值得
- 不引入 worker_threads / cluster — Promise pool 對 IO-bound 工作已經夠

---

### 發現 KK：Neon dev branch 切換只需換 host fragment

**問題**：要在 dev / staging / prod 之間隔離 schema 變更，避免 `prisma db push` 直接打進 production DB 砸表（本 session 之前已發生過，是這次補強的觸發點）。

**原因**：Neon 的 branch 機制是 copy-on-write，每個 branch 有獨立 endpoint hostname，但 password / database name / username 共用同一組 credentials。

**解決方案**：在 `web/.env.local` 把 `DATABASE_URL` 的 host 部分從 prod endpoint (`ep-holy-moon-amdsve0e`) 換成 dev branch endpoint (`ep-cold-bar-amyk8qgq`)，其他 query string + password 不動：
```
postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/DBNAME?sslmode=require
                          ^^^^^^^^^^^^^^^^^^^^^^^
                          只換這段
```

**選擇理由**：
- Neon 設計上就是讓 branch 切換成本接近零，不需要 `pg_dump` / restore
- `.env.local` 在 `.gitignore` 內、不會誤 commit；Vercel production 走 dashboard env vars 不受影響
- Dev branch 寫壞隨時 reset → restore from main，零破壞風險
- 配合 `web/scripts/check-db.ts` 在 script 啟動時印 host 警告，三層保險

---

## 2026-04-18 export route streaming refactor 期技術發現

### 發現 HH：Function-bound zip export 的 streaming pattern（fflate Zip + ReadableStream + Vercel Blob multipart）

**問題**：`web/app/api/projects/[id]/export/route.ts` 原本用 `fflate.zipSync(entries)` 把所有 approved images 全部 fetch 進 memory、打一個 zip buffer、再 `new NextResponse(zipBuf)` 單次回傳。當 approved images 規模大（預估 ~2500 imgs × 2MB = 5GB），會同時撞三個 Vercel Function 天花板：
1. **Memory**：預設 1024MB，5GB buffer 根本放不下
2. **Response size**：Vercel Function body size 上限
3. **Duration**：`maxDuration` 預設不足以 sync 讀完所有 Blob 再打包

**原因**：`zipSync` 是一次性同步 API，entries 必須全讀進 RAM 才能打包；`NextResponse(buf)` 也需整個 buffer 在 memory。在 serverless 環境下，任何「全量 in-memory」模式在資料量上去後都會炸。

**解決方案（方案 3：server 打 zip → upload Blob → 回 signed URL）**：

```ts
import { Zip, ZipPassThrough } from 'fflate';
import { put } from '@vercel/blob';

const zipStream = new ReadableStream<Uint8Array>({
  start(controller) {
    const zip = new Zip((err, data, final) => {
      if (err) { controller.error(err); return; }
      if (data) controller.enqueue(data);
      if (final) controller.close();
    });

    (async () => {
      // classes.txt / data.yaml — small synthetic files
      const classesEntry = new ZipPassThrough('classes.txt');
      zip.add(classesEntry);
      classesEntry.push(encoder.encode(classesContent), true);

      // images + labels — fetch one at a time, push per file
      for (const img of approved) {
        const buf = new Uint8Array(await (await fetch(img.blobUrl)).arrayBuffer());
        const imgEntry = new ZipPassThrough(`images/${img.filename}`);
        zip.add(imgEntry);
        imgEntry.push(buf, true);

        const labelEntry = new ZipPassThrough(`labels/${img.filename}.txt`);
        zip.add(labelEntry);
        labelEntry.push(encoder.encode(labelContent), true);
      }

      zip.end();
    })().catch((e) => controller.error(e));
  },
});

const blob = await put(key, zipStream, {
  access: 'public',
  contentType: 'application/zip',
  addRandomSuffix: false,
  allowOverwrite: true,
});
return NextResponse.json({ url: blob.url, filename, imageCount });
```

加 `export const runtime = 'nodejs'` + `export const maxDuration = 300`。

**關鍵細節（踩坑才會知道）**：
1. **`@vercel/blob.put()` v2 對 `ReadableStream` 自動走 multipart upload**：內部 pull-driven 消費，不需手動 chunk
2. **`ZipPassThrough` 是 fflate streaming 的 entry type**：`zip.add(entry) → entry.push(chunk, finalFlag)`，最後 `zip.end()` 觸發 central directory flush
3. **Backpressure 沒明確控制但實測 OK**：async IIFE 靠 `await fetch` 自然節流，fflate 的 callback 是同步 emit（data 小到 buffer 內），Blob 的 multipart readable 是 pull 模式會自然阻塞 IIFE
4. **Memory footprint**：理想狀態是 O(1 image) — 單張 fetch 完 push 進 zip 就 GC，fflate 不 retain entry data
5. **Error propagation**：callback 的 err 要 `controller.error()`；IIFE 內 throw 要 `.catch(e => controller.error(e))`，否則 ReadableStream 會 hang

**為什麼不選其他方案**：
1. **Streaming response（`return new Response(zipStream)`）** — 仍卡 Function duration + 客戶端斷線重試會浪費（每次重 zip）。且 Vercel Function streaming 中途 timeout 客戶端拿到的 zip 是 corrupted
2. **Vercel Workflow DevKit（durable job）** — 過度工程。目前是「user 按按鈕等結果」的同步 UX，不需 pause/resume、crash-safe orchestration。真撞到 maxDuration 上限才考慮
3. **客戶端自行 fetch 每張 + JSZip** — 授權 + Blob signed URL 管理麻煩，且 YOLO label 是 server 邏輯（需讀 DB annotations → 轉 `class_idx cx cy w h`），client 做不到

**選擇理由**：
1. **Memory O(1)** — 任何 image 數量都不爆記憶體
2. **Response size 不是問題** — function 只回 JSON `{ url }`，zip 本體在 Blob
3. **客戶端下載可續傳** — Vercel Blob 本來就支援 HTTP range，瀏覽器原生處理
4. **錯誤語義清楚** — 打包失敗 function 回 500，下載失敗瀏覽器顯示 Blob 錯誤，切開兩段可診斷

**限制 / 遺留**：
- **Function maxDuration 300s（Pro plan）天花板仍在** — fetch + zip 是 sequential，2500 imgs 估 100-200s。若撞到下一步：Fluid Compute 800s / 分批 export / Workflow DevKit durable
- **Blob 累積**：每次 export 寫新 timestamp key `frc-annotation/exports/{projectId}/{name}-yolo-{ISO}.zip`，未來要加 TTL 或清理 cron
- **test 要 mock ReadableStream 消費**：`vi.mock('@vercel/blob')` 的 `put` mock 要主動 reader loop 拼 chunks 回 `capturedZipRef.current`，`vi.hoisted` 搬 ref 到 module scope

**commit**：`2e465f0 refactor(web): export via streaming zip uploaded to blob`（merged to master 2026-04-18）

---

## 2026-04-18 auto-annotation pipeline 期技術發現

### 發現 BB:rclone "Shared with me" 的 `lsd` vs `copy` 結果不一致

**問題**:Stage 1 前用 `rclone lsd gdrive:frc視覺辨識 --drive-shared-with-me` 列出 11 個擁有者資料夾,實際跑 `rclone copy` 完只有 7 個資料夾物化到本地 disk(Anna / 隊員F / 隊員H / 隊員D / 隊員C / 隊員I / 隊員J),少了 Phi / 隊員A / 隊員B / 段佑霖。

**原因**(假設,未驗證):
1. **最可能**:那 4 個資料夾在 Drive 上是空的。`rclone copy` 預設不建立空目錄(本地端)— 這是 rclone 設計選擇,不是 bug
2. **次可能**:那 4 個擁有者把資料夾分享給其他人但**沒分享給 owner 帳號**,`--drive-shared-with-me` 看到 listing 是因為 listing API 比 file-content API 寬鬆
3. **不太可能但要排除**:HEIC / 中文檔名特殊字元觸發 rclone copy skip

**解決方案**(下 session 排查):
```bash
# 各別列檔,確認資料夾是不是真的空
rclone lsf "gdrive:frc視覺辨識/Phi" --drive-shared-with-me
rclone lsf "gdrive:frc視覺辨識/隊員A" --drive-shared-with-me
rclone lsf "gdrive:frc視覺辨識/隊員B" --drive-shared-with-me
rclone lsf "gdrive:frc視覺辨識/段佑霖" --drive-shared-with-me
```
- 若回空 → 假設 1 成立,不必管(空資料夾沒素材)
- 若回有檔但 copy 時 skip → 看 rclone log 抓 skip reason
- 若 lsf 也回 permission error → 假設 2 成立,要請該 owner 重新 share

**選擇理由**:不在 pipeline 裡硬塞「強制 copy 空目錄」邏輯,因為:
1. 空目錄沒檔案處理也沒意義
2. `rclone copy --create-empty-src-dirs` 是有 flag 但會塞一堆無意義空目錄
3. 真正風險是「資料夾不空但沒下來」— 這要靠 lsf 排查源頭,不是 pipeline 補

**遺留**:本 finding 是預防型,Stage 1 下來的 5.15 GiB 已足夠跑後面 stages。但若 user 後續說「為什麼 Phi 上的素材沒進 batch」,排查順序就照上面三個假設走

---

### 發現 CC:Gemini 模型名稱發現 — `gemini-3.1-flash-lite-preview` 才是正解,本機 `gemini` CLI 有靜默 fallback bug

**問題**:User 指定要用 `gemini-3.1-flash-lite-preview` 模型(便宜:$0.25/M input + $1.50/M output)。本機 `gemini` CLI v0.38.1 跑 `gemini -m gemini-3.1-flash-lite-preview "test"` 居然回了一張 PNG 圖片,而非 text。

**原因**:
1. 真正的 `gemini-3.1-flash-lite-preview` 是 text-only model,Google 官方 model registry 有列(可用 REST `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview` 驗證返回 metadata)
2. 本機 `gemini` CLI v0.38.1 收到不認識的 model name 時**會 silent fallback** 到 `gemini-3.1-flash-image-preview`(image-generation model),產出圖片不是文字。CLI 沒回 warning、沒退非零 exit code,純然以為自己是「正確 model」
3. 推測:CLI v0.38.1 的內建 model whitelist 還沒收錄 `flash-lite-preview`,fuzzy match 滑到 `flash-image-preview`

**解決方案**:**完全不用 `gemini` CLI 跑 pipeline**。改用 Python `google-genai` SDK 直接打 REST API:
```python
from google import genai
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
resp = client.models.generate_content(
    model="gemini-3.1-flash-lite-preview",  # 直接打 REST,不經 CLI 的 model resolver
    contents=[image_part, prompt_text],
    config=GenerateContentConfig(response_mime_type="application/json", response_schema=...),
)
```
驗證方式:`curl https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview?key=$KEY` 回 200 + valid metadata → 確認 model name 對。

**選擇理由**:
1. **CLI 不可信** — silent fallback 到錯 model 是 critical bug,沒 warning 等於 sabotage
2. **REST/SDK 給 explicit error** — 打不存在的 model name 會 404,看得到
3. **SDK 還可走 async + structured output** — `response_schema` enforce JSON,reduce parse error。CLI 沒這層
4. **Pipeline 反正要程式控制 concurrency / retry / state** — 用 SDK 自然,CLI 只能 shell out 包一層 subprocess 又一層 dirty

**遺留警告**:
- 本機 `gemini` CLI v0.38.1 全面別用,任何 model 都不該打(無法保證 fallback 行為)
- 升級到 CLI 新版前先測:`gemini -m gemini-3.1-flash-lite-preview "Reply with the literal string OK"`,確認回的是 text "OK" 而非圖片
- 如果未來看到 `gemini-3.1-flash-image-preview` 出現在 log / output 裡,直覺懷疑 CLI silent fallback

---

### 發現 DD:web 平台 batch import 格式契約 — `classes.txt` 必須 EXACT 符合 project class list

**問題**:Stage 4 要產 YOLO zip 給 web 平台 finalize endpoint。要確認 zip 結構、class 編號、validation 規則,避免上傳被 reject。

**原因 / 契約**(查 `web/app/api/batches/[id]/finalize/route.ts` + `web/lib/zip-validator.ts` 得):
1. **Zip 內容**:`classes.txt`(必)+ `images/<id>.{jpg,png,webp}` + `labels/<id>.txt`(YOLO format:`class_idx cx cy w h`,normalized 0–1)
2. **`classes.txt` 一行一個 class name**,**順序與 index 必須完全對齊**該 project 在 DB 裡 `Project.classes` 的 order/name。任何 mismatch 直接 reject(error message 會帶 `expected=[...] got=[...]`,見 ERROR.md E12)
3. **大小限制**(`zip-validator.ts`):
   - ≤ 500 imgs / batch
   - ≤ 200 MB compressed
   - ≤ 500 MB uncompressed
   - ≤ 20 MB per file
   - ≤ 1200 entries(images + labels + classes.txt 加總)
4. **Annotation DB schema**:每個 box 存成 `Annotation { source: 'gemini', authorId: null }`(若 source 是 gemini,authorId 必為 null,反之亦然)
5. **路徑安全**:見 ERROR.md E2,zip 內檔名擋 Windows drive prefix / null byte / control char / 目錄穿越

**解決方案**:`auto_pipeline.py` Stage 4 必須:
- (a)從 web `Project.classes` 讀真實 class list(透過 web API 或 user 手動把 class list 貼進 pipeline config)
- (b)`classes.txt` 寫死 `red_robot\nblue_robot\nfuel\n` — 但**前提**是 web 端 project 已建好同名同序的 3 個 class
- (c)切 batch 時每包 ≤ 500 imgs,單檔 ≤ 20 MB(Stage 2 應該已壓到 1080p 以下,通常不會超)

**選擇理由**:不用 web API 動態查 class list,因為:
1. Pipeline 沒登入 web 的 credential(SSR 端要 OAuth)
2. Class schema 在本案 fix 為 3 類,變更頻率極低
3. User 在 web 端建 project 時手動設好 3 類即可,一次設定終身用

**遺留動作**:
1. Stage 4 跑前,user 必須先在 web /projects/new 建一個 project,classes 順序填 `red_robot, blue_robot, fuel`(完全照這個順序+名字)
2. 若以後加第 4 類(例如 `gear`),要同時改:(a) Gemini prompt schema、(b) `auto_pipeline.py` CLASSES 常數、(c) web project class list
3. 改 class list 不能 retroactive — 既有 batch 已 finalize 的不受影響,新 batch 才用新 class

---

## 2026-04-17 (第 7 次 session) onboarding 跳轉 + reject preset 期技術發現

### 發現 Z:next-auth v5 beta.31 `useSession().update()` 的 cookie rotation 不穩定

**問題**:首次登入使用者在 `/onboarding/name` 輸入中文名字 → PATCH `/api/me/display-name` 成功（DB 已寫 `displayNameSetAt = now()`）→ `await useSession().update()` → `router.push('/')` → 結果停在 `/onboarding/name` 原地,沒跳到 dashboard。hard refresh 後才會跳。

**原因**:
1. `useSession().update()` 在 next-auth v5 beta.31 的設計意圖是「觸發 jwt callback 重跑」,但實際行為**不保證當場 rotate JWT cookie**。client-side 可能只更新記憶體裡的 session object,cookie 還是 stale
2. `router.push('/')` 是 client-side navigation,經 Next.js 16 proxy 的 `auth()` gate 讀的是 request 帶過來的 cookie（還是 stale 的,`hasDisplayName === false`）→ proxy redirect 回 `/onboarding/name`
3. 使用者肉眼看到的是「按儲存後什麼都沒發生」,實際是 redirect loop 被 client router 吃掉

**解決方案**（commit `6767a05`）:改成 full-page navigation。
```tsx
// 前:
await fetch('/api/me/display-name', { method: 'PATCH', ... });
await update(); // useSession().update()
router.push('/');

// 後:
await fetch('/api/me/display-name', { method: 'PATCH', ... });
window.location.href = '/'; // 整頁重載
```

`window.location.href` 觸發瀏覽器完整 navigate → 瀏覽器重新送 request → proxy 的 auth() 再跑一次 jwt callback → jwt callback 從 DB 讀最新 `displayNameSetAt` → rotate cookie → proxy 看到 `hasDisplayName === true` → 放行 `/`。

**選擇理由**:
1. **不依賴 `update()` unstable 行為** — 繞開 beta.31 的不穩定,用瀏覽器原生行為
2. **proxy 的 jwt callback 是 single source of truth** — 已經在做「每次 request 從 DB 讀」,full-page nav 讓這個機制自然生效
3. **移除 `useSession` + `useRouter` 依賴** — onboarding name form 簡化為純 fetch,減少 client-side dependencies
4. **UX 影響可忽略** — onboarding 只做一次,full-page reload 比停在原頁 debug 好太多

**副作用 / 注意**:
- Next.js 16 proxy 預設跑 **Node.js runtime**（不是 edge）,所以 jwt callback 裡用 Prisma 沒問題。若未來把 proxy 硬切 edge runtime,jwt callback 就不能用 Prisma,這個 pattern 會失效
- 有其他流程（例如「admin 幫 user 改 role 後前端要即時反映」）走類似 `useSession().update()` + `router.push`,也可能會撞到同樣問題。今天先不預防性改,等回報再說（Finding V 記過 session.user.role 依賴 jwt callback DB 讀 的機制,靠 hard refresh 解;本 finding 把「hard refresh」正式化成 `window.location.href`）

**相關**:Finding K（`hasDisplayName` JWT claim + proxy gate）設計時已經預期「update() 要能讓下次 request 拿到新 cookie」,但沒預期 update() 自己就不穩定。這是 beta.31 特有的 gotcha,後續版本修正後可回歸 `router.push` + `update()` pattern(但沒必要,full-page nav 夠用)

**遺留注意事項**:
- 若 next-auth v5 出 stable,重新評估 `update()` 是否可靠。可靠後才回 SPA nav
- 任何「server 改 session state → 前端要即時反映」流程都應先考慮 full-page nav,避免 stale cookie race

---

### 發現 AA:Next.js 16 proxy 預設 Node.js runtime — Prisma 可在 jwt callback 安心用

**問題**:diagnose 首次登入 redirect loop 時需要確認「proxy 裡的 jwt callback 會不會每次 request 都從 DB 讀 `displayNameSetAt`」。若 proxy 跑 edge runtime,Prisma + Neon adapter 不能用,jwt callback 只能讀 token 現有 claim（stale）。

**原因**:
1. Next.js 15 的 `middleware.ts` 預設跑 edge runtime,Prisma 要走 edge-compatible adapter（`@prisma/adapter-neon` 配 `@neondatabase/serverless` 走 HTTP,不是 TCP）
2. Next.js 16 把 `middleware.ts` 改名為 `proxy.ts`（但 `middleware.ts` 仍兼容）,**預設改跑 nodejs runtime** — 可選 `export const runtime = 'edge'` 換回 edge

查 `web/proxy.ts` 頂部無 runtime export → 確認是 Node.js runtime → Prisma 可用 → jwt callback DB 讀為 reliable path。

**解決方案**:不用改什麼,確認現狀 OK。但這是診斷 Finding Z 時的關鍵 assumption,值得文件化為 first-class finding。

**選擇理由 & 設計原則**:
1. **Next.js 16 把 proxy 預設 Node.js 是個升級實務優勢** — 不再需要為了跑 Prisma 而特別設 runtime
2. **Edge runtime 只是「更快冷啟動 + 全球分散」** — 不是所有 middleware 都值得付這個代價。本專案 authenticated users 就那 16 個人,冷啟動差幾十 ms 無所謂,用 Node.js 換「Prisma 可用」是正確 trade-off
3. **Auth.js v5 的 jwt callback 在 Node.js proxy 裡可以 full featured** — 包含 DB round-trip、async initialization、任何 npm package。Edge runtime 會被 Cloudflare Workers runtime API limits 限制

**遺留注意事項 / 預防 checklist**:
- 若未來某人在 `web/proxy.ts` 加 `export const runtime = 'edge'`,jwt callback 就不能用 Prisma → `hasDisplayName` / `role` 從 token 讀(stale permissible?要重新 threat model)
- 若 proxy 變 edge,Finding Z 的 full-page nav 仍 reliable,但變得**必要**（SPA nav 會永遠 stale）
- 任何 proxy-level gate（onboarding、RBAC、rate limit）在 edge 下都要重新評估能不能 DB 讀
- Proxy 裡的 Prisma round-trip 對 performance 有影響（每個 protected request +1 DB trip)— 若流量起來要 cache。目前 team 16 人規模無壓力

**相關**:Finding C（v15 → v16 middleware → proxy 改名）提過 proxy 可選 Node.js,本 finding 補記「預設 Node.js」+「Prisma 可用」這個 implication

---

## 2026-04-17 (第 6 次 session) UI 權限洩漏修復 + submit 延遲優化期技術發現

### 發現 U:UI 權限洩漏常見於「mutation 已擋但入口未擋」

**問題**:Session 5 完成後,annotator 在 production 看得到 Projects 連結 + dashboard 的「All projects」區塊。點進去還能瀏覽 `/projects` 列表頁 + `/projects/[id]` 詳情頁。雖然任何 mutation（create/upload/assign/export）都被 `StepUpGuard scope="admin"` 擋下,但:
1. UI 露出入口讓 annotator 誤以為自己應該有那些權限（心理挫敗）
2. /projects 頁面本身暴露所有專案名稱 + batch 狀態 + 圖片數（資訊洩漏）

**原因**:RBAC 審查時的盲點 — `lib/rbac.ts` ROLE_MATRIX 定義完整,但 UI 層（TopNav 連結、dashboard section、route layout）沒做 role gate。開發時思維「只要 mutation 擋了就夠」是錯的,忽略「入口可見性」也是權限的一部分。

**解決方案**:三層防護
1. **UI 隱藏**（`top-nav.tsx` + `page.tsx`）:讀 `session.user.role`,用白名單 gate 連結與 section
2. **Server-side redirect**（`projects/layout.tsx`）:async layout 讀 session.role,非 admin/final_reviewer 即 `redirect('/')`。防手打網址
3. **Mutation gate**（原有 `StepUpGuard` + `authzOr401`）:留著作為最後一道

三層缺一不可。只有 1 是 UI 偽裝,手打網址就破功；只有 3 是安全但 UX 糟糕。

**選擇理由**:
1. UI layer 用 role 明確白名單而非黑名單 — 未來加新 role 時預設 deny 不 leak
2. Server-side redirect 放在 layout（不是 middleware）因為 layout 有 session context 無需額外 fetch,且 layout 會自動套用到子樹
3. Mutation gate 故意不動,因為 step-up cookie 作為 reviewer/admin 動作的 second-factor 本身有價值（reset after step-up expiry）

**預防 checklist（未來新增 protected route 時）**:
- [ ] TopNav 連結是否 role gate?
- [ ] Dashboard / 其他 entry 是否 role gate?
- [ ] Route layout 是否 server-side redirect?
- [ ] API route 是否 authz check?

**相關**:Session 3 的 E10 / E11 記過類似的 RBAC 相關 footgun,但那時是「route 層擋到太死 + admin 看不到新登入 user」。本次是相反方向「UI 層太鬆 annotator 看得到 admin 入口」。兩邊都反映「session + whitelist + role + step-up 四種 state 並存容易漏掉某一層」。

---

### 發現 V:Session.user.role 的 type augmentation + jwt callback refresh 機制

**問題**:Session 6 診斷使用者自身 role 錯誤時發現 — 使用者打 `/api/auth/session` 看到 `user.role === 'annotator'`,但 DB 裡他是 admin（經過本次 script 更新）。他不需要登出再登入就能拿到新 role?

**原因**:`web/types/next-auth.d.ts` 用 `declare module 'next-auth'` 擴充 `Session['user']` 加 `role` 欄位,並在 `lib/auth.ts` 的 jwt callback 每次 token refresh 時從 DB 讀最新 role 寫入 JWT payload。這讓 role 更新不需要重登 — 但 session cookie 本身會 cache（Next.js `getServerSession`）約 5 分鐘,畫面可能延遲。

```ts
// lib/auth.ts jwt callback (pseudo-code)
callbacks: {
  async jwt({ token, user }) {
    if (user) token.role = user.role; // first login
    else if (token.email) {
      const dbUser = await db.user.findUnique({ where: { email: token.email } });
      token.role = dbUser?.role ?? 'annotator'; // refresh every trigger
    }
    return token;
  },
  async session({ session, token }) {
    session.user.role = token.role; // expose to client
    return session;
  }
}
```

**解決方案**:告知使用者 hard refresh 觸發 jwt callback re-run 即拿到新 role。若急則 logout+login 強制 cookie 重建。

**選擇理由**:
1. 每次 jwt refresh 都 DB round-trip 對 performance 有影響,但 role 改動稀疏（admin action）值得 — 避免 user 被 cached role 困住
2. Alternatives:存 User.roleUpdatedAt 然後用 JWT `iat` 比對 — 複雜度不值得現在的使用量
3. Type augmentation 放 `web/types/next-auth.d.ts` 而非 `lib/auth.ts` 裡是 Auth.js v5 慣例,`tsconfig.json` 的 `types` path 自動 pick up

**相關**:這跟 Session 3 發現 M 的 `ACTION_SCOPE` 是一對:M 集中「action → step-up scope」映射,V 集中「user → role」讀取。兩者合起來組成完整的 RBAC data flow。

**遺留注意事項**:若未來改 role 然後使用者反映「UI 沒變化」,第一步診斷一律打 `/api/auth/session` 看 token 是否刷新。若 token 是舊的,hard refresh 就是解法。

---

### 發現 W:flushSave snapshot pattern — 配合 inFlightSave coalescing 完成 save 短路

**問題**:Session 5 發現 S 解了 in-flight save race（`cb67386`）,但每次 `flushSave()` 仍無條件發 PATCH,即使 boxes 沒變更。對 ←/→ nav 與 submit 都增加冗餘 round trip。使用者按 `s` 感覺延遲明顯（600-1400ms）。

**原因**:flushSave 原本實作只看「有 pending debounce?」(`saveTimer.current`)和「有 in-flight save?」(`inFlightSave.current`)。這兩者都 null 時仍會 `await doSave()` fire 一發新 PATCH,但若 boxes 跟「上次成功 save 的 snapshot」相同,這 PATCH 是白做的。

**解決方案**（commit `a5b6a71`）:加 `lastSavedBoxesRef` snapshot ref。
```ts
const lastSavedBoxesRef = useRef<Box[] | null>(null);

async function flushSave(): Promise<boolean> {
  // no-op early return when已 saved + no pending + no in-flight
  if (
    boxesRef.current === lastSavedBoxesRef.current &&
    saveTimer.current === null &&
    inFlightSave.current === null
  ) return true;

  // ... existing flush logic
}

async function doSave(): Promise<boolean> {
  // capture snapshot BEFORE await,避免 race
  const snapshot = boxesRef.current;
  const promise = (async () => { /* PATCH */ return true; })();
  inFlightSave.current = promise;
  try {
    const ok = await promise;
    if (ok) lastSavedBoxesRef.current = snapshot; // 只 mark 這個 snapshot saved
    return ok;
  } finally { /* clear inFlightSave */ }
}
```

關鍵:**snapshot 是 PATCH 發出前 capture,成功後寫入 `lastSavedBoxesRef`**。若期間使用者再編輯（boxesRef 變了）,`boxesRef !== lastSavedBoxesRef`,下次 flush 不會 no-op。

**選擇理由**:
1. **Reference equality 而非 deep equality** — editor 的 onBoxesChange 每次產新陣列,ref compare 夠。省 O(N) compare
2. **Capture-before-await pattern 與 Session 5 的 inFlightSave 一致** — 都是「snapshot 在 async boundary 前,compare on success」。這類並發邏輯統一使用此 pattern 可預測
3. **`lastSavedBoxesRef = null` 初始值** — 首次 flush 必發 PATCH（即使初始 boxes === null）,確保 server 至少看到一次 state
4. 省掉的 PATCH 不是性能小事 — ←/→ rapid nav 時每次都省一發,使用者感受明顯

**副作用 / 注意**:
- 若 server 端 state 與 client 不同步（例如 reviewer 在另一 tab reject 了 image）,我們的 snapshot 仍為「跟前次 PATCH 相同」→ no-op。但 image state 異動有 server push 或下次載入 corrections,不是這裡的責任
- lastSavedBoxesRef 只在 `doSave` 成功後寫入,失敗（例如 network error）不會錯誤 mark saved

**架構演化**:Session 5 的 inFlightSave 解 race；Session 6 的 lastSavedBoxesRef 解冗餘。兩者合起來讓 save 邏輯變成:「有變更 → 有 in-flight 就 coalesce;無變更 → 不發 PATCH」。這是完整 save 短路優化。

---

### 發現 X:router.prefetch 對 SSR navigation 延遲的實質影響

**問題**:annotate 頁按 `s` submit 走 flushSave → POST submit → `router.push(next)`,三個 serial round trip。實測 600-1400ms 延遲。前兩個是 API call 無法避免,`router.push(next)` 本應只是 client-side state 變更,但因為 `/annotate/[imageId]` 是 dynamic RSC route,navigation 需要 fetch 下張 route 的 RSC payload → 變成第三個 serial round trip。

**原因**:Next.js 16 App Router 的 `router.push` 若目標 route 未 prefetch,會同步等 RSC payload。本 project 的 `editor.tsx:250-262` 已經 prefetch 下 5 張的 signed-url + image blob,但**沒 prefetch route 本身**。

**解決方案**（commit `a5b6a71` 的 A 部分）:useEffect prefetch 下 5 張 route payload。
```ts
useEffect(() => {
  for (const id of nextIds) {
    router.prefetch(`/annotate/${id}`); // RSC payload warm
    fetch(`/api/images/${id}/signed-url`).then(...); // 既有
  }
}, [nextIds]);
```

`router.prefetch` 是 non-blocking,多張 prefetch 不會互相阻擋。RSC payload 會在 Next.js 的 router cache 裡等著,submit 時 `router.push` 直接 hit cache。

**實測結果預期**:
- 按 `s` 前:flushSave ~50-200ms + POST submit ~200-500ms + router.push(含 RSC fetch) ~300-700ms = 550-1400ms
- 按 `s` 後:flushSave ~0ms（若已 saved,no-op）或 ~50-200ms + POST submit ~200-500ms + router.push（hit prefetch）~20-50ms = 220-750ms
- 若完全無變更 + prefetch 成功:~250ms
- 若有變更 + prefetch 成功:~550ms

**選擇理由**:
1. `router.prefetch` 是 Next.js 公開 API 設計來解這種問題,不用手刻 cache
2. Prefetch window 5 張與既有 signed-url prefetch 同步,避免多套 cursor 概念
3. 只在 useEffect 觸發時 prefetch,不是每次 render — 避免過度 prefetch

**注意事項**:
- Vercel 的 prefetch 有 timeout（約 1s 內完成才 commit 到 cache）。若網路慢,5 張可能只 prefetch 到 2-3 張 — 這是 graceful degradation,最糟的情境就跟沒做 prefetch 一樣
- Prefetch 會 trigger server-side page render（server component fn 跑一遍）— 對 cold-start function 會有少量 warm-up 成本,但 amortized

**相關**:與 Session 3 的「signed URL 預抓」是同家族的 UX 優化 — 使用者 rapid nav 時所有下游資源都要 warm ready。這次補齊了「route 本身」這一層。

**架構原則**:Nav 前 prefetch 下 N 張的所有依賴資源 — RSC payload、signed URL、image blob。N 值平衡頻寬 vs 延遲,目前 5 張是 heuristic,未來可依 bandwidth 與 quota 調整。

---

### 發現 Y:set-role script + vercel env pull 的 production DB 操作 pattern

**問題**:本 session 需要改 4 個 production user role。方法有三:
1. Admin UI（/admin/members）— 有但 UX 不夠好（一次一個,且可能漏 upsert whitelist）
2. 直接用 Neon console 執行 SQL — 慢,要手動拼 SQL
3. 跑腳本 — 要抓 production DATABASE_URL

選 3 最快,但如何安全拿 production env 又不留 .env 在 repo?

**解決方案**（commit `1dffd88`）:`vercel env pull` + reusable tsx script。
```bash
# 1. Pull production env 到 .env.vercel.production（gitignored）
vercel env pull --environment=production .env.vercel.production

# 2. Run script with --env-file
npx tsx --env-file=.env.vercel.production scripts/set-role.ts rosalyn@example.com admin

# 3. 刪除 .env.vercel.production（或留著 reuse）
```

Script 內容（`web/scripts/set-role.ts`）關鍵邏輯:
```ts
const [, , email, role] = process.argv;
if (!email || !['admin', 'annotator', 'final_reviewer'].includes(role)) {
  console.error('usage: set-role <email> <admin|annotator|final_reviewer>');
  process.exit(1);
}

const before = await db.user.findUnique({ where: { email } });
console.log(`before: ${before?.role ?? 'NOT_FOUND'}`);

await db.$transaction([
  ...(before ? [db.user.update({ where: { email }, data: { role } })] : []),
  db.emailWhitelist.upsert({
    where: { email },
    create: { email, role },
    update: { role },
  }),
]);

const after = await db.user.findUnique({ where: { email } });
console.log(`after: ${after?.role ?? '(whitelist-only, user not yet registered)'}`);
```

**選擇理由**:
1. `vercel env pull` 是 Vercel 官方工具,不手拼 URL 風險低
2. `--env-file` 是 Node 20+ 原生 flag,不需 dotenv
3. Script update User.role + upsert EmailWhitelist 兩件事 — 即使 user 後來被刪除重建（例如測試環境 reset）,whitelist role 保留,下次登入仍拿到正確 role
4. Transaction 包起兩筆操作,部分失敗不會造成 split-brain

**安全注意事項**:
1. **`.env.vercel.production` 必須 gitignored** — 本專案 `.gitignore` 已包含 `.env*` glob,但新手可能用 `.env` whitelist 而忽略。驗證 `git status` 沒 leak
2. **Script 執行後刪除 env file** 或用 1Password CLI 一次性注入（未來優化方向）
3. **Limit script 範圍** — 只做 User.role + EmailWhitelist,不能 create/delete 其他 entity

**重用價值**:未來任何 role change 都用此 script 一行搞定。Admin UI 若有日後重寫更好的 flow,script 保留作為 fallback(CLI always works)。Production DB 偶爾有 emergency fix 也用同 pattern。

**相關**:Session 3 的 E11 提過 whitelist 與 User.role 可能 drift — 本 script 故意兩邊同步更新,正面迎戰這個 drift 問題。

---

## 2026-04-17 (第 5 次 session) Annotation Editor UX Upgrade 實作期技術發現

### 發現 Q：`react-hooks/immutability` 規則會因 effect 聲明順序誤判 ref mutations

**問題**：React 19 的 `react-hooks/immutability` 規則在 Task 1.4 加了 Esc useEffect 之後,誤 flag 所有 `dragState.current = ...` mutations(5 個錯誤)。錯誤訊息類似「Modifying a value that is used in an effect」,但實際 dragState 是 event handler 自己管理的 ref,沒被 effect 讀過。

**原因**：Esc useEffect 原本放在 state/ref 宣告之前(declarative style 誤以為 effect 位置無所謂)。React 19 compiler 做 flow analysis 時,從 effect 位置往前掃,把 dragState 標記成「effect 相依」,因此禁止後續 mutation — 這是 compiler 做的保守誤判,不是規則定義不精確。

**解決方案**：commit `9b775ea` — 把 Esc useEffect **移到 state/ref 宣告之後**。這同時解決兩件事:
1. Declaration-order issue(`setIsDrawing accessed before it is declared`)
2. `react-hooks/immutability` 停止誤判

**選擇理由**：
1. 比起加 5+ 個 `eslint-disable-next-line react-hooks/immutability` 註解污染程式碼,移動 effect 位置是零成本的正確解法
2. Effect-after-declaration 本來就是 React convention(effect 讀 state/refs 時 state/refs 必須先存在),只是過去沒 enforcement
3. 未來 React 19 compiler 會更嚴,早一點遵守 convention 越好

**遺留規則**:新的 useEffect 必須宣告在它所讀取的 refs/state 之後,否則 React 19 compiler 會把 refs 視為 effect-dependent → 後續所有 event handler 對該 ref 的 mutation 都會被誤判。

**相關**:Mirror state pattern(`isPanning`/`isDrawing` 鏡射 `panState.current`/`drawState.current`)— React 19 `react-hooks/refs` 禁止 render 時 read refs,所以 cursor 邏輯用 state booleans 鏡射 refs。這是另一個 React 19 新規則,本 session 第一次撞到。

---

### 發現 R:shadowBox pattern — commit-on-release 避免 undo stack 在 drag 中爆炸

**問題**:Task 2.1 refactor 前,Canvas 在 move/resize drag 中每個 mousemove frame 都呼叫 `onChange(boxes.map(...))`,parent editor 收到後會 `pushUndo(oldBoxes)` 進 stack。rapid mouse-move(60 Hz)= 1 秒內 undo stack 被推爆 50 cap,之前真正的編輯狀態全丟失。

**原因**:Undo stack spec(§7)要求「cap 50 per-image,每個 mutation 前 push 一個 snapshot」。原實作把「drag 進行中每個 frame 的中間值」當成 mutation,導致一次拖動 = 數十次 push。關鍵誤解:「drag-in-progress 的 intermediate state」**不是 user-visible mutation**,只有 drag-release 的 final value 才是。

**解決方案**:Canvas 引入 `shadowBox: useState<Box | null>` 做 live drag preview。
- Drag 中不呼叫 `onChange`,只 `setShadowBox`
- Mouseup 時才用 shadowBox 算出最終 boxes 陣列並呼叫 `onChange(...)`
- Parent 只收到一次 commit,undo stack 只 push 一次
- Esc 或 window-mouseup 清空 shadowBox → drag 中被 undo 會自動「還原」(shadowBox 消失,displayBoxes fallback 到 boxes 原狀)
- 渲染:`const displayBoxes = shadowBox ? boxes.map(b => b.id === shadowBox.id ? shadowBox : b) : boxes;`

**選擇理由**:
1. 符合 spec §7 的 "mutation" 語意 — 只有 user-visible final state 才是 mutation
2. 修掉 parent O(N) re-renders per mouse-move 的效能問題 — editor 不再每 frame 拿到新 boxes 陣列
3. Cancel semantics 天然:清 shadowBox = 恢復原狀,不需要「reverse drag」邏輯
4. Boxes state 的 source of truth 保持在 editor,Canvas 只是 view + interaction layer

**副作用**:Canvas 有兩個渲染 path(shadowBox active / inactive),reader 要記得 `displayBoxes` 是 derived state 而非原 `boxes` prop。文件化在 Canvas 檔頭 comment。

**架構意涵**:這個 pattern 可通用於任何「drag-to-edit 需要 cancel/undo 語意」的 UI — 圖表拖點、時間軸裁剪、色彩滑桿等。關鍵是 commit-on-release + cancel-on-escape 成對實作。

---

### 發現 S:flushSave 的 in-flight save race 會導致資料遺失(C1 critical)

**問題**:最終 code reviewer 抓到 C1 critical bug(commit `cb67386`)。`doSave` 原本在 `saveInFlight.current === true` 時直接 `return true` + `pendingDirty.current = true`(但 pendingDirty 從未被讀取,是 dead code)。race scenario:

```
t=0   user 編輯 A
t=2s  debounce 觸發 → doSave 開始 PATCH A (saveInFlight=true)
t=3s  user 編輯 B(前 save 還在 in-flight)
t=4s  user 按 →
      → flushSave() → doSave() → saveInFlight=true → return true(立即回傳)
      → caller router.push(next) 以為成功 navigate 走了
      → 但 B 從未被 PATCH → silent data loss
```

**原因**:`doSave` 在 in-flight 時 short-circuit return true 是為了避免兩個 save race,但這個 short-circuit 假設「in-flight 的 save 內容 = 要保存的內容」,實際上 B 是在 A save 開始之後才產生的 *newer* state,A 的 save 不會救 B。

**解決方案**:改為 **promise coalescing 模式**。
```ts
const inFlightSave = useRef<Promise<boolean> | null>(null);

async function doSave(): Promise<boolean> {
  // 若有 in-flight save,先等它完成(讓舊 save 走完)
  if (inFlightSave.current) {
    await inFlightSave.current;
  }
  // 然後啟動新 save,用最新的 boxesRef.current / updatedAtRef.current
  const promise = (async () => { ... PATCH with fresh snapshot ... })();
  inFlightSave.current = promise;
  try {
    return await promise;
  } finally {
    if (inFlightSave.current === promise) inFlightSave.current = null;
  }
}
```

這樣 B 保證會被 PATCH:flushSave → await inFlightSave(A 的 save)→ 然後用最新 boxesRef 跑新 PATCH(內容 = B)。

**相關修法(同 commit)**:
- I1:unused `undoStack` binding — `const [undoStack, setUndoStack] = useState<Box[][]>([])` 但 `undoStack` 從未被讀取 → 改成 `useRef<Box[][]>([])` 消除 unused binding
- I2:`setUndoStack` updater 裡的副作用 — 原本 `setUndoStack(prev => { const next = pushUndo(prev, oldBoxes); setBoxes(newBoxes); return next; })` 在 updater 裡 call setBoxes,違反 React 19 reducer purity(Strict Mode 可能重複調用 updater → setBoxes 重複呼叫)。改成 ref-based 讀寫 undoStackRef,setBoxes 直接在 event handler 裡呼叫,不在 reducer updater 裡

**選擇理由**:
1. Promise coalescing 是並發控制的 standard pattern(常見於 fetch dedup、lazy init、DB connection pooling),對讀者友好
2. `pendingDirty` ref 是 scaffolding for 未來,但從未實作 → YAGNI violation + 造成真的 bug。刪掉比保留安全
3. Refs 本來就適合「event handlers 之間 shared 但不觸發 render 的值」,undoStack 符合這個 profile — 驅動 Ctrl+Z 行為但不直接渲染 UI
4. React 19 Strict Mode 對 reducer purity 嚴格,越早清理這類 updater 副作用越好,避免未來升版撞雷

**學到**:
- `return true` 在 short-circuit 裡要特別小心 — 「return true」意思不是「操作成功了」,是「我不做,交給下個人」。這種語意 drift 很容易 mask race
- Code reviewer 的 threat modeling 很有價值 — 發現 S 的 race 是手動走 timing scenario 才抓到,功能測試抓不到

---

### 發現 T:Plan 文件裡的 test spec 數學錯誤 — subagents 實地驗算會抓到

**問題**:Task 0.1 的 fit-view test 對 1920×1080 image in 800×600 container 原本寫 `vp.zoom ≈ 600/1080`(height limit),但正確是 `800/1920`(width limit)。因為 `Math.min(800/1920, 600/1080) = Math.min(0.417, 0.556) = 0.417`,取較小的 width fit。

Task 0.2 的 box1 (y=0.5, h=0.4, natH=500) 原本寫 `y1=100, y2=300`,正確是 `y1=150, y2=350`。因為 `y1 = (0.5 - 0.4/2) × 500 = 0.3 × 500 = 150`,`y2 = (0.5 + 0.4/2) × 500 = 0.7 × 500 = 350`。

**原因**:Plan 作者(2026-04-17 session 4 的我)在寫 test spec 時心算,normalized ↔ pixel 的 `center ± half_size × dimension` 轉換容易粗心(忘記乘 dimension、忘記半徑要除 2)。Self-review 沒 catch 因為 self-review 只看邏輯對稱,沒有再算一次。

**解決方案**:Subagent implementers 在 run test 時會直接看到 test fail。一驗算就發現 expectation 數學錯,修掉 test expectation(不是修實作)。我在 session 尾聲補 commit `622fd94` 把 plan doc 也改對,避免未來讀 plan 的人看到錯資料。

**選擇理由**:
1. "Trust but verify" pattern — implementer 不盲從 spec,實際跑 math。這反映 subagent-driven-development 的 review checkpoints 是有價值的
2. 修 test 不修實作是正確方向:spec 只說「fit-view 應等比縮放到 container 內」,沒說「一定是 height-limit」。實作結果(`0.417`)才是對的

**預防措施**(未來 playbook):
- 下次寫 plan 裡的 test 先用 calculator 驗算每個 hardcoded value,特別是 normalized ↔ pixel 的轉換(center ± h/2 容易算錯)
- 在 plan spec 裡直接附上「計算步驟」而非只寫結果:`y1 = (0.5 - 0.4/2) × 500 = 150`,寫 expression 比寫結果更難寫錯,也讓 reader 能驗算
- Self-review 應該「re-derive 一次」而不是「re-read 一次」

**次要發現**:Subagent 發現 test spec 數學錯時,沒人類干預就自己改 test。這是預期且期待的自主行為 — 若 implementer 要等人類確認「是你算錯還是我算錯」,subagent-driven 就失去速度優勢。但這假設 implementer 的代數能力可靠 — 若是更複雜數學(矩陣、微積分),可能需要手動 spot-check。

---

## 2026-04-17 (第 3 次 session) step-up-only authz + UI 補完期技術發現

### 發現 M：`ACTION_SCOPE` map 作為 per-action step-up 需求的 single source of truth

**問題**：先前「哪個 action 需要哪種 step-up scope」這個意圖散在約 10 個 route file 裡，每一個都寫 `requireRole(...) + stepUpOr401(..., 'admin'|'reviewer')`。要調整某 action 的 gate（例如把 annotate 提升為需 admin step-up）要改 N 個檔案,且容易漏,沒有 bird's-eye view。

**原因**：設計時用 role-based + step-up 雙閘門，每個 route 重複寫邏輯。role gate 被砍後剩 step-up gate,原本分散的結構就顯得冗餘。

**解決方案**：`lib/rbac.ts` 集中：
```ts
type StepUpScope = 'reviewer' | 'admin';
const ACTION_SCOPE: Partial<Record<Action, StepUpScope>> = {
  'admin.user.create': 'admin',
  'admin.user.list': 'admin',
  'batch.assign': 'admin',
  'batch.finalize': 'admin',
  'image.approve': 'reviewer',
  'image.reject': 'reviewer',
  'project.create': 'admin',
  'project.update': 'admin',
  'project.export': 'reviewer',
  'blob.upload': 'admin',
  // annotate/submit 不在 map 裡 — 任何 logged-in user 皆可
};

export async function requireAuthz(session, action, request) {
  if (!session?.user) throw new UnauthorizedError();
  const scope = ACTION_SCOPE[action];
  if (scope) await requireStepUp(scope, request); // 不 throw 就通過
}

export async function authzOr401(session, action, request): Promise<NextResponse | null> {
  try { await requireAuthz(session, action, request); return null; }
  catch (e) { /* map errors to 401/403 NextResponse */ }
}
```

**選擇理由**：
1. 改 gate 現在是兩行變更（map 增減一 entry + 確認 action 名稱）
2. `Partial` 而非 full Record 是故意的 — 缺席 = 「任何已登入者」。這個設計讓「無 step-up 需求」成為預設值，對應使用者想法「只有敏感操作需要密碼」
3. Reviewer 與 admin scope 明確寫在 map 裡,看一眼就知道「export 是 reviewer 行為、assign 是 admin 行為」
4. 未來若要加新 scope（例如 `super-admin`）擴充 union type 即可

**副作用**：`stepUpOr401` / `authzOr401` 回傳型別從 `Response` 收緊為 `NextResponse`,配合 Next.js App Router 的 route signature。

---

### 發現 N：next-auth `signOut` 在 server-action form 裡可零 client JS 運作

**問題**：TopNav 需要 Sign out 按鈕。若寫 client component（`'use client'` + `onClick={() => signOut()}`）整個 nav 要 hydrate,且 nav 本身無其他互動,浪費。

**解決方案**：server action inline 在 `<form>` 裡：
```tsx
<form action={async () => {
  'use server';
  const { signOut } = await import('@/lib/auth');
  await signOut({ redirectTo: '/login' });
}}>
  <button type="submit">Sign out</button>
</form>
```

**選擇理由**：
1. 對應 `/login` 頁的 signIn server-action pattern — 一致性
2. TopNav 保持 server component,session 讀取在 server 端完成,前端零 JS
3. Next.js 16 App Router 原生支援 server-action form,signOut 在 server 端完成 cookie clearing + redirect
4. 表單 POST + server action 天然帶 CSRF 保護（Next.js framework-level）

**注意**：`lib/auth.ts` 的 `signOut` 是 Auth.js v5 export,lazy import 是為了避開 Vitest 的 `next/server` 解析問題（Finding B 已記錄）。

---

### 發現 O：Next.js route handler `throw Error` 在 production 會變成空 body 500

**問題**：`finalize/route.ts` 原本所有失敗分支寫成 `throw Object.assign(new Error('classes.txt does not match'), { status: 400 })`。在 dev mode 有時錯誤訊息會漏到 response,production 卻一律變成 status 500 空 body。前端看到「finalize failed:」後面什麼都沒有,使用者無從 debug。

**原因**：Next.js App Router route handler 的 `throw` 不會被 framework 序列化成 HTTP response。`{ status: 400 }` 掛在 Error 上對 framework 沒意義,它只看是否為 `NextResponse` / `Response` return value。

**解決方案**：所有失敗分支改 `return NextResponse.json({ error: msg }, { status })` 明確回;外層包 `try { ... } catch (err) { console.error('[finalize]', batchId, status, message, err); return NextResponse.json({ error: '...' }, { status: 500 }); }` 吸未預期錯誤。Client 端 `await response.json().then(j => j.error)` 讀 detail。

**選擇理由**：
1. Next.js App Router 官方 idiom 是 return,不是 throw — 用 throw 需要外層 framework 懂得 serialize,目前沒有
2. 顯式 return 讓 status code 與 response body 的 contract 一目了然
3. 每個失敗路徑都自己負責 status,不被 framework 通用 500 吃掉
4. Server-side `console.error` 還是會記完整 error 給 Vercel logs 看,但客戶端看到的是乾淨 message

**遺留工作**：其他 route（`approve`、`reject`、`submit`、`assign` 等）仍用 `throw Object.assign(...)` pattern,下次碰到時一併遷移。沒列為立刻要做的項目,因為目前這些 route 的錯誤狀況使用者較少撞到。

---

### 發現 P：`FakeSession` / Auth.js Session 型別 drift 造成 TopNav build failure

**問題**：TopNav 要顯示使用者名字,寫 `session.user.name ?? session.user.email`。TypeScript 立刻 build fail — `FakeSession`（在 `lib/auth-test.ts`）沒有 `name` 欄位。

**原因**：
1. `lib/session.ts getSession()` 不管 env 一律 cast 成 `FakeSession`（production 裡把真 `auth()` 結果也 cast 過去,只為了讓 session consumer 統一型別）
2. 這個 cast 是為了 Vitest + next/server 相容 workaround（Finding B）— test 環境會注入 `__setFakeSession`,所以所有 session consumer 的型別都被迫符合 FakeSession
3. 真實 Auth.js session（`DefaultSession['user']`）本來就有 `name?: string | null`,但 FakeSession 沒照抄

**解決方案**：`FakeSession` 加上 optional `name?: string | null`：
```ts
type FakeSession = {
  user: {
    id: string;
    email: string;
    role: 'annotator' | 'admin' | 'final_reviewer';
    name?: string | null;
  };
};
```

**選擇理由**：
1. 真正乾淨的做法是 production 路徑不 cast 成 FakeSession,直接回 Auth.js 真 session type,FakeSession 只 test 路徑用。但這需要解掉 Vitest + next/server 的 lazy-import workaround（Finding B）,工作量大且無直接收益
2. 擴充 FakeSession 是 minimum diff,跟真 session 對齊即可,0 runtime 風險
3. 未來若有其他欄位要顯示,直接往 FakeSession 加,系統還是能跑

**副作用**：FakeSession 與真 Session 的 drift 是 latent debt,任何下次要用 session 新欄位時都要手動同步,沒有 compile-time guarantee。之後若重構 `lib/session.ts`,應優先把 production 路徑的型別還原。

---

## 2026-04-17 (第 2 次 session) 短收尾期技術發現

### 發現 L：`vercel git connect` 不寫 rootDirectory，monorepo 子目錄 Next.js 需手動透過 REST API PATCH

**問題**：repo 是 `frc-train-review/` 根，Next.js 專案在 `web/` 子目錄。先前用 `vercel deploy --prod --yes` 從 `web/` 直接跑都好好的。昨晚 `vercel git connect https://github.com/0908869905/frc-train-review.git` 把 GitHub 接上後，push master 觸發的 auto-deploy 直接失敗：
```
Skipping build cache since Package Manager changed from "pnpm" to "npm"
Error: No Next.js version detected. Make sure your package.json has "next" in
either "dependencies" or "devDependencies". Also check your Root Directory
setting matches the directory of your package.json file.
```

**原因**：
1. CLI deploy (`vercel deploy`) 從當前目錄打包 local 檔案上傳，**不讀** Vercel project 的 `rootDirectory` 設定 — 所以之前從 `web/` 跑都 OK
2. GitHub integration auto-deploy 走的是 Vercel 後端 clone repo + 按 project 設定走 build，`rootDirectory` 預設 `.`（repo root），在根目錄找不到 `package.json` 裡有 `next` dep
3. `vercel git connect` 指令本身**不會**把 CLI 當前 working directory 設為 rootDirectory，這個耦合只存在於使用者心智裡、不在 CLI 行為裡
4. 套件管理器也順便從 `pnpm` 掉成 `npm`（因為根目錄沒有 `pnpm-lock.yaml`，只有 `web/pnpm-lock.yaml`），但這是 symptom 不是 cause

**解決方案**：Vercel CLI 沒提供改 rootDirectory 的子命令（`vercel project` 只有 ls/rm/add），dashboard 手動改又繁瑣。改用 REST API：
```bash
# token from $APPDATA/com.vercel.cli/Data/auth.json  (Windows)
#      or  ~/.local/share/com.vercel.cli/auth.json    (Linux/Mac)
curl -X PATCH https://api.vercel.com/v9/projects/prj_UNhDUOxcLub8TeWzrclb3zrXyzXt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"web"}'
```
改完後 `vercel redeploy <failed-deployment-url> --target production` 成功，aliased 到 `frc-annotation.vercel.app`。

**選擇理由**：
- CLI 沒對應子命令，不是疏漏就是 Vercel 故意留給 dashboard（單次設定事件）
- Dashboard 手動要登入 → 切 team → 找 project → Settings → Build & Development → Root Directory，5+ 步驟、每次要改又得重複
- REST API 一行 curl、可自動化、可紀錄在 runbook
- `PATCH /v9/projects/{id}` 在 Vercel docs 有明列 `rootDirectory` field

**預防措施（未來 playbook）**：
- `vercel git connect` 接完 GitHub 後**立刻** `vercel project inspect <name>` 檢查 rootDirectory 欄位
- 若為 monorepo 子目錄結構，預設都要走 PATCH 設對，不要等 auto-deploy 壞掉才發現
- 可考慮把這段寫進 `vercel:bootstrap` skill 的 preflight check

---

## 2026-04-17 (Session) Step-up Auth 實作期技術發現

### 發現 I：Neon pooled + Prisma 7 + Vitest 的 FK 殘留 race

**問題**：連續跑 `pnpm test` 偶發 10 failed across 6 files，全部卡在 `user.deleteMany` 的 FK violation，但單檔跑又過。按檔名排序最前的 `admin-api-stepup.test.ts` 的 `beforeAll` cleanup 崩潰、後續檔案都被連動殘留污染。

**原因**：
1. Neon pooled connection 的 transaction boundary 與 Prisma 7 搭配時，前一輪若 worker crash，AuditLog 的 row 會**跨 process 殘留**（不會被 session-level rollback）
2. Vitest 即使設 `fileParallelism: false`（已在 M7.7 設定），檔案間的 `beforeAll` 還是序列跑；第一個檔崩、第二個檔的 cleanup 看到的 state 是 broken 前一輪的殘渣
3. AuditLog → User 的 FK 讓 `user.deleteMany` 必須先清 auditLog，但已有邏輯做這件事的前提是「本輪 test 進去前 auditLog 是乾淨的」

**解決方案**：新增 `web/tests/helpers/clean-db.sql` 手動 reset：
```sql
TRUNCATE TABLE "AuditLog", "Annotation", "Image", "Batch",
  "AnnotationClass", "Project", "EmailWhitelist", "User", "Account", "Session"
  RESTART IDENTITY CASCADE;
```
執行：`pnpm dlx dotenv-cli -e .env -- prisma db execute --file tests/helpers/clean-db.sql`

**選擇理由**：
- 不需要架 test DB 容器（dev 環境單人用 Neon 夠）
- `TRUNCATE CASCADE` 比逐表 `deleteMany` 快、不受 FK 順序限制
- 當成 incident 補救工具而非每輪必跑（會拖慢），只在 FK 殘留症狀出現時手動跑一次

**後續 backlog**：若此症狀反覆出現，應該在 `globalSetup` 掛一個 "TRUNCATE on first-time setup" 的 hook，而非手動介入。

---

### 發現 J：`stepUpOr401` helper pattern — 省掉 route handler 的 try/catch 重複

**問題**：P4/P5 三個 route（`GET /api/admin/users`、`POST /api/admin/users`、`POST /api/batches/[id]/assign`、`POST /api/projects/[id]/export`）都要做同一件事：
```ts
try {
  await requireStepUp('admin', request); // 或 'reviewer'
} catch (e) {
  if (e instanceof StepUpRequiredError) return Response.json({ error: 'step_up_required' }, { status: 403 });
  if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
  throw e;
}
```
每個 route 重複一樣的 20 行 error-mapping。

**原因**：
- `requireStepUp` 設計成 throw 而非回傳，為了搭配深層 helper 自然 bubble up（避免 route handler 每層都要記得 early return）
- 但 Next.js route handler 必須回 `Response`，所以 throw → catch → return response 的 mapping 不可免
- 三種 Error type（`StepUpRequiredError` / `UnauthorizedError` / 其他）的 status code mapping 完全相同，但 TypeScript 不會逼你收斂

**解決方案**：`lib/rbac.ts` 抽 `stepUpOr401(session, scope, request): Response | null`：
```ts
export async function stepUpOr401(
  session: Session | null,
  scope: 'reviewer' | 'admin',
  request: Request
): Promise<Response | null> {
  if (!session?.user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    await requireStepUp(scope, request);
    return null; // 通過
  } catch (e) {
    if (e instanceof StepUpRequiredError) return Response.json({ error: 'step_up_required' }, { status: 403 });
    if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: e.status });
    throw e;
  }
}
```

Route handler 變成：
```ts
const gate = await stepUpOr401(session, 'admin', request);
if (gate) return gate;
// ... happy path
```

**選擇理由**：
- 把「null = 繼續、Response = early return」這個 pattern 定成規則，reader 一看 `if (gate) return gate;` 就懂
- 型別幫忙：回 `Response | null`，忘記 return 就 TypeScript 警告（`Response` 被丟掉）
- 集中處理 status mapping，未來若要加新 error type 只改一處
- 比起把 `requireStepUp` 改成回傳 `Response | null`，此 helper 保留原 throw 語義給深層 util 用（step-up guard component 也要用 throw 流程）

**相關 helper**：`readStepUpCookie(request, scope)`（`lib/stepup.ts`）— route GET handler 要讀 cookie 驗 HMAC 回傳狀態，而 `requireStepUp` 讀同一個 cookie 要強制擋，兩邊 cookie-parsing 邏輯抽出共用，避免 future drift。

---

### 發現 K：`hasDisplayName` JWT claim + proxy gate — avoid DB hit on every request

**問題**：onboarding gate（強制首次登入者填中文姓名）最直覺的寫法是 proxy 每個 request 去 DB 查 `User.displayNameSetAt != null`，但這會讓每個 protected page load 都多一次 DB round-trip。

**解決方案**：在 `lib/auth.ts` 的 `jwt` callback 把 `displayNameSetAt != null` 壓成 boolean claim 塞進 JWT：
```ts
// auth.ts
callbacks: {
  async jwt({ token, user, trigger }) {
    if (user || trigger === 'update') {
      // 從 DB 讀一次
      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub! },
        select: { displayNameSetAt: true, role: true },
      });
      token.hasDisplayName = dbUser?.displayNameSetAt != null;
      token.role = dbUser?.role;
    }
    return token;
  },
}
```

Proxy 讀 JWT token 直接看 claim，不碰 DB：
```ts
// proxy.ts
if (token && !token.hasDisplayName && !isOnboardingPath) {
  return NextResponse.redirect(new URL('/onboarding/name', request.url));
}
```

使用者填完姓名 → `PATCH /api/me/display-name` → client `useSession().update()` → jwt callback 的 `trigger === 'update'` 重拉 DB → token 翻新 → 下次 request proxy 放行。

**選擇理由**：
- 讓 session lifecycle 的「讀 DB 一次」事件變成 login 時 + update() 時，不是 every-request
- JWT 本來就要解 cookie 做 verify，claim 是 free lunch
- `trigger === 'update'` 是 Auth.js v5 規定的 hook point，client `update()` 會觸發 jwt callback 重跑，比自己寫 stale detection 清爽

---

## 2026-04-16 (第 4 次 session) M1-M7 實作中踩到的新發現

### 發現 A：Prisma 7 `new PrismaClient()` 直接 new 會 runtime error

**問題**：`new PrismaClient({ log: ['query'] })` 啟動時噴 `driverAdapter or accelerateUrl required`。

**原因**：Prisma 7 把「直接吃 connection string」這條路砍掉，強制要用 driver adapter 或 Accelerate。

**解決方案**：`lib/db.ts` 改用 `PrismaNeon` adapter：
```ts
import { PrismaNeon } from '@prisma/adapter-neon';
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });
```

**選擇理由**：我們已經是 Neon，原生 `@prisma/adapter-neon` 就是為此情境設計；Accelerate 是付費 SaaS，免了。

---

### 發現 B：Vitest + next-auth 載入鏈會去解析 `next/server`，integration test 直接炸

**問題**：`auth()`（from Auth.js v5）引用 `next/server`；vitest 在 node 環境 import 時會拋 "Cannot find module 'next/server'"。

**原因**：Auth.js v5 的 `auth()` 入口在 runtime 才用得到 Next 伺服端 API，但 Vitest 的 static import 會一次解析整條依賴圖。

**解決方案**：在 `lib/session.ts` 用 **lazy import**：
```ts
export async function getSession() {
  const { auth } = await import('./auth'); // 延後到呼叫時才解析
  return auth();
}
```
另外加 `lib/auth-test.ts`：`NODE_ENV === 'test'` 時以 header 注入 fake session，避免測試還要經過真實 OAuth。

**選擇理由**：不改 Auth.js source、不 mock 整包 next；lazy import 是最小切面。

---

### 發現 C：Next.js 16 `middleware.ts` → `proxy.ts` 改名（既有 FINDINGS 已提，此處補實戰結果）

**實戰結果**：M1.2 採用 `proxy.ts`（非 `middleware.ts`），走 nodejs runtime 足以跑 JWT 驗證；`matcher` 設定維持不變，未踩到雷。

---

### 發現 D：Vercel Blob v2 `put()` 不再接 raw `Uint8Array`

**問題**：`put(pathname, uint8Array, opts)` 在 v2 直接 runtime error "Body must be Blob | ReadableStream | string | ArrayBuffer | File"。

**原因**：`@vercel/blob` v2 收緊 `PutBody` type，拿掉對 raw `Uint8Array` 的隱式轉換。

**解決方案**：用 `new Blob([uint8Array])` 包起來再丟：
```ts
await put(pathname, new Blob([bytes]), { access: 'public', token });
```

**選擇理由**：官方 migration note 就是這招；不動架構、一行修完。

---

### 發現 E：Zod v4 API 搬家 — `z.email()` / `z.url()` / `z.iso.datetime()` 取代 v3 的 `.string().email()` 等

**問題**：原本寫 `z.string().email()` / `z.string().url()` / `z.string().datetime()` 在 zod v4 會 TypeScript 警告 deprecated，部分情境直接 runtime 失效。

**原因**：Zod v4 把這些 string sub-schema 升格為 top-level factory。

**解決方案**：
```ts
z.email()              // was z.string().email()
z.url()                // was z.string().url()
z.iso.datetime()       // was z.string().datetime()
```

**選擇理由**：遵循 v4 官方 API；整個 `/api/**` route 一次掃過全部改掉，避免混寫。

---

### 發現 F：Vercel Blob upload 需 `allowOverwrite: true` 否則重試失敗

**問題**：M3.5 finalize 若中途失敗、使用者重新上傳同 batch，第二次 `putImage` 會 "blob already exists"。

**解決方案**：`allowOverwrite: true` 於 `putImage()`，配合 `batchId/filename` 穩定 key 即可安全 replay。

---

### 發現 G：Vitest 並行跑 integration test，Prisma 會 race 在同一個 Neon DB

**問題**：多個 spec 同時 `deleteMany`/`create` 對同幾張表，偶發 FK 違反 / 資料互相看得見。

**解決方案**：`vitest.config.ts` 加 `fileParallelism: false`；另外 teardown 順序要先 `auditLog.deleteMany()` 再 `user.deleteMany()`（audit 指回 user 有 FK）。

**選擇理由**：整個專案 integration test 只有 ~20 個，不並行也快；比起另外架 test DB 成本低。

---

## 2026-04-16 Next.js 16 升級應對（原 plan 寫 Next.js 15）

**問題**：`pnpm create next-app@latest web` 裝到 Next.js **16.2.4 + React 19.2.4**，而 2026-04-15 寫的 plan 鎖定 Next.js 15。Next.js 自帶 `web/AGENTS.md` 警告「APIs, conventions and file structure may differ from your training data」。

**原因**：plan 撰寫時（2026-04-15）Next.js 16 已釋出但 plan 作者假設 v15；`create-next-app@latest` 不 pin 版本會自動取最新 major。

**決策**：**擁抱 Next.js 16**（不降版）。理由：
1. v16 是穩定 release，非 beta/canary
2. Vercel 原生支援最新 Next.js；若降版未來還是要升
3. Breaking changes 可量化列出，不是無底洞

### 關鍵 Breaking Changes 與 plan 影響

| 項目 | v15 → v16 變化 | plan 影響 |
|---|---|---|
| **Turbopack** | 改為預設（`next dev` / `next build`） | M0.1 指令 `--no-turbopack` 已廢止（被 create-next-app 忽略）；package.json scripts 不需 `--turbopack` flag。**無需修改** |
| **async Request APIs** | `cookies()`、`headers()`、`draftMode()`、`params`、`searchParams` 全部必須 `await` | 所有 M2+ page.tsx / API route 必須用 `async function Page(props) { const { id } = await props.params }`。**已融入 plan adjustments** |
| **type helpers** | 新增 `PageProps<'/path'>` / `LayoutProps` / `RouteContext` via `npx next typegen` | 建議採用（更 type-safe）。**已加入 M0.6 後備選項** |
| **middleware → proxy** | `middleware.ts` 仍可用但 edge runtime 專用；若不需 edge，可改名 `proxy.ts`（僅 nodejs） | M1.2：**保留 `middleware.ts`** 以享用 edge runtime（auth.js JWT 驗證夠用） |
| **next lint 移除** | `next build` 不再自動跑 lint；用 `eslint` CLI 直接跑 | Scaffolding 已設 `"lint": "eslint"` ✓；M0.6 CI 直接呼叫 `pnpm lint` |
| **ESLint Flat Config** | 預設 flat config | Scaffolding 已用 `eslint.config.mjs` ✓ |
| **revalidateTag** | 需第二參數 `cacheLife` profile（如 `'max'`） | plan 用到的地方極少；若用 `revalidateTag('x')` 改為 `revalidateTag('x', 'max')` |
| **cacheLife/cacheTag** | 移除 `unstable_` 前綴 | 直接 `import { cacheLife, cacheTag } from 'next/cache'` |
| **React Compiler** | 1.0 穩定（opt-in） | 不啟用（plan 未規劃） |
| **Node 要求** | ≥ 20.9.0 | 目前 Node 24.11.1 ✓ |
| **serverRuntimeConfig 移除** | 改用 env vars | plan 本就用 env vars ✓ |
| **images.domains 移除** | 改 `images.remotePatterns` | 將 Vercel Blob URL 加進 `remotePatterns` |

### 決策

- **不降版**，全專案使用 Next.js 16.2.4 + React 19.2.4
- plan 已加入 "Next.js 16 Adjustments" 區塊（top of plan），列出針對性修訂
- 後續每個 subagent 在 prompt 中明確注入這些 breaking-change 規則，避免它基於 v15 訓練資料寫 code
- `web/AGENTS.md`（create-next-app 自動產生的警告檔）不刪除，保留給未來 AI 協作者看

### 參考文件

- Local：`web/node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`（1238 行）
- Local：`web/node_modules/next/dist/docs/01-app/02-guides/upgrading/version-15.md`
- Codemod：`pnpm dlx @next/codemod@canary upgrade latest`（不需跑，我們 scaffolding 已在 v16）

---

## 2026-04-15 Annotation Review Platform 技術決策

### 決策 1：Next.js 15 App Router 全端 vs FastAPI 分離後端

**問題**：新的審核/訓練 web 平台要採用什麼架構？純前端 (Supabase)、前後端分離 (Next.js + FastAPI)、還是 Next.js 全端？

**原因**：
- 團隊只有 16+ 人內部使用，規模不大但要撐 canvas editor、直傳大檔案、auth 白名單、批次匯入、YOLO 匯出等多種場景
- 雲端 PaaS 部署（Vercel）、低維運成本是硬需求
- 需要 server-side 權限檢查（white-list + assignment 模型），不能只靠前端

**候選方案**：
1. **Supabase + 純前端**：快，但 row-level security 要寫得很精細，批次 upload/export 邏輯塞進 RLS 很痛苦
2. **Next.js 前端 + FastAPI 後端**：後端用 Python 能跟既有 pipeline 共用，但要維護兩個服務、兩套部署、兩套 CORS、兩套型別同步
3. **Next.js 15 App Router 全端（Server Actions + Route Handlers）**：一個 repo、一個部署、TypeScript end-to-end、Vercel 原生支援

**解決方案**：選擇方案 3（Next.js 15 App Router 全端）。

**選擇理由**：
- Vercel PaaS 對 Next.js 有最佳整合（Blob store、Auth.js、Edge runtime、Neon connector 都是 zero-config）
- 16 人的規模不需要獨立 Python 服務，Gemini 批次標註是**外部 offline pipeline**（不接 web 平台），所以後端不需要重 ML 依賴
- 訓練本身依然在 Python 側（`train_robot_model.py` 不動），web 平台只負責**審核 + 匯出 YOLO dataset.zip**，後端不需要呼叫 PyTorch
- 選 Next.js 全端避免「前後端型別漂移」這個最常見的維護痛點
- 未來若要加訓練觸發，可以 Route Handler → Vercel Queue → Python worker，加法式擴充，不需重寫

---

### 決策 2：YOLO 原生格式 end-to-end 零轉換

**問題**：資料在平台內部應該用什麼格式儲存？COCO JSON? Pascal VOC XML? 自訂 schema? YOLO txt?

**原因**：
- 最終產物**只匯出 YOLO**（要餵 ultralytics 訓練）
- Gemini 批次標註的中介格式是我們可控的（同一個 pipeline 自己產生）
- Canvas editor 需要快速 load/save，不想每次轉格式
- 想避免「格式膨脹稅」：同一份資料存三種格式、每次改 schema 要改三個地方

**候選方案**：
1. **COCO JSON 為 source of truth**：業界標準、metadata 豐富，但檔案大、每張圖多次讀取整個 JSON 沒效率
2. **Pascal VOC XML**：每張圖一個檔案容易管理，但舊、YOLO 匯出還是要轉
3. **自訂 Prisma schema + 匯出時生成 YOLO**：彈性最大，但每次 schema 改動要重跑 migration
4. **YOLO 原生（每張圖一個 .txt，class id + cx cy w h normalized）end-to-end**：資料庫只存 metadata + 參照，實際 bbox 檔直接用 YOLO txt

**解決方案**：選擇方案 4（YOLO 原生 end-to-end），Prisma 只存 metadata，bbox 直接存 YOLO txt 檔在 Vercel Blob。

**選擇理由**：
- 唯一輸出是 YOLO，中間不經任何轉換 = 零轉換成本 = 零轉換 bug
- Canvas editor load 一張圖只要讀一個 .txt（幾 KB），不用 parse 整包 COCO
- 匯出時只要 zip `images/` + `labels/` + 生成 `data.yaml`，邏輯極簡
- Prisma schema 只存：image metadata（path, width, height, status）+ assignment + review history，**bbox 不進 DB**
- 代價：metadata（如 attribute、rotation）表達力較弱 → 我們的 use case 只需要 class + bbox，不需要複雜 metadata
- 若未來要支援 segmentation / keypoint，YOLO 也有對應格式，不需換底層

---

## 2026-04-15 專案初始化

### 技術選型（Python training pipeline 側）
- **模型框架**：ultralytics YOLO（訓練）、onnxruntime（推論）
- **資料集來源**：Roboflow Universe（預設 main-wcgiu/robot-detection-xru6m v16）+ 本地影片取幀
- **取幀工具**：自製 extract_frames.py（OpenCV）
- **輸出格式**：ONNX（models/frc_robot.onnx）方便跨平台推論

---

## 2026-04-16 (第 5 次 session) Step-up auth 規劃期技術發現

### 發現 H：Auth.js v5 `unstable_update()` 不適合 server-initiated session update

**問題**：規劃 reviewer/admin step-up password 時，第一版 design spec 打算把「已通過密碼」這個狀態塞進 Auth.js v5 的 session，用 `unstable_update({ stepUp: { reviewer: true, grantedAt: ... } })` 在 POST `/api/auth/stepup` 成功後更新 JWT。

**原因**：
1. `unstable_update()` 顧名思義是 unstable API — 文件明說行為可能變、且 Auth.js 團隊設計意圖是**從 client 端**觸發（如使用者改 profile 後前端呼叫 `useSession().update()`），不是 server route handler 主動塞 state。
2. 實際行為：`unstable_update()` 在 server route 呼叫後，JWT 不會當場 rotate，而是等下一次 request 才被 `jwt` callback 讀到，中間存在 race window（使用者立刻發下一個 request 但 JWT 還沒更新）。
3. 把 step-up 狀態放進 JWT 還會讓 JWT payload 膨脹，每個 protected request 都要帶，且「撤銷 step-up」需要再呼叫一次 update，邏輯對稱性差。

**解決方案**：**改用獨立的 HMAC-signed httpOnly cookie** 做 step-up token，完全與 Auth.js JWT 解耦。
- Cookie name：`stepup_reviewer` / `stepup_admin`
- Cookie payload：`{ userId, scope, exp }` 用 `STEPUP_COOKIE_SECRET` 做 HMAC-SHA256 簽章
- Cookie attrs：`HttpOnly; Secure; SameSite=Lax; Max-Age=3600; Path=/`
- 驗證流程：`requireStepUp(scope)` middleware 讀 cookie → 驗 HMAC → 驗 `userId` 對應當前 session.user.id（防 session fixation：即使偷到 cookie，換 Google 帳號登入也用不了）→ 驗 `exp`
- 撤銷流程：`Max-Age=0` 覆蓋即可，不需動 JWT
- Dev 降級：`STEPUP_COOKIE_SECRET` 未設時用固定 dev-only secret + log warning（避免本地開發被擋）

**選擇理由**：
1. 不依賴 unstable API — HMAC cookie 是 Web 標準機制，Next.js 16 `cookies()` API 直接支援
2. Server 主動寫入是 first-class use case，不受 `unstable_update()` 的 client-triggered 設計限制
3. 綁 userId 防 session fixation 是 Auth.js JWT 原生做不到的（JWT 裡放 step-up 跟 JWT 本身綁定，無法單獨撤銷）
4. 撤銷對稱（寫 cookie = 授權、刪 cookie = 撤銷），比「再 update 一次 JWT 翻 flag」乾淨
5. 跟既有 rate-limit / audit log 機制正交，可獨立測試

**參考**：design spec 的 § 3（Step-up Auth Mechanism）詳列完整 threat model 與 cookie spec。

---

## 2026-04-18（下午，第 2 次）auto-annotation pipeline 實戰期技術發現

### 發現 EE：OpenCV `cv2.imwrite` / `cv2.imread` / `cv2.VideoCapture` 在 Windows 非 ASCII 路徑的行為嚴重不一致

**問題**：Stage 2 抽幀跑完後，中文 owner 資料夾（隊員F / 隊員H / 隊員D / 隊員J）的 `processed/{owner}/images/` 是空的，但 `preprocess_state.json` 顯示「已處理 N 張」。ASCII 路徑（Anna）完全正常。

**原因**：OpenCV (opencv-python 4.x on Windows) 內部對不同 IO 路徑用不同實作：
| 函式 | 路徑處理 | 非 ASCII 路徑行為 |
|---|---|---|
| `cv2.VideoCapture(path)` | 走 FFmpeg backend，FFmpeg 有 Unicode path 支援 | **正常工作** |
| `cv2.imwrite(path, frame)` | 走 C-stdio (`fopen`)，Windows `fopen` 只吃 ANSI code page | **silently 失敗**（回傳 False，不拋例外，不 log） |
| `cv2.imread(path)` | 同上 | **silently 回 None** |

這組合毒在「讀影片成功 → 抽出 N 張 frame → 寫每張 frame 通通回 False → 迴圈繼續跑 → 最後寫 state file 說完成了 N 張 → disk 上 0 個檔案」。沒人檢查 `imwrite` 的回傳值（慣性上當 None 拋例外用），所以錯誤靜悄悄累積。

**解決方案**：所有 cv2 file IO 改走 bytes-in-memory pattern，繞過 C-stdio：
```python
# Write:
ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
assert ok
Path(out_path).write_bytes(buf.tobytes())

# Read:
import numpy as np
data = np.fromfile(in_path, dtype=np.uint8)  # Python open() handles Unicode fine
img = cv2.imdecode(data, cv2.IMREAD_COLOR)
```
`np.fromfile` / `Path.write_bytes` 走 Python 的 CPython IO，在 Windows 用 Wide-API (`CreateFileW`)，Unicode path 正常。

**選擇理由**：
1. 不裝額外套件（不用 `imageio` / `PIL` 替代所有 cv2）— 既有 pipeline 對 cv2 operations (resize / color conversion) 還是依賴，只有 file IO 邊界需要繞過
2. `encode/decode + Path` 是 cv2 官方 FAQ 建議的 Windows Unicode workaround
3. **Detection pattern**：以後凡「cv2 寫檔完但檔案沒出現 / 讀檔回 None」第一反應檢查 path 是否含非 ASCII。ALSO: 可以加 `assert ok, f"imwrite failed for {path}"` 作為 tripwire
4. `VideoCapture` 沒事不代表 `imwrite` 沒事 — 同一程式的不同 cv2 call 會有不同行為，不要用單一 case 推論整個 module 的 Unicode 支援

**遺留**：`auto_pipeline.py` 已全面改掉（extract_frames_1fps + cmd_preview 讀寫）。若未來新增其他 cv2 IO call，同樣 pattern 必套。

---

### 發現 FF：Gemini API key 與 Google OAuth 2.0 access token 的辨識 — 字首 / 字元集 / 用途全不同

**問題**：使用者看 Gemini API 文件看到「API key」字樣，手邊又有 Google SSO OAuth access token，誤把 `AQ.Ab8RN6KI...` 當成 API key export 給 `auto_pipeline.py`，每個 request 回 HTTP 400 `API_KEY_INVALID`。

**原因 / 辨識規則**：

| 項目 | Gemini API key | Google OAuth 2.0 access token |
|---|---|---|
| 字首 | `AIzaSy` | `ya29.` 或 `AQ.` |
| 字元集 | `[A-Za-z0-9_-]` | `[A-Za-z0-9._~+/=-]`（含 `.` 可多段） |
| 長度 | 固定 39 chars | 不固定（通常 100+ chars） |
| 產生方式 | https://aistudio.google.com/app/apikey → "Create API key" | OAuth 流程回傳、`gcloud auth print-access-token` 等 |
| 用於 | `?key=<API_KEY>` query param 或 `x-goog-api-key` header | `Authorization: Bearer <TOKEN>` header |
| 權限模型 | 綁單一 API（Gemini API），不綁使用者 | 綁使用者 + scopes |
| 過期 | 不會 | 通常 1 小時 |

**解決方案**：`auto_pipeline.py` 讀取 key 時加字首檢查 + 長度檢查 tripwire：
```python
key = os.environ.get("GEMINI_API_KEY", "")
if not key.startswith("AIzaSy") or len(key) != 39:
    raise SystemExit(
        f"GEMINI_API_KEY looks malformed (startswith='{key[:7]}', len={len(key)}). "
        "Expected 'AIzaSy' + 33 chars. Generate at https://aistudio.google.com/app/apikey"
    )
```
（目前還沒加進 pipeline，但建議下次手癢改 pipeline 時順手加）

**選擇理由**：
1. API 錯誤訊息 `API_KEY_INVALID` 不指出是 format 錯、revoked、還是其他 — 本地檢查字首能給更好的 developer UX
2. OAuth access token 看起來很長很像 key，純看 entropy 容易誤判
3. 這個 developer trap 不只本專案會踩，未來寫任何用 Gemini API 的 script 都可以套用

**遺留**：使用者習慣先從 `gcloud auth` / `oauth2l` 拿 token 測 API，這類 workflow 常混淆。建議在 onboarding doc 明確寫「如果你看到 token 不是 `AIzaSy` 開頭，你拿錯東西了」。

---

### 發現 GG：JPEG 放進 zip 的壓縮策略 — `ZIP_STORED` 勝過 `ZIP_DEFLATED`

**問題**：Stage 4 package 一開始用 `ZIP_DEFLATED` 打包 JPEG，結果 batch.zip 大小 ≈ raw JPEG bytes 總和（壓縮率 0-6%），deflate CPU 白燒。

**原因**：JPEG 本身已經是高度壓縮格式（DCT + Huffman coding），剩餘的 redundancy 極低：
- JPEG file header (APPn markers / quantization table / Huffman table) 約占 1-2 KB / 檔，deflate 可略壓這部分
- JPEG payload（entropy-coded 係數）已接近熵極限，deflate 壓不動
- 實測 2538 張 JPEG：raw 總和 ≈ 1.8 GB，deflate 後 ≈ 1.7 GB（6% 省），CPU 多燒 ~30-60 秒

對比 PNG / BMP / raw pixel array：deflate 壓縮率常達 30-70%，此時 DEFLATED 才值得。

**解決方案**：`zipfile.ZipFile(..., compression=zipfile.ZIP_STORED)`。跳過 deflate 階段，純 concatenate bytes + 記 entry offset。

**取捨對照**：
| 場景 | 建議 compression |
|---|---|
| JPEG / PNG / GZIP / ZIP 內含物（already compressed） | `ZIP_STORED` |
| JSON / CSV / SQL dump / 純文字 label | `ZIP_DEFLATED` |
| 混合內容（如 YOLO batch：images + labels + classes.txt） | `ZIP_STORED` 主導 — 圖檔體積吃 >99%，labels/classes 小到壓不壓無感 |

**選擇理由**：
1. 本專案每 batch ~200 MB 的 99.9% 都是 JPEG bytes，deflate 毫無收益
2. 使用者在手動上傳 batch 時時間敏感（人在 UI 上等），少 30-60s CPU = 少等 30-60s 開 zip
3. 未來若加入 HEIC → JPEG 外的其他格式（例如 raw PNG），package stage 應該根據 content 自動選 — 但目前格式穩定，先單一策略即可

**遺留**：若 batch 改裝 DNG / NEF / raw pixel npy，策略要重新評估。目前 notyet 裡全是 JPEG，不會有問題。

---

### 發現 HH：YOLO batch zip 的 size cap 應該 base on **compressed** limit，不是 uncompressed

**問題**：Stage 4 第一次打包出 8 個 batch，7 個超 200 MB（219 MB–471 MB），web 上傳 API 一律 reject。原 code 用 `MAX_UNCOMPRESSED_BYTES * 0.9 = 450 MB` 作為 split cap。

**原因**：`web/lib/zip-validator.ts` 定義兩個獨立 cap：
```ts
MAX_COMPRESSED_BYTES = 200 * 1024 * 1024    // 200 MB — zip 檔本體大小限制
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024  // 500 MB — 所有 entry 解壓後總和限制
```
Web 的 finalize 會先檢查 zip 檔本體 size（透過 blob `size` field），超過 200 MB 直接 reject，根本不解壓。所以 uncompressed cap 只是「解壓後再抓 zip bomb」的第二道防線，不是主要 cap。

Pipeline 原本的切 batch 邏輯：累積原始圖片 size 到 450 MB 就切一個 batch。配合 JPEG 壓不動（見發現 GG），zip 最終 size ≈ raw size ≈ 450 MB → 直接撞 200 MB cap。

**解決方案**：改成根據 compressed cap 估算上限：
```python
cap_bytes = int(MAX_COMPRESSED_BYTES * 0.9)  # = 180 MB，留 10% buffer
```
而且改 `ZIP_STORED` 後 compressed ≈ uncompressed，`cap_bytes` 可直接用 raw size 累加估算。實測產出 16 batches，每個 ≤ 188.8 MB，全部 pass web 驗證。

**選擇理由**：
1. **Single source of truth**：web 的 compressed cap 是真正 gatekeeper，pipeline 估算應該對齊這條線，不是另一條
2. **10% buffer 保守但合理**：zip central directory / file headers / name encoding 會讓實際 zip 比 raw entry 多 ~1-2%，加上切 batch 的離散誤差（最後一張超大時可能剛好跨界），10% 夠吸收
3. **不動 web 端限制**：web 的 `MAX_COMPRESSED_BYTES = 200 MB` 是整個平台的設計限制（Vercel Blob / Postgres 的 row size / client 下載 UX 綜合考量），改這個要動整個 upload pipeline。Pipeline 側 adapt 成本低得多

**教訓**：有兩個 cap 時，先查哪個 cap 會先拒絕你。web 的 finalize 順序是 `blob.size → unzip → entry count → per-entry size → uncompressed sum`，第一關就掛的話後面 cap 都不會被檢查到，pipeline 卻錯誤假設最後的 cap 是瓶頸 → split 策略錯方向。

**遺留**：若未來 web 提升 `MAX_COMPRESSED_BYTES`，pipeline 的 `cap_bytes = 180 MB` 要同步抬。考慮把 `MAX_COMPRESSED_BYTES` 暴露成 config（例如從 web 端 API `/api/config/limits` 讀），而不是 pipeline 端硬編。目前硬編可接受因為限制值不常變。

---
