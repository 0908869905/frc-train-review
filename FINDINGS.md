# frc-train-review - 技術發現

記錄格式：問題 → 原因 → 解決方案 → 選擇理由

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
