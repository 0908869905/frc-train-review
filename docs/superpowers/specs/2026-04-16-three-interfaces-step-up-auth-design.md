# Three Interfaces + Step-up Auth — Design Spec

**Date**: 2026-04-16
**Author**: 94easystudio@gmail.com (via Claude Opus 4.6)
**Status**: Proposed — pending approval before implementation

## 背景與目標

現有 FRC Annotation Review Platform（M0–M7 已上線，production https://frc-annotation.vercel.app）已有完整 role-based 架構：
- `Role` enum：`admin` / `annotator` / `final_reviewer`
- `EmailWhitelist` 表：每個 email 對應一個 role
- Gmail SSO → 白名單比對 → JWT 帶 role

本次需求（user request, 2026-04-16）：
1. 審核者（annotator）介面：Gmail 登入 + 姓名輸入欄
2. 覆核者（final_reviewer）介面：覆核圖片並提交訓練，要設密碼 `frc6998`
3. 管理員（admin）介面：看帳號/姓名、指派圖片，要設密碼 `980415`
4. 密碼不放前端、必須加密
5. 視覺部分請與 Gemini 合作做出極簡、無 AI 味的介面

## 核心設計決策（brainstorming 結論）

- **Q1（雙層閘門）**：維持 Gmail+白名單，在 reviewer / admin 介面前加一層共用密碼 step-up。純密碼取代會丟失 per-user accountability，否決。
- **Q2（Session 綁定）**：密碼通過後直到這個 JWT session 結束（1 小時）都有效。與現有 `maxAge: 60 * 60` 對齊。
- **Q3（強制 onboarding + 可自改）**：首次 Gmail 登入後擋在 `/onboarding/name` 填真實姓名；profile 頁可自改。
- **Q4（整合成員表）**：`/admin/users` 升級成整合 `EmailWhitelist + User` 的單一「成員」表，一眼看完全團隊。
- **Q5（Reviewer 可匯出）**：export YOLO zip 權限從 `admin` 放寬到 `admin | final_reviewer`，由覆核者一鍵觸發「提交給訓練者」。

## 1. 系統全貌

在**不打破現有 role-based 架構**的前提下，疊三層改動：

1. **姓名 onboarding**：Gmail 登入後若無真實姓名則導 `/onboarding/name`，profile 可自改。
2. **Step-up 密碼閘門**：進 `/review` 或 `/admin` 時 session 若無對應 scope 的 step-up claim，彈密碼 modal；server 用 argon2id 比對；session 內沾黏。
3. **管理員成員總覽**：整合 `EmailWhitelist + User`，單張表看完全團隊；匯出按鈕下放給 reviewer。

現有 auth / RBAC / audit log / API 沿用，只多一層閘門與兩個新畫面。

## 2. Auth / Session 機制

### 2.1 Step-up 密碼儲存
- `frc6998`、`980415` **不進 DB、不進前端 bundle**
- 用 `argon2id` 離線算出 hash，放 Vercel env：
  ```
  REVIEWER_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$...
  ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$...
  ```
- 選 argon2id 原因：對短密碼（7–8 char 低熵）有 memory-hard 保護，擋離線暴力破解；`node-argon2` 是維護良好的 native binding。
- Hash 產生：一次性 script `scripts/hash-passwords.ts`，跑完輸出兩個 hash 字串讓你貼進 Vercel env（`vercel env add REVIEWER_PASSWORD_HASH production`）。

### 2.2 Step-up 流程
- 前端：`/review` 與 `/admin` 的 layout 用 client wrapper `<StepUpGuard scope="reviewer|admin">`，讀取「step-up 狀態」來決定是否開 modal。
- 無 step-up → 顯示密碼 modal（同頁，不換 route，不破壞既有 URL）。
- Modal → `POST /api/auth/step-up { password, scope }`。
- Server：`argon2.verify(hash, password)`，通過則**簽一個獨立 httpOnly cookie**：
  - Cookie 名：`stepup_reviewer` / `stepup_admin`
  - 內容：`HMAC-SHA256(userId + scope + expiresAt, AUTH_SECRET)` + `userId` + `expiresAt` 的 base64 payload
  - 屬性：`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`
  - 與 Auth.js session JWT **解耦**（不動 Auth.js 的 `update()` 機制，避免踩 v5 的 API 不穩定面）
- Server 驗證：`requireStepUp(request, scope)` 讀 cookie → 驗 HMAC → 比對 `userId` 與當前 session → 檢查未過期。
- 前端 `<StepUpGuard>` 如何知道要不要開 modal：呼叫 `GET /api/auth/step-up?scope=reviewer` 回 `{ granted: boolean }`（server 讀 cookie）。
- 失敗：固定 500ms 延遲回 401；前端顯示「密碼錯誤」。
- 防暴力：**同 userId 1 分鐘 5 次**，第 6 次起鎖 10 分鐘。實作優先 `@upstash/ratelimit` + Vercel KV；KV 未配置時降級為 in-memory Map — **僅 dev / 單 instance 有效，production 必須配 KV**（在 spec P1 里程碑 checklist 明列）。

