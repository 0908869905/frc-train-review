# FRC Train & Review — 影像標註／審核平台與訓練資料管線

> 從科展研究長出來的工具：把「下載比賽影片 → 取幀 → Gemini 自動預標註 → **隊員線上協作審核** → 合併訓練 → YOLO → RKNN 部署」做成一條隊伍可以一起用的產線。**上線運作**：11 位隊員在網站上協作標註近 5,000 張（4,908）訓練圖片、30 個批次；上線當下依回饋熱修 6 個 commit 無中斷。

| | |
|---|---|
| 作者 | 李昌侑（Rick Lee）— FRC 6998 UNIPARDS 程式組 |
| 期間 | 2026/04/15 – 04/23（130+ commits，8 天密集開發） |
| 狀態 | **上線運作**（Next.js 16 網站＋Python 資料管線） |
| 規模 | web 約 6,100 行、25 個測試檔；Prisma + PostgreSQL、Konva 標註畫布 |

**開發方式（AI 協作聲明）**：本專案以「與 AI 結對開發」完成：問題定義、架構設計、實驗設計與驗證由我負責，程式碼由我與 AI（Claude Code）協作產出；每個模組做什麼、為什麼選這個方案、哪裡會失效，由我判斷並負責。`PROGRESS.md`／`FINDINGS.md`／`ERROR.md` 為開發期間的真實工作紀錄（隊員姓名與聯絡方式已去識別化）。

**相關專案**：[科展・電腦視覺計分](https://github.com/0908869905/scoring-analyzer) ・ [影像標註平台](https://github.com/0908869905/frc-train-review) ・ [偵察 App](https://github.com/0908869905/frc-scouting-pass) ・ [偵察掃描與 OPR](https://github.com/0908869905/frc-scout-scanner) ・ [報帳系統](https://github.com/0908869905/frc-expense-money) ・ [台灣手語影音辭典](https://github.com/0908869905/tsl-sign-dictionary) ・ [園遊會點餐系統](https://github.com/0908869905/ordering-system)

---

# FRC Train & Review（使用說明）

FRC 機器人偵測模型的資料集 pipeline — 下載、自動標註、審核、訓練。

> **分離自:** `D:\FRC\scoring-analyzer` (2026-04-15)
> **最終模型用於:** scoring-analyzer 的 YOLO 機器人偵測模式

## Pipeline 4 階段

```
[下載]         → [取幀/裁切]    → [自動標註]      → [審核]          → [合併/訓練]
download       extract          auto_annotate    label_editor     merge/train
matches/       frames/          (Gemini Vision)  (CustomTkinter)  (Colab T4)
batch          crop_events
```

## Quick Start

```bash
# 1. 安裝依賴
pip install -r requirements.txt

# 2. 設定環境變數
export GEMINI_API_KEY=your_gemini_key
export TBA_API_KEY=your_tba_key

# 3. 下載比賽影片（TBA API + YouTube）
python download_matches.py --event 2026inmis
python batch_download.py                                 # 批次多賽事

# 4. 從影片取幀
python extract_frames.py datasets/2026inmis/videos/ --fps 2

# 5. 自動標註（Gemini Vision）
python auto_annotate.py --images datasets/2026inmis/images/
python batch_annotate.py --sample 400                    # 三階段 pipeline

# 6. 收集 + 審核
python collect_to_notyet.py --auto
python label_editor.py datasets/notyet                   # Space 標記已審核

# 7. 同步審核完成的資料到 reviewed/
python sync_reviewed.py

# 8. 合併為訓練集
python merge_datasets.py

# 9. 訓練（本地 GPU）
python train_robot_model.py --local-dataset datasets/merged/data.yaml

# 或使用 Colab（推薦，需先 zip + 上傳 merged.zip 到 Google Drive）
# 開啟 train_colab.ipynb
```

## 目錄結構

```
frc-train-review/
├── *.py                      # 13 支 pipeline 腳本（flat layout）
├── train_colab.ipynb         # Colab T4 訓練 notebook（final 模型用）
├── TRAIN_README.txt          # GPU 訓練步驟
│
├── datasets/                 # gitignored（58 GB）
│   ├── merged/               # final 模型訓練集（1826 張）
│   ├── merged.zip            # Colab 上傳包（417 MB）
│   ├── reviewed/             # 審核完成
│   ├── notyet/               # 待審核
│   ├── 2026*/                # 14+ 個 2026 賽事原始素材
│   ├── 2023mslr/, 2024*/     # 舊賽季
│   └── labels_raw_orphoned/  # 孤兒標註
│
└── models/                   # gitignored
    ├── frc_robot.onnx        # 最新訓練輸出（2026-03-13, YOLOv26n）
    ├── frc_robot_old*.onnx   # 歷史版本
    └── backup/               # 其他 onnx 備份
```

## 環境變數

| 變數 | 用途 | 取得方式 |
|---|---|---|
| `GEMINI_API_KEY` | `auto_annotate.py` Gemini Vision API | https://ai.google.dev |
| `TBA_API_KEY` | `download_matches.py` TBA 賽事查詢 | https://www.thebluealliance.com/account |

## 與 scoring-analyzer 的關聯

- 本專案訓練的 `models/frc_robot.onnx` 是 scoring-analyzer 執行期使用的機器人偵測模型
- 訓練新模型後，複製到 `D:\FRC\scoring-analyzer\models\frc_robot.onnx` 即可生效
- 本專案不 import scoring-analyzer 的任何模組
