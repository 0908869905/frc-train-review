# frc-train-review - 技術發現

記錄格式：問題 → 原因 → 解決方案 → 選擇理由

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
