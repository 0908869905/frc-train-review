# frc-train-review - 錯誤記錄

此檔案記錄本專案特有的錯誤（通用錯誤請記錄到 `~/.claude/ERROR_LOG.md`）

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
