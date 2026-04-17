# frc-train-review - 錯誤記錄

此檔案記錄本專案特有的錯誤（通用錯誤請記錄到 `~/.claude/ERROR_LOG.md`）

---

## 2026-04-17 (第 3 次 session) step-up-only authz + UI 補完期專案特有錯誤

### E10：`/admin` 等 layout-only 目錄沒 `page.tsx` → 404

**情境**：使用者以 admin 步驟通過 step-up 後進 `/admin` 想看總覽,回 404。但 `/admin/members` 有料可看。

**根因**：Next.js App Router 要求每個 URL segment 有 `page.tsx` 才 routable。`web/app/(protected)/admin/` 目錄下只有 `layout.tsx`（StepUpGuard wrapper）+ 子目錄 `members/`,不構成 `/admin` 本身的路由。子路由 `/admin/members` 能走是因為 `members/page.tsx` 存在。

**修法**：新增 `web/app/(protected)/admin/page.tsx`：
```tsx
import { redirect } from 'next/navigation';
export default function AdminIndex() { redirect('/admin/members'); }
```
Commit `79da235`。

**預防**：每個有子路由的 segment 都要問「這個 segment 本身的 URL 要做什麼？」— 若無意義則放 `redirect()` 到 canonical 子頁,不要讓它默默 404。這是 App Router footgun — 目錄裡有東西（`layout.tsx`）看起來就該 work,結果不行。

**備註**：專屬 App Router 結構設計,但這種「layout 有但 page 沒有 → 404」的陷阱也可能出現在別處（例如 `/projects/[id]/batches` 若有 layout 沒 page）,未來新增 layout 時要順手檢查。

---

### E11：`/admin/members` 白名單登入閘門拿掉後顯示不出新登入 user

**情境**：admin 進 `/admin/members`,只看到自己 + 預先埋進 whitelist 的幾筆。任何已用 Google 登入過但沒 pre-add 到 whitelist 的隊友完全隱形。

**根因**：`admin/members/page.tsx` 的查詢以 `whitelist.findMany()` 為主表,join User by email。白名單 sign-in gate 拿掉後（commit `092d745`）,`signIn` callback 對未知 email fallback 為 `role='annotator'` 建 User row,但**不**同時建 EmailWhitelist row。於是：
- whitelist 有 row → 顯示（seeded admin）
- whitelist 沒 row 但 User 有 row → **被主表 join 邏輯排除,看不到**

這個 query 之前對是因為 whitelist 本身就是 sign-in gate,invariant 是「每個 User 必有 whitelist」— 現在這個 invariant 沒了。

**修法**：commit `00b6fce`。翻轉主表方向：
- `User.findMany()` 為主,join `EmailWhitelist` 為 optional
- 分兩區：「已登入 (N)」（所有 User,並顯示 whitelist role drift）+「預訂白名單 (N)」（僅在有 whitelist row 但無對應 User 時顯示）

**教訓**：當兩表的關係從「必 join」變成「可 join」（invariant 放鬆），`findMany` 的主表選擇可能整個反了。要主動搜 codebase 每個 `findMany` on 受影響的表,檢查 join 方向。這次是搜不出來的（commit 時沒看出 `/admin/members` 的 query 假設依賴 whitelist sign-in gate invariant）,下次做類似 invariant 變更要加 checklist。

**副作用（意外收穫）**：新版「已登入」區塊同時讓 E4 的 L1 drift（whitelist role 變但 User.role 沒同步）終於可見,amber `{role}（未同步）` 提醒 admin。

---

### E12：Next.js route handler `throw` 在 production 被吞成空 body 500

**情境**：使用者上傳 batch 到 finalize 時錯誤訊息只顯示「finalize failed:」後面空白。server log 雖記了 detail,但 client 無法自助 debug。

