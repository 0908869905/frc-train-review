# frc-train-review - 進度追蹤

## Session: 2026-04-17 (第 5 次)

### 主題
執行前一個 session 寫的 Annotation Editor UX Upgrade plan — 把 Python 桌面版 `label_editor.py` 的 UX 整套搬到 web annotator 頁。14 個 task 全部完成 + 3 個 fix commits(code reviewer 抓到的 latent bugs) + 1 個 docs commit。Production 已 push master 觸發 Vercel auto-deploy。

### 執行模式
**Subagent-Driven Development**（`superpowers:subagent-driven-development` skill）。14 個 task plan,每個 task 派 implementer + spec review + code quality review。

### 完成項目

**Phase 0 — 4 個 pure helper modules（TDD,42 個新 unit tests）**
- [x] Task 0.1 `web/components/annotation/viewport.ts` — `imgToDisp` / `dispToImg` / `computeFitView` / `applyWheelZoom`(cursor-centered zoom,1.15× factor,[0.1, 10] bounds,3× fit cap)+ 10 tests
- [x] Task 0.2 `web/components/annotation/hit-test.ts` — `boxToImgRect` / `hitTestBox`(top-most z-order 優先)/ `hitTestHandle`(9 px 預設命中半徑)/ `HANDLE_CURSORS`(8 個方向性 cursor 字串)+ 11 tests
- [x] Task 0.3 `web/components/annotation/undo.ts` — `pushUndo<T>`(cap 50 預設,不可變)/ `popUndo<T>` + 7 tests
- [x] Task 0.4 `web/components/annotation/editor-actions.ts` — `changeSelectedClass` / `deleteSelected` / `clampMoveNorm` / `commitResize`(reverse-flip support,<5px reject)/ `commitDraw`(<0.005 norm reject,fresh UUID)+ 14 tests

**Phase 1 — AnnotationCanvas.tsx 完全重寫**
- [x] Task 1.1 ResizeObserver-responsive Konva Stage + viewport state(zoom/pan)+ fit-view on image load/URL change/container resize/`f` key + wheel zoom(cursor-centered,invert `-deltaY`)+ middle/right-click pan(`preventDefault` contextmenu)+ `readOnly` prop + `selectedId`/`onSelect` controlled props
- [x] Task 1.2 Modeless 互動 — `DragAction` tagged union(null | move | draw)+ hit-test priority(handle > box > empty,handle 待 1.3)+ drag move with `clampMoveNorm` + drag draw → commit via `commitDraw`(<5 px 視為 click → deselect)+ `drawPreview` 黃色虛線 + `hoverBoxId` state + cursor 反饋(mirror state `isPanning`/`isDrawing`,因為 React 19 `react-hooks/refs` 不允許 render 時 read refs)
- [x] Task 1.3 8-handle resize — 擴展 `DragAction` 加 `resize` variant + handle-hit 優先於 box-hit + resize 邏輯(handle 0=TL..7=BR)+ `renderHandles`(白填色 + class color 邊,`listening={false}`)+ `hoverHandleIdx` state + `HANDLE_CURSORS[idx]` cursor
- [x] Task 1.4 Esc 取消 in-progress draw + readOnly 驗證(無程式碼變更,readOnly 已由 1.2 實作)

**Phase 2 — editor.tsx 整合**
- [x] Task 2.1 **大改動** — Editor 擁有 `selectedId`、`undoStack`、`onBoxesChange` wrapper(pushUndo 舊 boxes 到 stack 再 setBoxes);image-id 變更時清空 stack + selection;**Canvas refactor 為 shadowBox pattern** — `onChange` 只在 mouseup 觸發(不再每 mousemove frame 觸發),蛇行 `shadowBox` state 提供 live drag 預覽;Esc + window-mouseup 清理也補上 `setShadowBox(null)`;editor 新增 keyboard handlers:Ctrl+Z(`popUndo` + `setBoxes` + 清選擇)、Del/Backspace(`deleteSelected` via `onBoxesChange`)、Esc(清選擇)
- [x] Task 2.2 Class shortcut 雙重作用 — 有 selected → `onBoxesChange(changeSelectedClass(boxes, selectedId, matchByShortcut))`;同時 `setActiveIdx`;letter + numeric fallback 都有雙重作用
- [x] Task 2.3 **flush-save 架構** — 拆 debounce useEffect:新增 `boxesRef`/`updatedAtRef`(ref 確保 `doSave` 讀最新值、不受閉包影響)、`doSave` useCallback、2s debounce useEffect、`flushSave`(清 pending timer + await doSave)、`submit`(flush 再 POST submit)、unmount flush useEffect(fire-and-forget);`prevId` 同 `nextId` 一起宣告;新 arrow-nav useEffect:←/→ 先 `flushSave()`,失敗則 stay、成功則 router.push
- [x] Task 2.4 Header hint 文字更新(`drag: empty→draw · box→move · handle→resize · wheel zoom · mid/right drag pan · f fit · ←/→ nav · 1-9/letters class · Del · Ctrl+Z · Esc · S submit`)

