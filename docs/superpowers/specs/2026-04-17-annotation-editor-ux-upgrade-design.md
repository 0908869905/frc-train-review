# Annotation Editor UX Upgrade — Design Spec

**Date**: 2026-04-17
**Scope**: `/annotate/[imageId]` (annotator first-layer review of Gemini-labelled data)
**Status**: Approved, ready for implementation plan

---

## 1. Context & Motivation

第一層審核介面(annotator 審核 Gemini 批次標註)目前在 `web/components/annotation/AnnotationCanvas.tsx` + `web/app/(protected)/annotate/[imageId]/editor.tsx`。使用者實測後回饋「操作很不人性化」。

對照 Python 桌面版 `label_editor.py`(team 既有工具,UX 驗證過),現有 web 版缺口:

| UX | `label_editor.py` | web 現況 |
|---|---|---|
| 選中 bbox 後改 class | Tab(toggle Red/Blue) | 無 — 只能刪掉重畫 |
| 移動 bbox | 拖曳 | 無 — 畫完不能移 |
| 縮放 bbox | 拖 resize handle | 無 — 畫完不能改大小 |
| 放大查看細節 | 滾輪 zoom + 中/右鍵 pan | 無 — 固定 800×600 |
| 重置視野 | `f` 鍵 fit view | 無 |
| Undo | `Ctrl+Z` | 無 |
| Prev / Next 張圖 | `←` / `→` | 無 — 只有 Submit & next |

「跟 label_editor.py 一樣,只是把 tab 改顏色改成快捷鍵改顏色」 — 使用者的一句話總結。

## 2. Non-Goals

- **不**改後端 API(`/api/images/[id]/annotations`、`/submit`)
- **不**改 DB schema、state machine、class definition、signed-url 流程
- **不**改 reviewer 的 approve / reject 邏輯
- **不**實作 redo(`Ctrl+Y`)— YAGNI,使用者可重做動作
- **不**引入觸控板雙指手勢(只支援鍵鼠;桌面優先)

## 3. Architecture

**擴充** 既有 `AnnotationCanvas.tsx`(重寫其內部,保留對外 component 名稱),新增 `readOnly?: boolean` prop。

- `readOnly === false`(editor):完整互動 — select / move / resize / draw / handles / undo
- `readOnly === true`(reviewer tray):僅渲染 + zoom / pan / fit view(reviewer 也受惠,可放大檢查 AI 錯誤)

替代方案考慮過:
- **另建 `AnnotationEditor.tsx`**,原 canvas 只做 view:zoom/pan 兩邊寫兩次,reviewer 沒放大功能 — 否決
- **抽 `<ImageViewport>` wrapper + `<BBoxLayer>` / `<DrawLayer>`**:分層乾淨,但目前只有兩個 consumer,over-engineering — 否決(未來第三個 consumer 再抽)

## 4. Viewport(Zoom / Pan / Fit)

新增一層座標系統。現行無此層,對外 API(`boxes` prop)仍以 normalized `[0, 1]` 表達。

### 4.1 Canvas 尺寸
- Konva `Stage` 填滿 container,用 `ResizeObserver` 監聽 container 尺寸 → setState width/height
- 取消現行固定 800×600

### 4.2 Viewport state(`AnnotationCanvas` 內部,不 lift)
```ts
const [zoom, setZoom] = useState(1);
const [pan, setPan] = useState({ x: 0, y: 0 });
```

### 4.3 座標轉換
- `normToDisp(nx, ny): {x, y}` — normalized → display pixel(套用 zoom + pan)
- `dispToNorm(dx, dy): {nx, ny}` — 反向
- 規則:`display = pan + (norm * natSize) * zoom`

### 4.4 Fit view 行為
同 `label_editor.py`:
```
zoom = min(containerW / natW, containerH / natH, 3.0)
pan  = { x: (containerW - natW*zoom) / 2, y: (containerH - natH*zoom) / 2 }
```
3× cap 避免小圖放過大。觸發點:初次 image load、container resize、按 `f`、切圖。