**根因**：`throw Object.assign(new Error('...'), { status: 400 })` 這個 pattern 在 Next.js App Router route handler 沒有被 framework serialize。`throw` 會冒到 Next.js 的 error boundary → 統一成 500 空 body,不管你掛了什麼 status。`{ status }` 只是 Error 上的 ad-hoc property,framework 不看。

**修法**：commit `72500df`。所有失敗分支改 `return NextResponse.json({ error: msg }, { status })`;外層 try/catch 吸未預期錯誤；client 端改 `await response.json().then(j => j.error)` 讀 detail；finalize 特定地把 classes mismatch 的 `expected=[...] got=[...]` 塞到 error message。

**遺留**：其他 route（approve / reject / submit / assign）仍用 throw pattern,下次碰到時遷移。

**預防**：新寫 route handler 時強制用 return + NextResponse.json。可考慮加 ESLint 自訂 rule 或 code review checklist:「route handler 內不得有 `throw` 超過最外層 try/catch」。

**備註**：
- FINDINGS 發現 O 有完整技術討論
- Next.js 16 App Router 官方 idiom 就是 return,不是 throw — 不是 bug 是 framework philosophy。只是我們寫 route 時習慣 throw 錯誤所以撞到

---

## 2026-04-16 M3 finalize 遇到的專案特有問題

### E1：Batch finalize 在 server 端 fetch 任意 URL → SSRF 風險

**情境**：`/api/batches/[id]/finalize` 會拿 client 回傳的 `zipUrl` 去 `fetch()`。若沒限制 host，攻擊者可讓 server 去打內網或 metadata endpoint。

**修法**：驗 `new URL(zipUrl).hostname` 必須結尾於 `.public.blob.vercel-storage.com` 或 `.blob.vercel-storage.com`，其餘一律 reject。

**備註**：記在本地而非通用，因為 allow-list 是 Vercel Blob 專案綁定，沒跨專案共用性。

---

### E2：ZIP 路徑 edge case —— Windows drive / null byte / control char

**情境**：`fflate` parse 出來的 filename 若是 `C:\foo.jpg` 或含 `\0` / `\x01-\x1f`，寫 disk 或傳 blob pathname 時會炸。

**修法**：`lib/zip-validator.ts` 新增三條 reject rule：
- match `/^[A-Za-z]:[\\/]/`（Windows drive prefix）
- 含 `\x00`
- 含 `[\x00-\x1f]` control char

**備註**：`..` 目錄穿越早就擋了，這三條是 fuzz 補強，專屬本專案的 zip import 流程。

---

### E3：Image content-type 用副檔名判斷不可信

**情境**：若有人上傳 `foo.jpg` 內容其實是 PNG（或可執行檔），下游渲染/儲存會錯。

**修法**：`lib/blob.ts sniffImageMime(bytes)` 讀前 4–12 bytes 的 magic：
- `89 50 4E 47` → `image/png`
- `FF D8 FF` → `image/jpeg`
- `52 49 46 46 .. .. .. .. 57 45 42 50` → `image/webp`
- 其他一律 reject

---

### E4：白名單 role 改了，既有 User.role 不同步（L1 backlog）

**情境**：admin 把 `whitelistEntry.role` 從 `annotator` 改成 `final_reviewer`，但該 user 下次登入走 `signIn` callback 時，DB 裡 `User.role` 不會自動跟著改（upsert 只在首次建立時寫 role）。

**目前狀態**：未修，列為 L1 backlog。workaround：手動改 `User.role` 或該 user 重註冊。

**備註**：不是嚴重 bug，admin 面板可補一個 "sync role from whitelist" 按鈕解決。

---

## 2026-04-17 Step-up auth 實作期專案特有錯誤

### E5：Vitest 檔案層 FK 殘留 —— `admin-api-stepup.test.ts` 炸一次後拖垮全部