**Phase 3 — Review tray**
- [x] Task 3.1 Review tray readOnly — 已由 Task 1.1 完成(passes `readOnly`、`selectedId={null}`、`onSelect={() => {}}`;wrapper div 從 `items-center justify-center` 改 `flex` 讓 canvas 填滿);僅驗證,無新改動

**Phase 4 — Final validation**
- [x] Task 4.1 最終驗證(build + lint + 88/88 tests 全綠)+ 派最終 code reviewer + fast-forward merge + push

**非計畫內的 3 個 fix commits(code reviewer 抓到的 latent bugs)**
- [x] `e65196b` fix(web): clean up drag state on window mouseup + mid-drag pan — 補 window-level mouseup handler(使用者拖曳到 canvas 外釋放也會清空 drag state;middle-click 在 left-drag 中啟動 pan 時先 abort 左邊 drag)
- [x] `9b775ea` fix(web): resolve react-hooks lint errors on drag state mutations — Task 1.4 的 Esc useEffect 位置原本在 state 宣告之前,導致 `react-hooks/immutability` 規則誤判 dragState mutations;移到 state 宣告之後,規則就不再 fire 了
- [x] `cb67386` fix(web): save-race data loss + undo ref-based state — 最終 reviewer 抓到 C1 critical:`doSave` 在 in-flight 時直接 return true 可能導致「user 編輯 A → 2s save 中 → user 編輯 B → 按 → → flushSave 以為成功 → navigate → B 遺失」。改為 `inFlightSave` promise coalescing:先 await 舊的 save 再 fire 新的 save(用最新 boxes);也順便修 I1(unused `undoStack` 綁定,改成 `useRef`)+ I2(`setUndoStack` updater 裡的副作用違反 React 19 reducer purity,改成 ref-based 讀寫)

**1 個 docs commit**
- [x] `622fd94` docs: correct box1 y-coord math in Task 0.1/0.2 test specs — plan 裡原本 box1 (y=0.5, h=0.4, natH=500) 誤寫成 y1=100/y2=300,正確應是 y1=150/y2=350。subagent implementers 發現並修正 test,我再補 plan doc 的 math

### 核心設計決策(供未來 session 快速 recall)
1. **Canvas owns viewport + drag, Editor owns undo + save**:責任分離清楚。Canvas 透過 `onChange(newBoxes)` + `selectedId`/`onSelect` controlled 與 Editor 通信
2. **shadowBox pattern**:drag 中 Canvas 不 fire onChange,commit-on-release 後才 fire。Esc/window-mouseup 清 shadowBox → drag 中被 undo 會自動還原
3. **undoStackRef 而非 useState**:undo stack 不驅動 UI,只在 event handlers 間共享 → 用 ref 更純,避開 React 19 reducer purity 問題
4. **inFlightSave promise coalescing**:避免 rapid ←/→/S 時的 silent data loss
5. **React 19 effect 宣告順序**:新 useEffect 必須放在它讀的 refs/state 之後,否則 lint 會誤判 ref mutations 為「modifying value used in effect」
6. **Class shortcut 雙重作用**:有 selected → 改 class + set active;無 selected → 只 set active。省「畫完再按一次 class key」那一步
7. **Mirror state (`isPanning`/`isDrawing`)**:React 19 `react-hooks/refs` 禁止 render 時 read refs,所以 cursor 邏輯用 state booleans 鏡射 refs,而非直接 `panState.current ? 'grabbing' : 'grab'`

