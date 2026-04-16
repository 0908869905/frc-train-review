# frc-train-review - 技術發現

記錄格式：問題 → 原因 → 解決方案 → 選擇理由

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