### 4.5 Zoom 互動
- 滾輪 factor `1.15` / tick(同 `label_editor.py`)
- Cursor-centered(滾輪 zoom 後,滑鼠下的 image 座標保持不動)
- Bounds `[0.1, 10]`

### 4.6 Pan 互動
- Middle-click drag **+** Right-click drag
- Right-click 需 `preventDefault()` 抑制 context menu

## 5. Bbox 互動(Modeless)

### 5.1 Hit-test 優先序(mousedown 時)
1. Selected box 的 8 個 resize handle(命中半徑 ≈ 9px)
2. 任何 bbox(從上層往下 — `boxes` 陣列尾往前)
3. 空白處

### 5.2 操作對應

| mousedown on | drag | release |
|---|---|---|
| handle | resize(依 handle 鎖邊,reverse 自動翻面) | commit |
| bbox 本體 | 選取 + move | commit |
| 空白 | draw preview(黃色虛線) | drag > 5px 且 w/h > 0.005 norm → 新 box;否則 deselect |

### 5.3 Handle 配置
8 個,同 `label_editor.py`:TL / TC / TR / ML / MR / BL / BC / BR。白填充 + 當前 class 顏色邊,**selected 時才渲染**。

### 5.4 Clamp 規則
- **Move**:`cx ∈ [bw/2, 1 - bw/2]`、`cy ∈ [bh/2, 1 - bh/2]`(bbox 完全在 image 內)
- **Resize**:min `5×5 px` 才 commit;`min(x1, x2) → x1`、`max → x2`(允許拖過頭翻面)

**偏離 `label_editor.py`**:Python 版只 clamp center(bbox 可超過邊緣一半),web 版改完全 clamp — 讓匯出的 YOLO label 不含負座標或 > 1。

### 5.5 Draw 規則
- class = 當前 active(`activeClassIdx`)
- 畫完自動 selected
- 尺寸 < 0.005 norm → 丟棄(同 `label_editor.py` 5px threshold)

### 5.6 視覺
- Normal bbox:2px 邊
- Selected bbox:3px 邊 + 8 handles + label 字加粗
- Gemini source(`box.source === 'gemini'`):虛線邊(保留現行)

### 5.7 Cursor
- 懸浮 bbox:`move`
- 懸浮 handle:方向性 `nwse-resize` / `nesw-resize` / `ns-resize` / `ew-resize`
- 空白:`crosshair`

## 6. Keyboard Shortcuts

| Key | 行為 |
|---|---|
| `←` / `→` | prev / next image in queue(先 flush auto-save 再切) |
| `Delete` / `Backspace` | 刪除 selected bbox |
| class shortcut(`r`、`b`…) | **若有 selected** → 改 selected class;**同時** set "next-draw active" |
| `1`–`9` | 同上,但 index-based(legacy 保留) |
| `f` | fit view |
| `Ctrl+Z` | undo |
| `Esc` | deselect + cancel in-progress draw |
| `S` | submit + 跳下一張(現行保留) |

### 6.1 Class shortcut 雙重作用
使用者語境:連續審一批 Gemini 誤標的 Red → Blue。
1. 按 `b` → selected 的 class 改為 Blue
2. **同時** active class 切到 Blue → 下一個空白處直接拖就畫 Blue,不用再按一次

省一步。

### 6.2 Ctrl+Z redo 不做
YAGNI。使用者犯錯再做一次即可,不做 forward history。

## 7. Undo Stack

- 每次 box mutation(add / delete / move / resize / class change)**前 push 一個 state snapshot**
- Cap 50 entry(per image)
- **Scope per image**:切圖後清空(同 `label_editor.py`,避免 cross-image 混亂)

## 8. Auto-save Flush

### 8.1 現行
- 2s debounce

### 8.2 新增 immediate flush 觸發點
- `←` / `→` 切圖前
- `S` submit 前
- Component unmount 前(best effort)

### 8.3 Flush pattern
```ts
if (hasPendingChanges) {
  const ok = await saveNow();
  if (!ok) return; // 保留原頁,顯示 save failed
}
router.push(nextUrl);
```