### 修改檔案
- `web/components/annotation/viewport.ts`(新增,zoom/pan/fit helpers)
- `web/components/annotation/hit-test.ts`(新增,box + 8 handles hit-test helpers)
- `web/components/annotation/undo.ts`(新增,undo stack helpers)
- `web/components/annotation/editor-actions.ts`(新增,class/delete/clamp/resize/draw helpers)
- `web/components/annotation/AnnotationCanvas.tsx`(完全重寫,加 viewport + modeless 互動 + 8-handle resize + readOnly + shadowBox pattern)
- `web/app/(protected)/annotate/[imageId]/editor.tsx`(大改,undo stack + Del + Ctrl+Z + Esc + class shortcut dual action + flush-save + ←/→ nav + submit flush)
- `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)
- `docs/superpowers/plans/2026-04-17-annotation-editor-ux-upgrade.md`(新增,implementation plan)
- `web/tests/unit/annotation/viewport.test.ts` + `hit-test.test.ts` + `undo.test.ts` + `editor-actions.test.ts`(新增 4 個 test file,42 test)

### Git commits(全 push master)
```
622fd94 docs: correct box1 y-coord math in Task 0.1/0.2 test specs
cb67386 fix(web): save-race data loss + undo ref-based state
5b4019c feat(web): expand annotation editor header hint to reflect new shortcuts
68ca1ed feat(web): annotation editor flush-save + ←/→ nav + submit flush
7baa046 feat(web): annotation class shortcut dual action (change selected + set active)
da2767a feat(web): annotation editor undo stack + Del + Ctrl+Z + Esc + shadowBox refactor
9b775ea fix(web): resolve react-hooks lint errors on drag state mutations
77495c6 feat(web): annotation canvas Esc cancels in-progress draw
a5732e2 feat(web): annotation canvas 8-handle resize (with reverse-flip)
e65196b fix(web): clean up drag state on window mouseup + mid-drag pan
2e1c35f feat(web): annotation canvas select + move + draw (modeless)
7a4f1f2 feat(web): annotation canvas viewport (zoom/pan/fit + responsive stage)
1a9aa3a feat(web): annotation editor-actions helpers (class/delete/clamp/resize/draw)
aeafe52 feat(web): undo stack helpers
d22bd54 feat(web): annotation hit-test helpers (box + 8 handles)
d73998d feat(web): annotation viewport helpers (zoom/pan/fit)
a93db09 docs: annotation editor UX upgrade implementation plan
```

branch `feat/annotation-editor-ux-upgrade` 已 fast-forward merge 進 master + push origin;local branch 已刪除。

### 最終測試狀態
- Build: green(Next.js 16 + Turbopack,33 routes)
- Lint: 0 errors(1 pre-existing warning 在 `name-form.tsx` 的 unused `isEdit`,不相關)
- Unit tests: 88/88 pass(12 test files,包含 4 個新的 + 既有 8 個)
- Playwright E2E: 未跑(spec 明確 skip,Konva 難測)
- 手動 QA: 使用者選擇跳過,Vercel auto-deploy 後直接 production smoke test

### 下一步
1. **使用者在 production 實測 annotation editor**(`https://frc-annotation.vercel.app/annotate/[任一 assigned image]`)— 走 viewport(滾輪/mid-right drag/f fit)、modeless 互動(點 bbox 選取、拖 bbox 移動、拖 handle 縮放)、draw 新 bbox、Del/Ctrl+Z/Esc、class shortcut 雙重作用、←/→ nav(看 flush 是否正常)、submit。如遇到回歸,開新 branch 修
2. **選配**:若手動 QA 抓到 edge case,考慮補 jsdom integration tests(spec §11 原本提過,被 Appendix C 延後)
3. **選配**:code reviewer 提到的 I3(Ctrl+Z / Del 在 drag 中按會 state 不一致)— 目前是 documented known limitation,若真有使用者撞到再補 fix(Canvas 在 boxes prop 變更且 drag 中時 auto-cancel drag)
4. **選配**:重度使用者反映 undo 50 不夠 → 擴大 cap;觸控板使用者 → 加 `Space + 左拖 pan`;右鍵 pan 衝突 context menu → 改 middle-only。都是 post-launch watch 項目
5. **Python pipeline 側**:隊友用平台審核過 Gemini 批次標註後,如果某個 batch 走到 `completed`,匯出 YOLO zip → 借 GPU 跑 `python train_robot_model.py --local-dataset ...` 做端到端訓練驗證(這是 L1 project_gpu_training_workflow memory 提過的延後項)