### 2.3 Session 過期
- Step-up cookie `Max-Age=3600`（1 小時）與 Auth.js JWT `maxAge: 60 * 60` 對齊 → cookie 到期時自動要求重輸密碼。
- 登出 handler 額外清 `stepup_reviewer` / `stepup_admin` cookie（在 Auth.js `signOut` callback 加 `cookies().delete()`）。

### 2.4 權限矩陣

| 動作 | 需要 role | 需要 step-up |
|------|----------|--------------|
| 進 `/annotate`、標圖、submit | annotator / admin / final_reviewer | ❌ |
| 進 `/review`、approve / reject | admin / final_reviewer | ✅ `reviewer` |
| 匯出 YOLO zip | admin / final_reviewer | ✅ `reviewer` |
| 進 `/admin/*`、白名單 CRUD、指派、成員表 | admin | ✅ `admin` |

Admin 若想進 reviewer 頁需輸 `frc6998`（不做隱晦的自動繼承，讓「當下想進哪個介面」決定要哪個密碼）。

## 3. 資料庫變更（最小化）

### 3.1 `User` 表
- 新增 `displayNameSetAt: DateTime?` — 判斷是否已主動填過真實姓名（`null` → onboarding 強制填）。
- `name` 沿用，不另開新欄位。
- Migration：`ALTER TABLE "User" ADD COLUMN "displayNameSetAt" TIMESTAMP(3);`

### 3.2 `AuditLog` 新增 action 字串
- `auth.stepup_granted` — 密碼通過（user, scope）。
- `auth.stepup_failed` — 密碼錯誤（user, 時間；**不存嘗試的明文**）。
- `user.display_name_set` — 使用者改名。
- 不需改 schema，`AuditLog.action` 是 `String`。

### 3.3 不動的地方
- `EmailWhitelist`、`Role` enum、`BatchState`、`ImageState` 全部不動。
- 不為共用密碼建 table（env var + rotation by redeploy 已足夠）。

## 4. UI 變更與 Gemini 分工

**原則**：Gemini 負責新畫面與大改動的視覺稿；小修改（貼現有 palette / component）Opus 直接做。所有輸出遵守 Linear / Vercel / Basecamp 極簡密度風、中性灰階、禁 AI 味。

### 4.1 新畫面（Gemini 出視覺稿）

| # | 路徑 | 內容 | Gemini 產出 |
|---|------|------|-------------|
| N1 | `/onboarding/name` | 首次填真實姓名：單欄 input + 儲存 | Layout、文案語氣、default / loading / error 三態 |
| N2 | Step-up 密碼 Modal（嵌入 `/review` 與 `/admin` layout） | 標題「需要進一步驗證」+ 密碼欄 + 失敗提示 + 鎖定提示 | Modal 尺寸、失敗態、鎖定態視覺 |
| N3 | `/admin/members`（取代 `/admin/users`） | 表格：Email · 姓名 · Role · 加入日 · 最後登入 · 狀態 · 動作 | 欄位密度、排序、空態、bulk action |
| N4 | `/review` 新區塊「已完成 batch — 可匯出」 | 在現有 review tray 下方，card list：batch 名、完成日、approved 張數、下載 zip 按鈕 | Section 分隔、下載 CTA 的 weight（不比 approve 顯眼） |

### 4.2 既存畫面小改（Opus 直接做）

| 路徑 | 改動 |
|------|------|
| `/` dashboard | 最後登入、歡迎文案用自填姓名 |
| `/annotate/[id]` | 無改動 |
| `/projects/[id]/batches/[id]/assign` | 無改動（指派邏輯本就在此；加入 admin step-up 保護） |
| Header 右上 profile 抽屜 | 加「修改顯示姓名」→ `/onboarding/name?edit=1` |

### 4.3 Gemini 協作流程

1. 把本 spec `§ 1` + `§ 4` + UI 風格 memory 整成一份 brief。
2. 對 N1–N4 每個畫面各呼叫一次 `/gemini`，要求：
   - ASCII wireframe + Tailwind class 草案
   - default / loading / error 三態
   - **禁止輸出**：漸層、紫藍、sparkle icon、emoji、AI-powered 字眼、rounded-xl 大卡片、浮誇陰影
3. 產出存進 `docs/design/2026-04-16-three-interfaces/`，作為實作依據。
4. Opus 按稿實作，使用 shadcn/ui 現有 component（Dialog、Table、Input、Button）。

## 5. API 與檔案清單

### 5.1 新增檔案

| 檔案 | 用途 |
|------|------|
| `web/lib/stepup.ts` | argon2 verify、rate-limit、stepup cookie 簽/驗 helper |
| `web/app/api/auth/step-up/route.ts` | POST `{ password, scope }` → 驗 hash → set stepup cookie；GET `?scope=` → 回 `{ granted }` |
| `web/app/api/me/display-name/route.ts` | PATCH `{ name }` → 更新 `User.name` + `displayNameSetAt` + audit |
| `web/app/(protected)/onboarding/name/page.tsx` | 姓名 onboarding 畫面（N1） |
| `web/app/(protected)/admin/members/page.tsx` | 整合成員表（N3） |
| `web/components/step-up-dialog.tsx` | Step-up modal UI（N2，受控） |
| `web/components/step-up-guard.tsx` | Client wrapper：讀 session.stepUp，缺就開 modal |
| `web/scripts/hash-passwords.ts` | 一次性 hash 產生器 |