失敗時**不切圖**,讓使用者 retry — 避免切走後資料遺失的靜默錯誤。

### 8.4 切圖時的完整順序
1. Flush pending save
2. Save 失敗 → bail
3. 成功 → `router.push(/annotate/{prev|next}Id)`
4. 新 page 載入 → fit view + 清空 undo stack

## 9. ReadOnly 模式

`readOnly === true` 行為:
- **保留**:image 渲染、bbox 渲染、zoom / pan / fit / `f` 鍵
- **停用**:select / move / resize / draw / delete / handles / undo / class shortcut 雙重作用
- Hit-test:mousedown 一律視為「空白」(拖 = pan,而非 draw)
- Selected state 不渲染

Reviewer(`/review/[batchId]/review-tray.tsx`)只加 `readOnly` prop(一行改動),即享 zoom / pan 查細節。

## 10. File Changes

| 檔案 | 動作 |
|---|---|
| `web/components/annotation/AnnotationCanvas.tsx` | **重寫**(viewport + 互動 + readOnly) |
| `web/app/(protected)/annotate/[imageId]/editor.tsx` | 加 `←/→` nav、`f`/`Ctrl+Z`/`Esc`、class shortcut 雙重作用、flush-before-nav |
| `web/components/annotation/types.ts` | 加 viewport helper types(可選) |
| `web/app/(protected)/review/[batchId]/review-tray.tsx` | 加 `readOnly` prop(1 行改動) |

**不動**:API、DB schema、state machine、class definition、blob / signed-url、approve/reject。

## 11. Testing

### Unit(Vitest)
- 座標 helpers:`normToDisp` / `dispToNorm` round-trip
- Hit-test 順序:handle > bbox > empty
- Undo stack push/pop、cap 50 eviction、切圖清空
- Clamp 規則:move/resize 邊界

### Integration(Vitest + jsdom)
- Editor page keyboard flow:
  - `←/→` 觸發 flush + navigate
  - class shortcut 雙重作用(selected 時改該 box + set active)
  - `Ctrl+Z` undo
- `AnnotationCanvas` 以 shallow mock(不測 Konva 渲染)

### Manual QA checklist(dev server 實跑)
draw new / move / resize / delete / zoom / pan / fit / undo / class shortcut / prev-next flush。

### Playwright 不新增
Konva mouse event 在 Playwright 很難穩定測,投入/報酬差。

## 12. Risks / Open Questions

### Known risks
- Konva `Stage` + `ResizeObserver` + SSR 偶有 hydration glitch → `dynamic` import 已做(沿用現行)
- Right-click pan 抑制 context menu — 若使用者抗議再改為「中鍵 only」
- `f` / `Ctrl+Z` shortcut 衝突風險低(`Ctrl+Z` 在 input 外無爭;`f` 通常無其他用)

### Post-launch watch
- 觸控板使用者(MacBook)反應 — 若有人用,再加 `Space + 左拖` pan
- 若 undo stack 50 entry 不夠(重度使用者),再放大

---

## Appendix A — Class Shortcut 雙重作用流程圖

```
        key 'r' pressed
              |
       [has selected box?]
         yes |       | no
             v       v
   set box.class=Red  set activeIdx=Red
             |       |
             +---+---+
                 |
         set activeIdx=Red (both paths converge)
```

## Appendix B — 現行 vs 新版行為對照

| 情境 | 現行 | 新版 |
|---|---|---|
| Gemini 標錯 class | 刪掉 + 按 class key + 重畫 | 點選 + 按 class key |
| Gemini 框歪了 | 刪掉 + 重畫 | 點選 + 拖曳 |
| Gemini 框太小/大 | 刪掉 + 重畫 | 點選 + 拖 handle |
| 想看細節 | 無法 | 滾輪 zoom |
| 想看全貌 | 已是全貌 | `f` fit view |
| 犯錯想救回 | 無法 | `Ctrl+Z` |
| 看前一張 | 無法(只能 submit 再 submit) | `←` |