**情境**：連續跑 `pnpm test` 有機率 10 failed across 6 files，單檔跑又過。案情：按字母排序最前的 `admin-api-stepup.test.ts` 的 `beforeAll` 跑 `user.deleteMany` 時被前一輪 crash 殘留的 `AuditLog` FK 擋 → 這檔本身的 `beforeAll` 失敗 → 後續檔案進去時 DB 殘渣更多 → 連鎖。

**根因**：Neon pooled connection + Prisma 7 不保證 session-level rollback 的殘留能被下一個 vitest worker 看見。`fileParallelism: false`（M7.7 已設）只排除 race，但不能清前一輪的孤兒 row。

**修法**：新增 `web/tests/helpers/clean-db.sql`，手動執行：
```bash
pnpm dlx dotenv-cli -e .env -- prisma db execute --file tests/helpers/clean-db.sql
```
TRUNCATE CASCADE 全部業務表 + auth 相關表，RESTART IDENTITY 重設 serial。

**備註**：
- 只在症狀出現時手動跑，不進 `globalSetup`（會拖慢每輪）
- 專案特有：Prisma schema 的表名清單寫死在 SQL 裡，跨專案不可攜
- 若未來此症狀反覆出現，應考慮 `globalSetup` hook 做一次性 reset

---

### E6：Plan-vs-reality drift —— 明細前撲後繼中間會卡的 5 處 signature 不符

**情境**：執行 2026-04-16 寫的 three-interfaces-step-up plan 時，subagent 按 plan 字面實作屢屢撞到既有 codebase convention 不符，不得不 patch。

**修法摘要**：
| Plan 假設 | 實際 codebase | Patch 方向 |
|---|---|---|
| `withTestSession` helper | 不存在，convention 是 `__setFakeSession` | 測試改 call `__setFakeSession` |
| `writeAudit({ action, userId, ... })` object-arg | 既有 `lib/audit.ts` 是 positional `writeAudit(action, userId, meta)` | route handlers 改用 positional |
| Upstash rate limit spec-compliant | Plan 漏 10-min 鎖（只有 5/min slide window） | I1 patch 加上 10-min lock-out（fixed window on denial） |
| `/api/admin/whitelist` | 實際是 `/api/admin/users`（M1.6 命名）| plan 與 test path 全改 |
| `/api/batches/[id]/export` | 實際是 `/api/projects/[id]/export` | plan 與 test path 全改 |
| Plan 改 `/review/page.tsx` | 檔案不存在（M6 只有 tray 在 dashboard） | 新建 page.tsx |
| `next-auth.d.ts` 新建 | M1 已存在（augment `id` + `role`） | extend 不 overwrite |

**後續措施**：
- 每次 plan 跑完一個 phase 就在 plan doc 底部寫 "amendment note"，避免 drift 累積
- Subagent prompt 要加「**不要假設檔案存在，先 ls + read**」的 tripwire

**備註**：算是「寫 plan 時 context 不足」的通用 risk，但清單具體對應本專案特有 path/signature，列本地而非 `~/.claude/ERROR_LOG.md`。

---

### E7：`unstable_update()` + server route 的 race window（先前 spec 階段已修，留此存檔）

**情境**：回顧 2026-04-16 第 5 次 session 規劃時曾試過用 Auth.js v5 的 `unstable_update()` 從 `/api/auth/stepup` server route 主動更新 JWT 塞 step-up 狀態。實作時驗證：`update()` 在 server route 呼叫完後，**同一個 request 的後續邏輯看得到舊 token**，要下一次 request 才生效 → 使用者若「按下按鈕、立刻又點下一個按鈕」會擊中 race window。

**修法**：改用獨立 HMAC-signed httpOnly cookie（見 FINDINGS.md 發現 H），完全與 Auth.js JWT 解耦，server 寫 cookie 同一個 response 就帶走，下一個 request 必讀到。

**備註**：專屬 Auth.js v5 + Next.js 16 server route 的行為；其他 framework 不見得有此 race。這段踩雷已在 spec 階段處理、實作階段沒再觸發，純記錄存檔避免未來有人回去試同一條路。

