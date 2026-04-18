# Gemini 3.1 Pro vs Flash Lite Annotation Compare

Date: 2026-04-18
Status: Design approved, ready for implementation plan

## 1. 目標

目視評估 `gemini-3.1-pro-preview` vs `gemini-3.1-flash-lite-preview` 在高密度 FRC 2026 REBUILT 場景（多 bumper + 多 fuel）下的標註差異，幫助決策 prod `auto_pipeline.py` 是否值得升級到 Pro（10x 單價）。

不是 benchmark。不算 IoU / precision / recall。不做自動裁判。純肉眼 side-by-side。

## 2. 範圍

- **In scope:** 新增獨立 Python 腳本 `compare_pro_vs_lite.py`，產出 6 張雙面板對比 PNG + console summary table。
- **Out of scope:** 修改 `auto_pipeline.py`、量化 metrics、自動判斷孰優、HTML 互動頁面、把結果餵回 prod labels。

## 3. 架構

### 3.1 不碰 prod pipeline
獨立腳本，與 `auto_pipeline.py` 解耦，但**重用** prompt / response schema / API init / bbox 繪圖 helper（透過 `from auto_pipeline import ...`），避免 prompt 分叉造成對比失真。

### 3.2 目錄輸出
```
datasets/_compare_pro_vs_lite/
├── manifest.json            # 挑圖決策紀錄（filename + counts + source batch）
├── images/                  # 6 張原圖 copy（reproduce 用）
├── labels_pro/              # Pro 產出的 YOLO labels（*.txt）
├── labels_lite/             # Lite 產出的 YOLO labels（*.txt）
└── compare_<stem>.png × 6   # 雙面板對比圖
```

## 4. 流程

### Step 1: 挑圖（從已標 labels 篩）
- 讀 `datasets/frc-vision-notyet/labels/**/*.txt`
- 對每張計算 (red_robot, blue_robot, fuel) 數量
- 篩選條件：`red + blue ≥ 4 且 fuel ≥ 10`
- 依 fuel 數降序，取 top 6
- Fallback：若不足 6 張，降門檻為 `red + blue ≥ 3 且 fuel ≥ 5` 再試
- Fallback 2：仍不足則顯示實際分佈直方圖，由使用者手動調整門檻
- 把 6 張原圖 copy 到 `datasets/_compare_pro_vs_lite/images/`
- 寫 `manifest.json` 記錄：每張的 source path / 原 Lite labels 的 counts / 篩選條件

### Step 2: 雙模型並行跑
- `asyncio.gather` 對 6 張 × 2 模型 = 12 calls 並行（沿用 `auto_pipeline.py` 的 `DEFAULT_CONCURRENCY=10` 邏輯）
- 兩模型使用**完全相同** prompt、response schema、temperature
- 429 rate limit：重試 3 次、指數 backoff
- 單張失敗：console 標紅、該張對比圖改畫「Pro API failed」文字，其他張照跑
- 結果存 `labels_pro/<stem>.txt` 和 `labels_lite/<stem>.txt`（YOLO format）

### Step 3: 畫雙面板 PNG
對每張 raw image：
- Load 原圖
- Copy 兩份，分別套 Pro labels 和 Lite labels 上的 bboxes（用 `auto_pipeline` 的繪圖 helper、同 class 配色）
- 頂端 overlay 標題列：左 `GEMINI 3.1 PRO — Red:R Blue:B Fuel:F Total:T`、右 `GEMINI 3.1 FLASH LITE — Red:R Blue:B Fuel:F Total:T`
- 水平合併成一張 PNG，中間加 8px 黑色分隔線
- 存 `compare_<stem>.png`

### Step 4: Console summary
印出表格：
```
| file          | pro R/B/F/Total | lite R/B/F/Total | Δtotal |
|---------------|-----------------|------------------|--------|
| 20261003_...  | 3/3/24/30       | 3/3/18/24        | +6     |
| ...
```
並印總耗時 + 估算成本。

## 5. 資料流