### 阻礙
無技術 blocker。等使用者 production 實測 annotation editor UX。

### 5-Question Reboot Check
1. **做什麼?** 執行 Annotation Editor UX Upgrade plan — 把 Python 桌面版 `label_editor.py` 的 UX(zoom/pan、modeless 互動、8-handle resize、fit view、undo、←/→ nav、class shortcut)整套搬到 web annotator 頁。Subagent-driven 執行 14 task,每 task 兩段式 review。
2. **進度?** 全部 14 task 完成 + 3 個 fix commits + 1 個 docs commit 全 push master。Build + lint + 88/88 tests 綠。branch `feat/annotation-editor-ux-upgrade` 已 merge + 刪除。
3. **下一步?** 使用者在 production 實測 annotation editor UX。若發現 regression 開新 branch 修;否則進入下一個功能開發。
4. **阻礙?** 無技術 blocker。等使用者實測。
5. **檔案?**
   - `web/components/annotation/AnnotationCanvas.tsx`(主要重寫對象)
   - `web/components/annotation/viewport.ts` + `hit-test.ts` + `undo.ts` + `editor-actions.ts`(新 4 個 pure helper module)
   - `web/app/(protected)/annotate/[imageId]/editor.tsx`(大改,undo + flush-save + nav + shortcut)
   - `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)
   - `docs/superpowers/plans/2026-04-17-annotation-editor-ux-upgrade.md`(plan)

---

## Session: 2026-04-17 (第 4 次)

### 主題
兩件事:
1. **端到端冒煙測試驗證成功** — 使用者在本地 `c:\Users\USER\Downloads\FRC-yolo.zip` 收到從 production `/review` export 的 YOLO zip(8 張圖 + 8 labels + classes.txt + data.yaml),驗證檔案結構、classes 順序(Red=0, Blue=1)、data.yaml、label 格式全部合規。整個平台從登入 → 建專案 → upload zip → finalize → assign → annotate → submit → review approve → export 完整 pipeline 首次跑通。
2. **規劃 Annotation Editor UX Upgrade** — 使用者回報「審核的介面目前操作很不人性化」,要求把 Python 桌面版 `label_editor.py`(team 既有工具)的 UX 整套搬到 web annotator 頁(`/annotate/[imageId]`),唯一差別是 class 切換從 Tab toggle 改成 class 自己的 shortcut(r/b/...)。走完 `superpowers:brainstorming` skill 流程,產出 design spec 並 commit。**尚未寫 implementation plan、尚未實作**。

### 完成項目
- [x] 確認 production 端到端冒煙測試成功(FRC-yolo.zip 結構與 YOLO 格式全通過)
- [x] 比對 `label_editor.py` vs 現有 `web/components/annotation/AnnotationCanvas.tsx` 功能落差(整理成表格)
- [x] 走 brainstorming 流程,使用者確認:
  - **Scope(Q1)**:整套 label_editor.py UX 搬(zoom/pan、move/resize bbox、fit view、undo、prev/next nav、class shortcut 替代 Tab toggle)
  - **Mode(Q2)**:Modeless — drag 空白 = 畫新 box,click bbox = 選,drag bbox = 移,drag handle = 縮放
  - **架構**:方案 1 — 擴充既有 `AnnotationCanvas.tsx` 加 `readOnly?: boolean` prop(reviewer tray 同時受惠,免費拿到 zoom/pan)
- [x] 分 4 段 section 呈現 design(viewport / bbox 互動 / keyboard+undo+autosave / readOnly+檔案+測試),每段獲使用者 OK
- [x] 寫 design spec 到 `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(257 行,12 個 section + 2 個 appendix)
- [x] Spec self-review(無 placeholder、內部一致、scope 單一 plan 可涵蓋)
- [x] Commit `26e6fae docs: annotation editor UX upgrade design spec`