### 5.2 修改檔案

| 檔案 | 改動 |
|------|------|
| `web/lib/auth.ts` | signIn / jwt 後檢查 `displayNameSetAt` 決定導向；登出時清 stepup cookie（不動 JWT schema） |
| `web/proxy.ts` | 目標為 `/review` / `/admin/*` 時允許通過（讓 layout 開 modal，UX 較順） |
| `web/lib/rbac.ts` | 新增 `requireStepUp(session, scope)`，API 層使用 |
| `web/app/(protected)/review/layout.tsx` | 包 `<StepUpGuard scope="reviewer">` |
| `web/app/(protected)/admin/layout.tsx` | 包 `<StepUpGuard scope="admin">` |
| `web/app/api/batches/[id]/export/route.ts` | role 放寬為 `admin \| final_reviewer` + `requireStepUp(session, 'reviewer')` |
| `web/app/api/batches/[id]/assign/route.ts` | `requireStepUp(session, 'admin')` |
| `web/app/api/admin/whitelist/*` | `requireStepUp(session, 'admin')` |
| `web/prisma/schema.prisma` | `User.displayNameSetAt DateTime?` |

### 5.3 刪除 / 重導
- `/admin/users` → 301 redirect `/admin/members`（保留舊 bookmark）。
- 舊 `add-user-form.tsx` 併入 members 頁的「新增成員」dialog。

## 6. 測試與安全

### 6.1 單元測試
- `lib/stepup.ts`：argon2 verify 正確/錯誤；rate-limit 第 6 次鎖；鎖 10 分鐘後釋放。
- `lib/rbac.ts`：`requireStepUp` 缺 claim → throw；scope 不符 → throw。

### 6.2 整合測試
- `POST /api/auth/step-up`：正確 → response Set-Cookie 含簽名 cookie；後續 `GET` 回 `{ granted: true }`；錯誤 5 次 → 第 6 次 429。
- HMAC 驗證：篡改 cookie（改 userId 或 expiresAt）→ `GET /api/auth/step-up` 回 `{ granted: false }`。
- `POST /api/me/display-name`：寫入後 session.name 更新、`displayNameSetAt` 非 null、audit 有紀錄。
- `POST /api/batches/[id]/export`：reviewer 無 step-up → 403；有 step-up → 200 zip。
- `POST /api/batches/[id]/assign`：admin 無 step-up → 403。

### 6.3 E2E（Playwright）
- `step-up-reviewer.spec.ts`：模擬已登入 reviewer → 點匯出 → 跳 modal → 輸 `frc6998` → 下載可用。
- `onboarding-name.spec.ts`：新使用者登入 → 自動重導 onboarding → 填名 → 進 dashboard。

### 6.4 安全清單
- [ ] 密碼明文**只**在 request body 出現一次，不寫 log、不回 response。
- [ ] argon2 verify 無論通過失敗均固定 500ms 延遲（timing attack 防護）。
- [ ] Rate-limit key 用 `userId`（非 IP，避免共 NAT 誤鎖）。
- [ ] Step-up cookie 以 HMAC 簽名（key 用 `AUTH_SECRET`），前端無法偽造；驗證時檢查 `userId` 與當前 session 一致（避免 session fixation）。
- [ ] Cookie 設 `HttpOnly; Secure; SameSite=Lax`，無法被 JS 讀取。
- [ ] 密碼 input 用 `type="password" autocomplete="current-password"`。
- [ ] 任何 UI / API / error 都不回傳 hash 值或前綴。
- [ ] Audit log 失敗紀錄僅存 userId + 時間，**不存嘗試的密碼**。

## 7. 交付順序（供 writing-plans 參考）

建議里程碑切法：
- **P1 — schema + auth 骨架**：`User.displayNameSetAt`、`stepup.ts`、`/api/auth/step-up`、JWT claim、rate-limit。
- **P2 — Onboarding 流程**：`/onboarding/name`、`/api/me/display-name`、auth.ts 導向。
- **P3 — Step-up UI**：`step-up-dialog`、`step-up-guard`、嵌入 review/admin layout。
- **P4 — Admin 成員表**：`/admin/members`、API、舊 `/admin/users` 重導。
- **P5 — Reviewer 匯出**：放寬 export 權限 + review 頁「已完成 batch」區塊。
- **P6 — Gemini 視覺套版**：對 N1–N4 套 Gemini 出的視覺稿。
- **P7 — E2E + 安全審查**：新增兩支 Playwright、跑 security checklist。

每個 P* 完成後跑 `pnpm test` + `pnpm build`；全部完成後再整批 security review。