```
┌─────────────────────────────────┐
│ frc-vision-notyet/labels/**/*.txt│ (既有 Lite 產出，3775 張)
└───────────────┬─────────────────┘
                │ 篩選 + 排序 + 取 6
                ▼
┌─────────────────────────────────┐
│ _compare_pro_vs_lite/manifest.json│
│ _compare_pro_vs_lite/images/*.jpg │ (原圖 copy × 6)
└───────────────┬─────────────────┘
                │ 6 張 × 2 模型並行呼叫
                ▼
┌─────────────────────────────────┐
│ labels_pro/*.txt × 6             │
│ labels_lite/*.txt × 6            │
└───────────────┬─────────────────┘
                │ 畫圖 + 合併
                ▼
┌─────────────────────────────────┐
│ compare_<stem>.png × 6           │ (人工視覺評估終點)
└─────────────────────────────────┘
```

## 6. 技術決策

### 6.1 模型 ID（已於 2026-04-18 Web 查證）
- Pro：`gemini-3.1-pro-preview`
- Lite：`gemini-3.1-flash-lite-preview`（沿用 `auto_pipeline.DEFAULT_MODEL`）
- 註：`gemini-3-pro-preview` 已於 2026-03-09 deprecated，現 alias 到 3.1 Pro，新程式不用舊 ID。

### 6.2 並行策略
`asyncio.gather` 12 個 task。Google GenAI SDK 的 `generate_content` 是 sync，用 `asyncio.to_thread()` 包起來。

### 6.3 Prompt / Schema 來源
`from auto_pipeline import _PROMPT, _RESPONSE_SCHEMA` 直接 import。任何未來 prompt 改動同步生效，不需要兩邊維護。

### 6.4 繪圖工具
`auto_pipeline.py` 有 `preview` 子命令會畫 bbox，但未必導出 reusable helper。Step 3 實作時若發現 `auto_pipeline` 的繪圖函式是 module-level 可 import 的，直接重用並同步色票（`CLASS_COLORS_BGR`）；否則在 `compare_pro_vs_lite.py` 內寫本地 `_draw_boxes(img, labels)` 並 import `CLASS_COLORS_BGR` 保證配色一致。最終左右合併用 `cv2.hconcat`。

## 7. 成本 / 時間

- API：12 calls × (Pro ~$0.01 + Lite ~$0.001) ≈ $0.07 單次實驗
- 時間：並行下約 30–60 秒（單 call 10–15 秒）

## 8. 錯誤情境

| 情況 | 處理 |
|---|---|
| 篩選不到 6 張 | 自動降門檻，仍不足則印分佈讓 user 手動調 |
| API 429 | 3 次指數 backoff 重試 |
| 單張 Pro 呼叫永久失敗 | 該張對比圖改畫 "Pro failed" 文字，其他張繼續 |
| 雙模型都掛 | 整批中止並印錯誤，不產殘缺輸出 |
| API key 未設 | 沿用 `auto_pipeline` 的 `_load_api_key()` 邏輯 |

## 9. 測試

- 這是**一次性評估腳本**，不是 prod 代碼路徑。不寫 unit test。
- 驗證方式：實際跑 → 開 6 張 PNG → 能看到兩邊差異 + summary 表合理 → 完成。
- 若 Step 1 篩選 bug 導致抓錯圖 / 抓不到圖，即時發現手動 fix。

## 10. 交付

1. `compare_pro_vs_lite.py` 可執行腳本
2. `datasets/_compare_pro_vs_lite/` 含 6 張對比 PNG + manifest + 原圖 + 雙模型 labels
3. 一輪實際執行輸出貼回對話，由使用者肉眼判讀是否升級 prod pipeline 到 Pro

## 11. 不做的事（YAGNI 明列）

- 不加 CLI flag 控制張數（硬編 6，改值編輯檔案即可）
- 不加 `--model-a` / `--model-b` 泛化成通用比對工具
- 不存 API 原始 response JSON（僅留 YOLO labels）
- 不做 ground truth 標註
- 不把結果 commit 到 git（`datasets/_compare_pro_vs_lite/` 加進 `.gitignore`）