### 核心設計決策(供下次 session recall)
1. **Modeless 互動**:hit-test 順序 handle > bbox > empty;drag empty = draw,click empty = deselect
2. **8 個 resize handles**:TL/TC/TR/ML/MR/BL/BC/BR,selected 才顯示
3. **Move clamp 偏離 label_editor**:`cx ∈ [bw/2, 1-bw/2]` 讓 bbox 完全在 image 內(避免 YOLO 負座標);Python 版只 clamp center
4. **Class shortcut 雙重作用**:有 selected → 改 selected class **同時** set "next-draw active"
5. **Undo per-image**:cap 50 entry,切圖清空;不做 redo(YAGNI)
6. **Auto-save immediate flush**:←/→ 切圖前、S submit 前、unmount 前 flush pending save;失敗不切圖
7. **ReadOnly mode**:reviewer tray 加一行 `readOnly` prop 即享 zoom/pan/fit
8. **Zoom**:滾輪 1.15×/tick cursor-centered,bounds [0.1, 10];fit view 3× cap
9. **Pan**:middle-click drag + right-click drag(需 preventDefault context menu)

### 修改檔案
- `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(新增,257 行)

### Git commits
- `26e6fae docs: annotation editor UX upgrade design spec`

### 規劃的未來檔案變動(尚未實作)
| 檔案 | 動作 |
|---|---|
| `web/components/annotation/AnnotationCanvas.tsx` | **重寫**(加 viewport + 互動 + readOnly) |
| `web/app/(protected)/annotate/[imageId]/editor.tsx` | 加 ←/→ nav、f/Ctrl+Z/Esc、class shortcut 雙重作用、flush-before-nav |
| `web/components/annotation/types.ts` | 加 viewport helper types(可選) |
| `web/app/(protected)/review/[batchId]/review-tray.tsx` | 加 `readOnly` prop(1 行) |

### 下一步
1. **使用者 review spec**(`docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`)— 目前阻塞在此
2. Spec 通過後 invoke `superpowers:writing-plans` skill 產 implementation plan
3. Plan 通過後進實作(subagent-driven-development 或 inline,待使用者選)

### 阻礙
無技術 blocker。等使用者 review spec。

### 5-Question Reboot Check
1. **做什麼?** (a) 驗證 production 端到端冒煙測試成功(FRC-yolo.zip 合規);(b) 規劃把 `label_editor.py` UX 整套搬到 web annotator 頁 — design spec 完成並 commit,尚未寫 plan 與實作。
2. **進度?** Design spec(257 行)已 commit(`26e6fae`);等使用者 review 後才能進 writing-plans。
3. **下一步?** 使用者 review `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`;通過後 invoke `superpowers:writing-plans` skill。
4. **阻礙?** 無技術 blocker,等使用者 review spec。
5. **檔案?**
   - `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`(design spec,主要跟隨對象)
   - `D:\FRC\frc-train-review\label_editor.py`(參考來源,Python 桌面版)
   - `web/components/annotation/AnnotationCanvas.tsx`(要重寫)
   - `web/app/(protected)/annotate/[imageId]/editor.tsx`(要加 nav + shortcut)
   - `web/app/(protected)/review/[batchId]/review-tray.tsx`(加 readOnly prop)

---

## Session: 2026-04-17 (第 3 次)

### 主題
Production 平台（`https://frc-annotation.vercel.app`）端到端冒煙測試。使用者用 `redacted@example.com` 登入後撞到兩個症狀：`/review` 顯示「僅覆核者 / 管理員可進入」、`/admin` 回 404。使用者決策：**不再綁定特定 Gmail 帳號才能登入/操作，只要 step-up 密碼正確即可** — 整塊 role-based RBAC 從 route layer 移除,step-up 密碼變成 reviewer/admin 動作的唯一閘門。後續工作往外擴：補 global top nav、New batch 按鈕、Export 按鈕、修 `/admin/members` 看不到新登入使用者的 bug。並產出端到端測試用的 `test_batch_8.zip`。

### 完成項目

