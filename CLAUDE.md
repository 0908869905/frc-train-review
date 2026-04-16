# frc-train-review

## 專案概述
這個 repo 現在包含**兩套完全解耦**的 pipeline，共用同一個 git repo 但無程式碼依賴：

1. **Python Training Pipeline**（原始用途，已存在）
   - 類型：FRC 機器人偵測模型訓練與資料集處理
   - 技術棧：Python 3.11+、ultralytics YOLO、onnxruntime、OpenCV、Roboflow
   - 來源：從 scoring-analyzer 專案分離出的訓練/資料集部分
   - 位置：repo 根目錄（`train_robot_model.py`、`extract_frames.py`、`datasets/`、`models/`）

2. **Next.js Annotation Review Platform**（M0–M7 + three-interfaces/step-up 已完成，production 已上線）
   - 類型：FRC 隊伍內部審核/訓練 Web 平台（類 Roboflow）
   - 技術棧：Next.js **16** App Router、React 19、TypeScript、Prisma **7** + Neon adapter、Neon Postgres、Vercel Blob v2、Auth.js v5 (Google SSO)、shadcn/ui (Tailwind v4)、Konva、Vitest、Playwright、argon2、Upstash（optional）
   - 用途：審核 Gemini 批次標註的資料、產出 YOLO dataset.zip 餵給訓練 pipeline
   - 位置：`web/` 子目錄（已完整實作）
   - 部署：Vercel（Root Directory = `web`），Production URL：https://frc-annotation.vercel.app
   - 程式庫：https://github.com/0908869905/frc-train-review （private）
   - **Git → Vercel auto-deploy**：Vercel 已接 GitHub repo（2026-04-17），push 到 `master` 會自動觸發 production deploy
   - **必備環境變數**（production + preview + development 三環境）：`DATABASE_URL` / `DATABASE_URL_UNPOOLED` / `AUTH_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `AUTH_TRUST_HOST` / `BLOB_READ_WRITE_TOKEN` / `REVIEWER_PASSWORD_HASH`（argon2id of `frc6998`）/ `ADMIN_PASSWORD_HASH`（argon2id of `980415`）/ `STEPUP_COOKIE_SECRET`；**選配**：`NEXT_PUBLIC_APP_URL`（讓 step-up CSRF origin check 生效）/ `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`（否則 step-up rate limit 降級 in-memory、多 instance 無效）

## 兩套 Pipeline 的邊界

```
┌────────────────────────────────────────────────────────────────┐
│  Python Training Pipeline (repo 根目錄, 原有)                   │
│  --------------------------------------------                  │
│  輸入：YOLO dataset.zip（手動放入 datasets/）                    │
│  輸出：models/*.onnx（手動複製回 scoring-analyzer）              │
│  核心腳本：train_robot_model.py（**絕對不動**）                  │
└────────────────────────────────────────────────────────────────┘
                             ▲
                             │ 手動傳遞 dataset.zip
                             │
┌────────────────────────────────────────────────────────────────┐
│  Next.js Annotation Review Platform (web/, 新增)               │
│  ----------------------------------------------                │
│  輸入：Gemini 批次標註結果（外部 offline pipeline 產生）          │
│  輸出：YOLO dataset.zip（images/ + labels/ + data.yaml）        │
│  部署：Vercel PaaS + Neon Postgres + Vercel Blob                │
└────────────────────────────────────────────────────────────────┘
```

**關鍵原則**：
- Web 平台**不呼叫** Python 程式碼、**不 import** 任何 Python 模組
- Python pipeline **不知道** web 平台存在
- 唯一交集：人類手動把 web 平台匯出的 `dataset.zip` 放進 Python pipeline 的 `datasets/` 目錄
- Repo 共用只是方便管理，不代表耦合

## 目錄結構
```
frc-train-review/
├── web/                                   # Next.js Annotation Review Platform（M0–M7 完成）
│   ├── app/
│   │   ├── (auth)/                        #   login 等未登入路由
│   │   ├── (protected)/                   #   proxy.ts 守護的已登入路由
│   │   │   ├── page.tsx                   #     dashboard（queue + ready-for-review）
│   │   │   ├── admin/                     #     users / whitelist 管理
│   │   │   ├── projects/                  #     專案列表 + project home + batches + assign + export
│   │   │   ├── annotate/                  #     Konva 標註編輯器
│   │   │   └── review/                    #     final_reviewer approve/reject tray
│   │   ├── api/
│   │   │   ├── auth/                      #     Auth.js v5
│   │   │   ├── admin/                     #     whitelist CRUD
│   │   │   ├── projects/                  #     專案 + class CRUD
│   │   │   ├── batches/                   #     init / finalize / assign / export
│   │   │   ├── blob/                      #     handleUpload token
│   │   │   ├── images/                    #     signed-url / annotations PATCH / submit / approve / reject
│   │   │   └── me/queue/                  #     annotator 待辦佇列
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── components/                        #   shadcn + AnnotationCanvas + ClassPalette
│   ├── lib/                               #   auth / rbac / db / blob / yolo / zip-validator / state-machine
│   │                                      #     assignment / audit / session / auth-test
│   ├── prisma/
│   │   ├── schema.prisma                  #     8 models + 5 enums
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── prisma.config.ts                   #   Prisma 7 config（seed + datasource）
│   ├── proxy.ts                           #   Next.js 16 middleware → proxy 改名
│   ├── tests/                             #   Vitest unit + integration + Playwright E2E
│   ├── playwright.config.ts
│   ├── vitest.config.ts
│   └── package.json
│
├── extract_frames.py                      # 影片取幀工具（OpenCV）
├── train_robot_model.py                   # YOLO 訓練 + ONNX 匯出 [不動]
├── download_matches.py                    # 下載 FRC 比賽影片
├── TRAIN_README.txt                       # 訓練流程說明
├── models/
│   └── frc_robot_yolo11n.onnx
├── datasets/
│   └── 2023mslr/
│       ├── match_videos.json
│       ├── videos/                        # 原始比賽影片
│       └── images_raw/                    # 取幀後的圖片
│
└── docs/
    └── superpowers/
        ├── specs/2026-04-15-annotation-review-platform-design.md
        └── plans/2026-04-15-annotation-review-platform.md
```

## 常用指令
```bash
# 影片取幀
python extract_frames.py video.mp4 --fps 1

# 訓練模型（需 NVIDIA GPU + CUDA）
python train_robot_model.py --api-key YOUR_ROBOFLOW_API_KEY --device cuda:0

# 記憶體不足時減少 batch size
python train_robot_model.py --api-key KEY --device cuda:0 --batch 8
```

## 開發規範
- 訓練與推論分離：訓練需 ultralytics、roboflow；推論只需 onnxruntime
- 模型輸出統一為 ONNX 格式放在 `models/` 目錄
- 資料集按賽事年份與地點命名（如 `2023mslr`）

## 注意事項
- 訓練產物 `models/*.onnx` 需複製回 scoring-analyzer 專案使用
- Roboflow 預設資料集：`main-wcgiu/robot-detection-xru6m` v16（1172 張 Red/Blue 底盤）
- CUDA 不可用時需安裝 GPU 版 torch：`pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121`
