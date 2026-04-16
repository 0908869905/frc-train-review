# frc-train-review - 進度追蹤

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