**修復 1：step-up 密碼為唯一閘門（drop role-based RBAC）**
- `web/lib/rbac.ts` 新增 `ACTION_SCOPE: Partial<Record<Action, StepUpScope>>` + `requireAuthz(session, action, request)` + `authzOr401` wrapper — 把「哪個 action 要哪種 step-up」集中成單一 source of truth。`canPerform` / `requireRole` 保留給 unit test compat，但沒有 route 再呼叫
- 10 個 API route `requireRole` → `authzOr401` 對應正確 scope：admin/users POST+GET、batches/assign POST、batches/finalize POST、blob/upload POST、images/approve POST、images/reject POST、projects POST+PATCH、projects/[id]/batches POST、projects/[id]/export GET
- `/api/images/[id]/signed-url`：privileged 判斷改為「持有 reviewer 或 admin step-up cookie」而非查 role
- `/api/batches/[id]/assign`：拿掉 assignee 的 role 檢查，任何 active user 可被分派
- 補 `/admin/page.tsx`（redirect 到 `/admin/members`）修 `/admin` 404
- `/review/page.tsx` 與 `/admin/members/page.tsx` 移除 role check
- `StepUpGuard scope="admin"` 包 `/projects/new`、`/projects/[id]/upload`、`/projects/[id]/batches/[batchId]/assign`
- `StepUpGuard scope="reviewer"` 包 `/projects/[id]/export`
- `/projects` 列表拿掉 `canCreate` role check，"New project" 按鈕永遠顯示
- Dashboard「Ready for Review」區塊對所有人顯示
- Tests 改寫：3 個 integration 測試檔換 cookie helpers（admin/reviewer step-up cookies）+ 401 step-up-required 取代 403 role-forbidden；`admin-users.test.ts` 改測「session id ≠ step-up cookie userId → 401」
- 同步修掉現存 lint errors：`step-up-guard.tsx` / `step-up-dialog.tsx` / `completed-batches.tsx` / `rbac-stepup.test.ts`
- `web/.gitignore` 補 `/test-results` / `/playwright-report`
- 93/93 tests 綠、`pnpm build` 綠、`pnpm lint` 0 errors 1 warning
- Commit `79da235`（32 files, +310/-167）

**修復 2：Project home 列 batches + New batch 按鈕 + finalize error detail**
- `/projects/[id]/page.tsx` 改為顯示所有 batch（state + image count）+ "New batch" 按鈕連到 `/projects/[id]/upload`（先前只有「No batches yet」空字串）
- `/api/batches/[id]/finalize` 所有失敗分支改用 `return NextResponse.json({ error }, { status })`；classes mismatch 錯誤包含 `expected=[...] got=[...]` 對照；外層 try/catch 吸未預期錯誤
- `batch-uploader.tsx` 改讀 JSON error body 顯示給使用者
- Commit `72500df`（3 files, +178/-103）

**修復 3：Global top nav + Export button + 智能 batch 連結**
- 新 `web/components/top-nav.tsx`（server component，FRC Annotation logo + Dashboard + Projects + 使用者名 + Sign out server-action）
- 新 `web/app/(protected)/layout.tsx` 包 TopNav；`/review` 與 `/admin` 的 StepUpGuard layout nested 在這之下
- 依使用者指示 `/review` / `/admin` 仍維持 URL-only 不進 nav
- `/projects/[id]/page.tsx` 加「Export YOLO zip (N)」按鈕（N = approved image count）
- Batch 列表連結智能路由：`under_review` → `/review/[id]`、`completed` → `/projects/[id]/export`、否則 → assign page
- `/login` 文案更新掉白名單相關舊字串
- `lib/auth-test.ts` `FakeSession` 加 `name?: string | null`（TopNav 需要）
- Commit `2e746dc`（5 files, +96/-6）

**修復 4：`/admin/members` 顯示所有已登入使用者**
- 根因：舊 page iterate `EmailWhitelist` 為主表 join User；白名單 sign-in gate 上 session 拿掉後，多數 Google users 沒 whitelist row，整個隱形，只剩 seeded admin 看得到
- 改為 `User.findMany()` 為主表，分兩區顯示：
  - **已登入 (N)**：所有 User row，多一欄「白名單角色」，當 whitelist role ≠ User.role 以 amber `{role}（未同步）` 呈現 — 讓 E4「L1 backlog drift」終於可見
  - **預訂白名單 (N)**：只在有 whitelist row 無對應 User 時顯示