---

## 2026-04-17 (第 2 次 session) 短收尾期專案特有錯誤

### E8：Google sign-in 回 "Access Denied / You do not have permission to sign in"

**情境**：使用者 Gmail 登入 `https://frc-annotation.vercel.app`，選完帳號後 Google 顯示 AccessDenied。這是 Auth.js 的 `signIn` callback 回 `false` 時 Google OAuth 看到的標準錯誤。

**根因**：`web/lib/auth.ts` 的 `signIn` callback 查 `prisma.emailWhitelist.findUnique({ where: { email } })`，找不到就 `return false`。使用者明確要求「不要有白名單限制，讓全部人可進」，這個 gate 本身就是走錯方向。

**修法**：`web/lib/auth.ts:9-14` 改為「白名單找不到 → fallback `role = 'annotator'`」：
- 白名單仍保留作為「指定某些 email 為 admin / final_reviewer」的晉升機制（role override）
- 沒在白名單裡的 Gmail 依然可登入，只是預設 role 為 `annotator`
- Commit `092d745`

**安全論證**：reviewer / admin 頁面仍有 step-up 密碼（`frc6998` / `980415`）擋著，加上 `requireStepUp` 在 API route 層的雙重保護，開放 annotator 門檻 ≠ 開放 reviewer / admin 操作。

**預防**：今後若真要重新加登入限制，建議改為 role-based gate（例如「未知 email 鎖在 `/pending-approval` 頁」）而不是 `signIn` callback return false 把人擋在 Google 端 — 後者會讓使用者看到 Google 的 AccessDenied 完全不知道是自家平台的事。

**備註**：專屬本專案的 RBAC 設計選擇，不列通用 ERROR_LOG。

---

### E9：Vercel auto-deploy "No Next.js version detected" —— monorepo 子目錄 rootDirectory 未設

**情境**：push 到 master 觸發 Vercel auto-deploy（接 GitHub 後）失敗：
```
Skipping build cache since Package Manager changed from "pnpm" to "npm"
Error: No Next.js version detected. Make sure your package.json has "next"
in either "dependencies" or "devDependencies". Also check your Root Directory
setting matches the directory of your package.json file.
```

**根因**：Vercel project 的 Root Directory 設定為 `.`（repo 根），但 Next.js 在 `web/` 子目錄。`vercel git connect` 不會把 CLI working directory 設為 rootDirectory，所以接完 GitHub 後 auto-deploy 預設在 repo root 跑 build，根目錄只有 Python pipeline 沒有 `package.json`。

之前 CLI `vercel deploy --prod --yes` 從 `web/` 跑都 OK，是因為 CLI 直接打包 local 檔案上傳、不讀 project 的 rootDirectory。

**修法**：
```bash
# 查 project id
vercel project inspect frc-annotation
# 讀 CLI auth token（Windows）
cat "$APPDATA/com.vercel.cli/Data/auth.json"
# PATCH rootDirectory
curl -X PATCH https://api.vercel.com/v9/projects/prj_UNhDUOxcLub8TeWzrclb3zrXyzXt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"web"}'
# 重跑失敗的 deploy
vercel redeploy <failed-deployment-url> --target production
```

**預防**：未來跑 `vercel git connect` 後，下一步固定做 `vercel project inspect <name>` 檢查 `rootDirectory` 欄位。monorepo 子目錄結構必 PATCH 設對，不要等 auto-deploy 壞掉才發現。

**備註**：
- 細節見 FINDINGS.md 發現 L（含完整 API 範例與 token 位置）
- 專屬本專案的 monorepo 結構（repo root = Python pipeline、`web/` = Next.js），不列通用 ERROR_LOG；但 "`vercel git connect` 不寫 rootDirectory" 這件事是 Vercel CLI 的通用行為，如果未來撞到類似情況可考慮補進 `~/.claude/ERROR_LOG.md`