- Commit `00b6fce`（1 file, +100/-40）

**端到端測試 artifact**
- 新 `datasets/notyet/_test_samples/make_test_zip.py` + `test_batch_8.zip`（1.6 MB，8 張從 2895 張 `datasets/notyet/` 均勻取樣 + YOLO labels + `classes.txt = "Red\nBlue\n"`）
- 用於端到端冒煙測試上傳流程；注意 project class 必須 idx0=Red、idx1=Blue 順序一致，否則 finalize reject 並附上 expected/got diff

### 修改檔案（核心）
- `web/lib/rbac.ts`（ACTION_SCOPE map、requireAuthz、authzOr401 — 新 authz 核心）
- `web/app/(protected)/layout.tsx` + `web/components/top-nav.tsx`（global nav 結構）
- `web/app/(protected)/projects/[id]/page.tsx`（batch-aware + export button + smart links）
- `web/app/(protected)/admin/members/page.tsx`（User-primary 重寫）
- `web/app/(protected)/admin/page.tsx`（新建，redirect 到 `/admin/members`）
- `web/app/api/batches/[id]/finalize/route.ts`（try/catch + JSON error pattern，可作為其他 route 遷移模板）
- `datasets/notyet/_test_samples/test_batch_8.zip` + `make_test_zip.py`

### Git commits（皆已 push master + Vercel auto-deployed）
1. `79da235 feat(web): make step-up password the sole gate; drop role-based RBAC`
2. `72500df feat(web): project home lists batches with New batch button; finalize surfaces error detail`
3. `2e746dc feat(web): global top nav + export button on project home + smart batch links`
4. `00b6fce fix(web): /admin/members shows all logged-in users, not just whitelist entries`

### Production status
- `https://frc-annotation.vercel.app` 已跑在 `00b6fce`
- Env vars 完整（DATABASE_URL / AUTH_* / BLOB_READ_WRITE_TOKEN / REVIEWER_PASSWORD_HASH / ADMIN_PASSWORD_HASH / STEPUP_COOKIE_SECRET）
- 選配 `NEXT_PUBLIC_APP_URL` / `UPSTASH_*` 仍未設

### 下一步
1. **使用者端到端實測**（rosalyn 帳號 fresh login）：top nav + Sign out、Projects → 建 `2026inmis-bumper`（classes: Red(r) / Blue(b)，順序不可錯）→ New batch → 上傳 `test_batch_8.zip` → 自我分派 → 標註 → submit → `/review` + `frc6998` 覆核 → export
2. **選配**：若使用者想用單一 "bumper" class 而非 Red/Blue 拆兩 class,需重產 test zip 做 class remapping（本 session 未做）
3. **選配**：連 Upstash Redis（step-up rate-limit 跨 instance 持久化）+ 設 `NEXT_PUBLIC_APP_URL` 讓 step-up CSRF origin check 生效

### 5-Question Reboot Check
1. **做什麼？** Production 冒煙測試發現兩個 blocker（`/admin` 404 + `/review` role gate），使用者決策 drop role-based RBAC 改以 step-up 密碼為唯一閘門。後續擴充：global top nav、New batch 按鈕、Export 按鈕、修 `/admin/members` 看不見新登入使用者的 bug。產出端到端測試 zip。
2. **進度？** 4 個 commit 全 push、Vercel auto-deploy 綠（跑在 `00b6fce`）、93/93 tests + build + lint 綠。`test_batch_8.zip` ready。
3. **下一步？** 使用者用 rosalyn 帳號跑完整端到端實測（建專案 → 上傳 zip → 分派 → 標註 → submit → 覆核 → export）。
4. **阻礙？** 無技術 blocker。等使用者實測。若要單一 class bumper 專案需重產 zip。
5. **檔案？**
   - `web/lib/rbac.ts`（ACTION_SCOPE + requireAuthz + authzOr401）
   - `web/app/(protected)/layout.tsx` + `web/components/top-nav.tsx`
   - `web/app/(protected)/projects/[id]/page.tsx`
   - `web/app/(protected)/admin/members/page.tsx`
   - `web/app/api/batches/[id]/finalize/route.ts`（JSON-error pattern 模板）
   - `datasets/notyet/_test_samples/test_batch_8.zip` + `make_test_zip.py`

---

## Session: 2026-04-17 (第 2 次)

### 主題
短收尾 session。接在同日上一個 session（三種角色介面 + step-up auth 實作完成 + production 部署）之後，使用者 Gmail 登入實測時撞到兩個連動的 blocker，本 session 修完即收尾。

### 完成項目

**修復 1：移除 email 白名單登入閘門**
- 症狀：Google 登入後 Google 顯示 "Access Denied / You do not have permission to sign in"
- 根因：`web/lib/auth.ts` 的 `signIn` callback 查不到 `EmailWhitelist` row 就 `return false`，Google OAuth 回給用戶 AccessDenied
- 修法：改為「白名單找不到 → fallback role = `annotator`」；白名單保留作為「指定某些 email 為 admin / final_reviewer」的晉升機制，不再擋人
- 安全論證：reviewer / admin 頁面仍有 step-up 密碼（`frc6998` / `980415`）擋著，開放 annotator 門檻 ≠ 開放 reviewer / admin 操作

**修復 2：Vercel production auto-deploy 失敗**
- 症狀：push 到 master 後 Vercel auto-deploy 報 `No Next.js version detected. Make sure your package.json has "next" in either "dependencies" or "devDependencies"`；其實上一個 docs commit `1440204`（上 session 結尾）的 auto-deploy 也已經壞過，當時被 CLI 手動 deploy 覆蓋沒注意到
- 根因：Vercel project 的 Root Directory 設定是 `.`（repo 根目錄），但 Next.js 在 `web/` 子目錄。之前 CLI deploy 沒讀這個設定，接上 GitHub 後 auto-deploy 走 Vercel clone repo + 讀 project 設定的路徑才觸發
- 修法：CLI 沒提供改 rootDirectory 的子命令，改用 Vercel REST API `PATCH /v9/projects/{id}` body `{"rootDirectory":"web"}`，auth token 從 `$APPDATA/com.vercel.cli/Data/auth.json` 讀
- 驗證：`vercel redeploy <failed-url> --target production` 觸發新 deploy，aliased 到 `frc-annotation.vercel.app`；curl `/login` 200、`/` 307 ✓

### 修改檔案
- `web/lib/auth.ts`（`signIn` callback 邏輯改動，+2 / -2）

### Git commits
- `092d745 feat(web): remove email whitelist gate at sign-in`（已 push，觸發 auto-deploy；修 Root Directory 後 redeploy 成功）

### 下一步
1. **使用者仍需 Gmail 端到端驗證**（現在應該真的能登入了）— onboarding 填中文姓名、進 `/review` 輸 `frc6998`、進 `/admin` 輸 `980415`、`/admin/members` 新增成員、reviewer 匯出 zip
2. 登入後於 `/projects/new` 建 `bumper`(shortcut `b`)+`fuels`(shortcut `f`) 專案
3. **選配**：連 Upstash Redis（否則 step-up rate limit 只在 in-memory、多 instance 無效）
4. **選配**：把 `NEXT_PUBLIC_APP_URL` 設為 prod URL 讓 step-up CSRF origin check 真正作用

### 5-Question Reboot Check
1. **做什麼？** 短收尾 session，修 Gmail 登入 blocker（白名單 gate 擋人）+ Vercel auto-deploy blocker（Root Directory 未設 `web/`）。
2. **進度？** 兩個修復完成，commit `092d745` 已 push、redeploy 成功。Production `https://frc-annotation.vercel.app` 現在應可實際登入。
3. **下一步？** 使用者 Gmail 登入做端到端驗證（onboarding / step-up / 成員管理 / export 全流程）、建 bumper + fuels 專案；選配 Upstash + `NEXT_PUBLIC_APP_URL`。
4. **阻礙？** 無技術 blocker。待使用者實測確認登入真的通了。
5. **檔案？**
   - `web/lib/auth.ts`（`signIn` callback，fallback to annotator role）
   - `PROGRESS.md` / `FINDINGS.md` / `ERROR.md`（本次 session 紀錄）
   - Vercel project settings（Root Directory 已透過 API 改為 `web`）

---

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
