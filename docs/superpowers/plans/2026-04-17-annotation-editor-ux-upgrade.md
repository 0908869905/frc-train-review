# Annotation Editor UX Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/annotate/[imageId]` and `/review/[batchId]` canvas UX to match `label_editor.py` — zoom/pan/fit, move/resize bbox, modeless interactions, undo, prev/next nav with save flush, class shortcut dual action, and a `readOnly` mode for reviewer tray.

**Architecture:**
- Extract **4 pure helper modules** (`viewport.ts`, `hit-test.ts`, `undo.ts`, `editor-actions.ts`) into `web/components/annotation/`, fully unit-tested.
- **Rewrite** `AnnotationCanvas.tsx` internals (keep component name + module path for callers): ResizeObserver-sized Konva Stage, internal viewport state (zoom/pan), modeless mouse interactions (select/move/draw/resize), `readOnly` prop, controlled `selectedId`/`onSelect`.
- **Extend** editor page (`editor.tsx`): own `selectedId` + `undoStack`, implement class-shortcut dual action, `←`/`→` nav with save flush, `Ctrl+Z` undo, `Del` delete, `Esc` deselect.
- **Minimal** change in reviewer tray (`review-tray.tsx`): pass `readOnly={true}`, `selectedId={null}`, `onSelect={() => {}}` — it now gets zoom/pan/fit for free.

**Tech Stack:** Next.js 16 App Router (client components), React 19, Konva via `react-konva`, Vitest 4 (node env for pure helpers), TypeScript 5, existing shadcn/ui.

---

## Reference Documents

- **Design spec**: `docs/superpowers/specs/2026-04-17-annotation-editor-ux-upgrade-design.md`
- **Python reference (UX authority)**: `D:/FRC/frc-train-review/label_editor.py`
- **Existing Canvas (to be rewritten)**: `web/components/annotation/AnnotationCanvas.tsx`
- **Existing Editor**: `web/app/(protected)/annotate/[imageId]/editor.tsx`
- **Existing Review Tray**: `web/app/(protected)/review/[batchId]/review-tray.tsx`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `web/components/annotation/viewport.ts` | Pure helpers: `imgToDisp`, `dispToImg`, `computeFitView`, `applyWheelZoom`, `Viewport` type |
| `web/components/annotation/hit-test.ts` | Pure helpers: `boxToImgRect`, `hitTestHandle`, `hitTestBox`, `HandleIndex`, `HANDLE_CURSORS` |
| `web/components/annotation/undo.ts` | Pure helpers: `pushUndo`, `popUndo` (generic stack, cap 50) |
| `web/components/annotation/editor-actions.ts` | Pure helpers: `changeSelectedClass`, `deleteSelected`, `clampMoveNorm`, `commitResize`, `commitDraw` |
| `web/tests/unit/annotation-viewport.test.ts` | Unit tests for `viewport.ts` |
| `web/tests/unit/annotation-hit-test.test.ts` | Unit tests for `hit-test.ts` |
| `web/tests/unit/annotation-undo.test.ts` | Unit tests for `undo.ts` |
| `web/tests/unit/annotation-actions.test.ts` | Unit tests for `editor-actions.ts` |

### Rewrite / modify

| Path | Action |
|---|---|
| `web/components/annotation/AnnotationCanvas.tsx` | **Rewrite** (viewport + interactions + readOnly) |
| `web/app/(protected)/annotate/[imageId]/editor.tsx` | **Modify** (lift selectedId + undo stack, class shortcut dual action, flush + ←/→ nav, Del, Ctrl+Z, Esc, updated help) |
| `web/app/(protected)/review/[batchId]/review-tray.tsx` | **Modify** (pass `readOnly`, `selectedId={null}`, `onSelect`) |

### Unchanged (explicitly out of scope)

- `web/components/annotation/types.ts` (already has `Box` and `ClassDef` — no change needed)
- `web/components/annotation/ClassPalette.tsx`
- All API routes under `web/app/api/**`
- `prisma/schema.prisma`
- `lib/state-machine.ts`

---

## Convention Notes

- **TDD**: Each pure helper task writes failing tests → runs to see failure → implements → runs to see pass → commits.
- **Commit after each task** with conventional-commits format: `feat(web): …`, `test(web): …`, `refactor(web): …`. Body ≤ 72 chars subject, optional body.
- **Test commands**:
  - Run single test file: `pnpm --dir web test tests/unit/annotation-viewport.test.ts`
  - Run all tests: `pnpm --dir web test`
  - Build: `pnpm --dir web build`
  - Lint: `pnpm --dir web lint`
- **Path alias**: `@/foo` resolves to `web/foo` (see `tsconfig.json` + `vitest.config.ts`).
- **Working directory**: All `pnpm` commands assume current dir is repo root; use `--dir web` flag. (Or `cd web` first — either works.)
- **Next.js 16 constraint**: Client components use `'use client'`. No `React.FC`. No `cookies()`/`headers()` in these files (they are all client-side).
- **Minimalist UI** (per CLAUDE.md + MEMORY): pure grayscale, no indigo, no gradient, no sparkle. Colors come only from `ClassDef.color`.

---

# Phase 0 — Pure Helper Modules (TDD)

Write fully-tested pure helpers before touching UI. These are the foundation for the Canvas rewrite.

---

### Task 0.1: `viewport.ts` — coordinate + zoom helpers

**Files:**
- Create: `web/components/annotation/viewport.ts`
- Test: `web/tests/unit/annotation-viewport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/annotation-viewport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  imgToDisp,
  dispToImg,
  computeFitView,
  applyWheelZoom,
  type Viewport,
} from '@/components/annotation/viewport';

describe('imgToDisp / dispToImg', () => {
  const vp: Viewport = { zoom: 2, pan: { x: 10, y: 20 } };

  it('imgToDisp maps image → display correctly', () => {
    expect(imgToDisp(5, 7, vp)).toEqual({ x: 5 * 2 + 10, y: 7 * 2 + 20 });
  });

  it('dispToImg is the inverse of imgToDisp', () => {
    const disp = imgToDisp(123, 456, vp);
    const back = dispToImg(disp.x, disp.y, vp);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(456, 6);
  });
});

describe('computeFitView', () => {
  it('fills the container when image smaller than container but capped at 3×', () => {
    // tiny 100x100 image in 1000x1000 container: would be 10× but capped to 3×
    const vp = computeFitView(100, 100, 1000, 1000);
    expect(vp.zoom).toBe(3);
    expect(vp.pan).toEqual({ x: (1000 - 100 * 3) / 2, y: (1000 - 100 * 3) / 2 });
  });

  it('fits image within container preserving aspect ratio', () => {
    // 1920x1080 image in 800x600 container: limit is width (800/1920 = 0.417 < 600/1080 = 0.556)
    const vp = computeFitView(1920, 1080, 800, 600);
    expect(vp.zoom).toBeCloseTo(800 / 1920, 6);
    expect(vp.pan.x).toBeCloseTo(0, 6); // width exactly fills
    expect(vp.pan.y).toBeCloseTo((600 - 1080 * vp.zoom) / 2, 6);
  });

  it('handles container smaller than image (shrink)', () => {
    const vp = computeFitView(4000, 3000, 400, 300);
    expect(vp.zoom).toBeCloseTo(400 / 4000, 6);
    expect(vp.zoom).toBeLessThan(1);
  });
});

describe('applyWheelZoom', () => {
  const vp: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

  it('keeps point under cursor at the same image coord', () => {
    // cursor at display (200, 150) → image (200, 150) at zoom=1
    const after = applyWheelZoom(vp, 200, 150, +1);
    // After zoom, image coord under cursor should still be (200, 150)
    const imgAfter = dispToImg(200, 150, after);
    expect(imgAfter.x).toBeCloseTo(200, 4);
    expect(imgAfter.y).toBeCloseTo(150, 4);
  });

  it('scales up by 1.15 on positive delta', () => {
    const after = applyWheelZoom(vp, 0, 0, +1);
    expect(after.zoom).toBeCloseTo(1.15, 6);
  });

  it('scales down by 1/1.15 on negative delta', () => {
    const after = applyWheelZoom(vp, 0, 0, -1);
    expect(after.zoom).toBeCloseTo(1 / 1.15, 6);
  });

  it('clamps zoom at upper bound 10', () => {
    const high: Viewport = { zoom: 9.5, pan: { x: 0, y: 0 } };
    const after = applyWheelZoom(high, 0, 0, +1);
    expect(after.zoom).toBe(10);
  });

  it('clamps zoom at lower bound 0.1', () => {
    const low: Viewport = { zoom: 0.11, pan: { x: 0, y: 0 } };
    const after = applyWheelZoom(low, 0, 0, -1);
    expect(after.zoom).toBe(0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test tests/unit/annotation-viewport.test.ts`
Expected: FAIL — module `@/components/annotation/viewport` not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/annotation/viewport.ts`:

```ts
export type Viewport = {
  zoom: number;
  pan: { x: number; y: number };
};

/** Image-pixel coords → display-pixel coords (Konva Stage local). */
export function imgToDisp(ix: number, iy: number, vp: Viewport) {
  return { x: ix * vp.zoom + vp.pan.x, y: iy * vp.zoom + vp.pan.y };
}

/** Display-pixel coords → image-pixel coords. */
export function dispToImg(dx: number, dy: number, vp: Viewport) {
  return { x: (dx - vp.pan.x) / vp.zoom, y: (dy - vp.pan.y) / vp.zoom };
}

/**
 * Compute fit-view viewport. Matches label_editor.py _fit_zoom:
 *   zoom = min(containerW/natW, containerH/natH, 3)
 *   pan  = centered
 * 3× cap prevents tiny images from blowing up.
 */
export function computeFitView(
  natW: number,
  natH: number,
  containerW: number,
  containerH: number
): Viewport {
  const zoom = Math.min(containerW / natW, containerH / natH, 3);
  return {
    zoom,
    pan: {
      x: (containerW - natW * zoom) / 2,
      y: (containerH - natH * zoom) / 2,
    },
  };
}

/**
 * Cursor-centered wheel zoom. `delta > 0` → zoom in, `delta < 0` → zoom out.
 * Factor 1.15 per tick, bounds [0.1, 10]. Keeps point under cursor stable.
 */
export function applyWheelZoom(
  vp: Viewport,
  cursorX: number,
  cursorY: number,
  delta: number
): Viewport {
  const { x: ix, y: iy } = dispToImg(cursorX, cursorY, vp);
  const factor = delta > 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.1, Math.min(vp.zoom * factor, 10));
  return {
    zoom: newZoom,
    pan: { x: cursorX - ix * newZoom, y: cursorY - iy * newZoom },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web test tests/unit/annotation-viewport.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation/viewport.ts web/tests/unit/annotation-viewport.test.ts
git commit -m "feat(web): annotation viewport helpers (zoom/pan/fit)"
```

---

### Task 0.2: `hit-test.ts` — bbox + handle hit-test helpers

**Files:**
- Create: `web/components/annotation/hit-test.ts`
- Test: `web/tests/unit/annotation-hit-test.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/annotation-hit-test.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Box } from '@/components/annotation/types';
import type { Viewport } from '@/components/annotation/viewport';
import {
  boxToImgRect,
  hitTestBox,
  hitTestHandle,
  HANDLE_CURSORS,
} from '@/components/annotation/hit-test';

const natW = 1000;
const natH = 500;
const vp: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

// A box centered at (0.5, 0.5) with size 0.2 x 0.4 → image rect (400, 150)→(600, 350) on 1000x500
const box1: Box = {
  id: 'a',
  classIdx: 0,
  x: 0.5,
  y: 0.5,
  w: 0.2,
  h: 0.4,
  source: 'human',
};

// Smaller box on top-left, same image (0.1, 0.1) size 0.1 x 0.1 → (50, 25)→(150, 75)
const box2: Box = {
  id: 'b',
  classIdx: 1,
  x: 0.1,
  y: 0.1,
  w: 0.1,
  h: 0.1,
  source: 'gemini',
};

describe('boxToImgRect', () => {
  it('converts normalized box to image-pixel corners', () => {
    expect(boxToImgRect(box1, natW, natH)).toEqual({
      x1: 400,
      y1: 150,
      x2: 600,
      y2: 350,
    });
  });
});

describe('hitTestBox', () => {
  it('returns the top-most box id when display coord is inside it', () => {
    // display (500, 200) at zoom=1 pan=0 → image (500, 200) inside box1
    expect(hitTestBox(500, 200, [box1], natW, natH, vp)).toBe('a');
  });

  it('prefers later boxes in array (top-most z-order)', () => {
    // box2 covers (50-150, 25-75). Build an overlapping box that also covers (100, 50):
    const boxOver: Box = { ...box1, id: 'over', x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    // boxOver covers roughly (0, 0)-(200, 100). box2 covers (50, 25)-(150, 75). Both include (100, 50).
    expect(hitTestBox(100, 50, [boxOver, box2], natW, natH, vp)).toBe('b');
    expect(hitTestBox(100, 50, [box2, boxOver], natW, natH, vp)).toBe('over');
  });

  it('returns null when display coord is outside all boxes', () => {
    expect(hitTestBox(10, 10, [box1], natW, natH, vp)).toBeNull();
  });
});

describe('hitTestHandle', () => {
  it('returns -1 when selected box is null', () => {
    expect(hitTestHandle(500, 200, null, natW, natH, vp)).toBe(-1);
  });

  it('detects TL corner (handle 0) of selected box', () => {
    // box1 image rect TL = (400, 150) → display same (zoom=1 pan=0)
    expect(hitTestHandle(400, 150, box1, natW, natH, vp)).toBe(0);
  });

  it('detects MR handle (4) — right-middle', () => {
    // box1 MR = (600, 250) at vertical center of y∈[150,350]
    expect(hitTestHandle(600, 250, box1, natW, natH, vp)).toBe(4);
  });

  it('detects BR handle (7) — bottom-right', () => {
    expect(hitTestHandle(600, 350, box1, natW, natH, vp)).toBe(7);
  });

  it('returns -1 when far from any handle', () => {
    // (500, 200): inside box rect, but TC=(500,150) is 50 px away — far
    expect(hitTestHandle(500, 200, box1, natW, natH, vp)).toBe(-1);
  });

  it('respects hit radius (9 px default)', () => {
    // 8px offset from TL (400,150) → hit
    expect(hitTestHandle(408, 158, box1, natW, natH, vp)).toBe(0);
    // 10px offset from TL → miss
    expect(hitTestHandle(410, 160, box1, natW, natH, vp)).toBe(-1);
  });
});

describe('HANDLE_CURSORS', () => {
  it('provides cursor strings for all 8 handles', () => {
    expect(HANDLE_CURSORS).toHaveLength(8);
    // TL/BR should be nwse-resize
    expect(HANDLE_CURSORS[0]).toBe('nwse-resize');
    expect(HANDLE_CURSORS[7]).toBe('nwse-resize');
    // TC/BC: ns-resize
    expect(HANDLE_CURSORS[1]).toBe('ns-resize');
    expect(HANDLE_CURSORS[6]).toBe('ns-resize');
    // ML/MR: ew-resize
    expect(HANDLE_CURSORS[3]).toBe('ew-resize');
    expect(HANDLE_CURSORS[4]).toBe('ew-resize');
    // TR/BL: nesw-resize
    expect(HANDLE_CURSORS[2]).toBe('nesw-resize');
    expect(HANDLE_CURSORS[5]).toBe('nesw-resize');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test tests/unit/annotation-hit-test.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/annotation/hit-test.ts`:

```ts
import type { Box } from './types';
import { imgToDisp, dispToImg, type Viewport } from './viewport';

/** Handle indices match label_editor.py ordering. */
export type HandleIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Per-handle CSS cursor values (matches visual direction). */
export const HANDLE_CURSORS: readonly string[] = [
  'nwse-resize', // 0 TL
  'ns-resize',   // 1 TC
  'nesw-resize', // 2 TR
  'ew-resize',   // 3 ML
  'ew-resize',   // 4 MR
  'nesw-resize', // 5 BL
  'ns-resize',   // 6 BC
  'nwse-resize', // 7 BR
];

export type ImgRect = { x1: number; y1: number; x2: number; y2: number };

/** Convert normalized (center, width, height) box to image-pixel rect. */
export function boxToImgRect(box: Box, natW: number, natH: number): ImgRect {
  return {
    x1: (box.x - box.w / 2) * natW,
    y1: (box.y - box.h / 2) * natH,
    x2: (box.x + box.w / 2) * natW,
    y2: (box.y + box.h / 2) * natH,
  };
}

/**
 * Returns the id of the top-most box containing (dispX, dispY), or null.
 * "Top-most" = later in array (rendered on top).
 */
export function hitTestBox(
  dispX: number,
  dispY: number,
  boxes: Box[],
  natW: number,
  natH: number,
  vp: Viewport
): string | null {
  const { x: ix, y: iy } = dispToImg(dispX, dispY, vp);
  for (let i = boxes.length - 1; i >= 0; i--) {
    const r = boxToImgRect(boxes[i], natW, natH);
    if (ix >= r.x1 && ix <= r.x2 && iy >= r.y1 && iy <= r.y2) return boxes[i].id;
  }
  return null;
}

/**
 * Returns the handle index (0..7) hit by (dispX, dispY) for the given
 * selected box, or -1 if none. Hit radius in display pixels (default 9).
 */
export function hitTestHandle(
  dispX: number,
  dispY: number,
  selected: Box | null,
  natW: number,
  natH: number,
  vp: Viewport,
  hitRadius = 9
): HandleIndex | -1 {
  if (!selected) return -1;
  const r = boxToImgRect(selected, natW, natH);
  const tl = imgToDisp(r.x1, r.y1, vp);
  const tr = imgToDisp(r.x2, r.y1, vp);
  const bl = imgToDisp(r.x1, r.y2, vp);
  const br = imgToDisp(r.x2, r.y2, vp);
  const cx = (tl.x + tr.x) / 2;
  const cy = (tl.y + bl.y) / 2;
  const handles: Array<[number, number]> = [
    [tl.x, tl.y],         // 0 TL
    [cx, tl.y],           // 1 TC
    [tr.x, tr.y],         // 2 TR
    [tl.x, cy],           // 3 ML
    [tr.x, cy],           // 4 MR
    [bl.x, bl.y],         // 5 BL
    [cx, bl.y],           // 6 BC
    [br.x, br.y],         // 7 BR
  ];
  for (let i = 0; i < 8; i++) {
    const [hx, hy] = handles[i];
    if (Math.abs(dispX - hx) <= hitRadius && Math.abs(dispY - hy) <= hitRadius) {
      return i as HandleIndex;
    }
  }
  return -1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web test tests/unit/annotation-hit-test.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation/hit-test.ts web/tests/unit/annotation-hit-test.test.ts
git commit -m "feat(web): annotation hit-test helpers (box + 8 handles)"
```

---

### Task 0.3: `undo.ts` — undo stack helpers

**Files:**
- Create: `web/components/annotation/undo.ts`
- Test: `web/tests/unit/annotation-undo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/annotation-undo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pushUndo, popUndo } from '@/components/annotation/undo';

describe('pushUndo', () => {
  it('appends to stack', () => {
    expect(pushUndo<number>([], 1)).toEqual([1]);
    expect(pushUndo<number>([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it('caps stack length at default 50 (drops oldest)', () => {
    const stack = Array.from({ length: 50 }, (_, i) => i); // [0..49]
    const next = pushUndo(stack, 99);
    expect(next).toHaveLength(50);
    expect(next[0]).toBe(1); // 0 dropped
    expect(next[next.length - 1]).toBe(99);
  });

  it('respects custom cap', () => {
    const next = pushUndo([1, 2, 3], 4, 2);
    expect(next).toEqual([3, 4]);
  });

  it('does not mutate input stack', () => {
    const stack = [1, 2];
    pushUndo(stack, 3);
    expect(stack).toEqual([1, 2]);
  });
});

describe('popUndo', () => {
  it('returns null when empty', () => {
    expect(popUndo([])).toBeNull();
  });

  it('returns top + new stack', () => {
    const result = popUndo([1, 2, 3]);
    expect(result).toEqual({ stack: [1, 2], top: 3 });
  });

  it('does not mutate input stack', () => {
    const stack = [1, 2, 3];
    popUndo(stack);
    expect(stack).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test tests/unit/annotation-undo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/annotation/undo.ts`:

```ts
/**
 * Generic undo stack helpers. Pure functions — pass a stack in, get a new
 * stack out. State (useState etc) lives in the caller.
 */

export function pushUndo<T>(stack: T[], current: T, cap = 50): T[] {
  const next = [...stack, current];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function popUndo<T>(stack: T[]): { stack: T[]; top: T } | null {
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  return { stack: stack.slice(0, -1), top };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web test tests/unit/annotation-undo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation/undo.ts web/tests/unit/annotation-undo.test.ts
git commit -m "feat(web): undo stack helpers"
```

---

### Task 0.4: `editor-actions.ts` — box mutation helpers

**Files:**
- Create: `web/components/annotation/editor-actions.ts`
- Test: `web/tests/unit/annotation-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/tests/unit/annotation-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Box } from '@/components/annotation/types';
import {
  changeSelectedClass,
  deleteSelected,
  clampMoveNorm,
  commitResize,
  commitDraw,
} from '@/components/annotation/editor-actions';

const mkBox = (id: string, x = 0.5, y = 0.5, w = 0.2, h = 0.2, classIdx = 0): Box => ({
  id,
  classIdx,
  x,
  y,
  w,
  h,
  source: 'human',
});

describe('changeSelectedClass', () => {
  it('returns input unchanged when selectedId is null', () => {
    const boxes = [mkBox('a')];
    expect(changeSelectedClass(boxes, null, 1)).toBe(boxes);
  });

  it('updates classIdx of matching box only', () => {
    const boxes = [mkBox('a', 0.3, 0.3, 0.1, 0.1, 0), mkBox('b', 0.7, 0.7, 0.1, 0.1, 0)];
    const next = changeSelectedClass(boxes, 'b', 1);
    expect(next).toHaveLength(2);
    expect(next[0].classIdx).toBe(0);
    expect(next[1].classIdx).toBe(1);
  });

  it('returns same reference when selectedId does not match any box', () => {
    const boxes = [mkBox('a')];
    // New array returned because we .map — but content identical
    const next = changeSelectedClass(boxes, 'nonexistent', 1);
    expect(next).toEqual(boxes);
  });
});

describe('deleteSelected', () => {
  it('returns input unchanged when selectedId is null', () => {
    const boxes = [mkBox('a')];
    expect(deleteSelected(boxes, null)).toBe(boxes);
  });

  it('removes the matching box', () => {
    const boxes = [mkBox('a'), mkBox('b'), mkBox('c')];
    expect(deleteSelected(boxes, 'b').map((b) => b.id)).toEqual(['a', 'c']);
  });
});

describe('clampMoveNorm', () => {
  it('clamps center so full bbox stays within [0, 1]', () => {
    // Box w=0.2, h=0.4. cx must be in [0.1, 0.9]; cy in [0.2, 0.8].
    const box = mkBox('a', -0.5, 1.5, 0.2, 0.4);
    const out = clampMoveNorm(box);
    expect(out.x).toBeCloseTo(0.1, 6);
    expect(out.y).toBeCloseTo(0.8, 6);
  });

  it('leaves in-bounds boxes alone', () => {
    const box = mkBox('a', 0.5, 0.5, 0.2, 0.2);
    expect(clampMoveNorm(box)).toEqual(box);
  });
});

describe('commitResize', () => {
  const orig = mkBox('a', 0.5, 0.5, 0.2, 0.2, 1);
  const natW = 1000;
  const natH = 500;

  it('builds a new box from image-space rect preserving classIdx+id+source', () => {
    const result = commitResize(orig, { x1: 100, y1: 50, x2: 300, y2: 150 }, natW, natH);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.id).toBe('a');
    expect(result.classIdx).toBe(1);
    expect(result.source).toBe('human');
    expect(result.x).toBeCloseTo(0.2, 6);
    expect(result.y).toBeCloseTo(0.2, 6);
    expect(result.w).toBeCloseTo(0.2, 6);
    expect(result.h).toBeCloseTo(0.2, 6);
  });

  it('normalizes reverse-flipped corners (x2 < x1 etc)', () => {
    const result = commitResize(orig, { x1: 300, y1: 150, x2: 100, y2: 50 }, natW, natH);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.x).toBeCloseTo(0.2, 6);
    expect(result.w).toBeCloseTo(0.2, 6);
  });

  it('clamps to image bounds', () => {
    const result = commitResize(orig, { x1: -100, y1: -100, x2: 2000, y2: 2000 }, natW, natH);
    expect(result).not.toBeNull();
    if (!result) return;
    // Clamped to 0..natW and 0..natH
    expect(result.x).toBeCloseTo(0.5, 6);
    expect(result.w).toBeCloseTo(1.0, 6);
    expect(result.h).toBeCloseTo(1.0, 6);
  });

  it('returns null when resulting rect is below 5×5 image pixels', () => {
    expect(commitResize(orig, { x1: 100, y1: 100, x2: 103, y2: 104 }, natW, natH)).toBeNull();
  });
});

describe('commitDraw', () => {
  const natW = 1000;
  const natH = 500;

  it('builds a fresh human Box with fresh id', () => {
    const result = commitDraw({ x1: 100, y1: 50, x2: 300, y2: 150 }, natW, natH, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.classIdx).toBe(1);
    expect(result.source).toBe('human');
    expect(result.id).toBeTypeOf('string');
    expect(result.id.length).toBeGreaterThan(5);
  });

  it('returns null when normalized w < 0.005 or h < 0.005', () => {
    // On 1000x500 image, 0.005 norm = 5px wide / 2.5px tall
    expect(commitDraw({ x1: 100, y1: 100, x2: 103, y2: 200 }, natW, natH, 0)).toBeNull();
    expect(commitDraw({ x1: 100, y1: 100, x2: 200, y2: 101 }, natW, natH, 0)).toBeNull();
  });

  it('clamps to image bounds before checking size', () => {
    // Very wide draw starting outside image — clamps before size check
    const result = commitDraw({ x1: -500, y1: -500, x2: 500, y2: 500 }, natW, natH, 0);
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web test tests/unit/annotation-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `web/components/annotation/editor-actions.ts`:

```ts
import type { Box } from './types';

/** Change the selected box's class. No-op if selectedId is null. */
export function changeSelectedClass(
  boxes: Box[],
  selectedId: string | null,
  classIdx: number
): Box[] {
  if (!selectedId) return boxes;
  return boxes.map((b) => (b.id === selectedId ? { ...b, classIdx } : b));
}

/** Remove the selected box. No-op if selectedId is null. */
export function deleteSelected(
  boxes: Box[],
  selectedId: string | null
): Box[] {
  if (!selectedId) return boxes;
  return boxes.filter((b) => b.id !== selectedId);
}

/**
 * Clamp bbox center so the full bbox stays inside [0, 1] — stricter than
 * label_editor.py (which only clamps center). Avoids YOLO labels outside image.
 */
export function clampMoveNorm(box: Box): Box {
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  return {
    ...box,
    x: Math.max(halfW, Math.min(1 - halfW, box.x)),
    y: Math.max(halfH, Math.min(1 - halfH, box.y)),
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Build new box from image-space corners. Normalizes reverse-flipped corners
 * (handle dragged past opposite side). Clamps corners to image bounds.
 * Returns null if resulting rect < 5 image pixels in either dim.
 */
export function commitResize(
  orig: Box,
  rect: { x1: number; y1: number; x2: number; y2: number },
  natW: number,
  natH: number
): Box | null {
  const x1 = clamp(Math.min(rect.x1, rect.x2), 0, natW);
  const x2 = clamp(Math.max(rect.x1, rect.x2), 0, natW);
  const y1 = clamp(Math.min(rect.y1, rect.y2), 0, natH);
  const y2 = clamp(Math.max(rect.y1, rect.y2), 0, natH);
  if (x2 - x1 < 5 || y2 - y1 < 5) return null;
  return {
    ...orig,
    x: (x1 + x2) / 2 / natW,
    y: (y1 + y2) / 2 / natH,
    w: (x2 - x1) / natW,
    h: (y2 - y1) / natH,
  };
}

/**
 * Build fresh human-annotated Box from draw rect. Clamps to image bounds
 * then checks minimum normalized size (0.005 on each axis, ~ 5 px on 1000-wide image).
 */
export function commitDraw(
  rect: { x1: number; y1: number; x2: number; y2: number },
  natW: number,
  natH: number,
  classIdx: number
): Box | null {
  const x1 = clamp(Math.min(rect.x1, rect.x2), 0, natW);
  const x2 = clamp(Math.max(rect.x1, rect.x2), 0, natW);
  const y1 = clamp(Math.min(rect.y1, rect.y2), 0, natH);
  const y2 = clamp(Math.max(rect.y1, rect.y2), 0, natH);
  const w = (x2 - x1) / natW;
  const h = (y2 - y1) / natH;
  if (w < 0.005 || h < 0.005) return null;
  return {
    id: crypto.randomUUID(),
    classIdx,
    source: 'human',
    x: (x1 + x2) / 2 / natW,
    y: (y1 + y2) / 2 / natH,
    w,
    h,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web test tests/unit/annotation-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation/editor-actions.ts web/tests/unit/annotation-actions.test.ts
git commit -m "feat(web): annotation editor-actions helpers (class/delete/clamp/resize/draw)"
```

---

# Phase 1 — AnnotationCanvas Rewrite

Rewrite `web/components/annotation/AnnotationCanvas.tsx` incrementally. Each task leaves the component functional and commits. After Phase 1, the canvas supports the full spec.

---

### Task 1.1: Scaffold new Canvas — viewport + `readOnly` prop (no interactions yet)

**Files:**
- Modify: `web/components/annotation/AnnotationCanvas.tsx` (full rewrite)
- Modify: `web/app/(protected)/annotate/[imageId]/editor.tsx` (pass new props, temporarily wire `selectedId`/`onSelect` to no-op state)
- Modify: `web/app/(protected)/review/[batchId]/review-tray.tsx` (pass `readOnly` + no-op selection)

After this task: zoom with wheel, pan with middle/right-click, `f` fit — but no bbox interactions yet (boxes still render, still clickable via old listener? no — we're replacing it). Select/move/resize come in 1.2–1.3.

- [ ] **Step 1: Rewrite `AnnotationCanvas.tsx`**

Replace the entire file content of `web/components/annotation/AnnotationCanvas.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import type { Box, ClassDef } from './types';
import {
  imgToDisp,
  computeFitView,
  applyWheelZoom,
  type Viewport,
} from './viewport';

type Props = {
  imageUrl: string;
  classes: ClassDef[];
  activeClassIdx: number;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  readOnly?: boolean;
};

export function AnnotationCanvas({
  imageUrl,
  classes,
  boxes,
  selectedId,
  readOnly = false,
  // The following are wired later (Phase 1.2+) — keep in destructure to silence TS.
  activeClassIdx: _activeClassIdx,
  onChange: _onChange,
  onSelect: _onSelect,
}: Props) {
  void _activeClassIdx;
  void _onChange;
  void _onSelect;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [img] = useImage(imageUrl);
  const natW = img?.naturalWidth ?? 1;
  const natH = img?.naturalHeight ?? 1;

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>({ zoom: 1, pan: { x: 0, y: 0 } });

  // Track container size via ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit view whenever image loads, image URL changes, or container resizes.
  useEffect(() => {
    if (!img || containerSize.w === 0 || containerSize.h === 0) return;
    setVp(computeFitView(natW, natH, containerSize.w, containerSize.h));
  }, [img, natW, natH, containerSize.w, containerSize.h, imageUrl]);

  // `f` key → fit view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!img || containerSize.w === 0 || containerSize.h === 0) return;
      setVp(computeFitView(natW, natH, containerSize.w, containerSize.h));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [img, natW, natH, containerSize.w, containerSize.h]);

  // Wheel zoom (cursor-centered).
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;
    const delta = e.evt.deltaY < 0 ? +1 : -1;
    setVp((cur) => applyWheelZoom(cur, p.x, p.y, delta));
  }

  // Middle-click + right-click pan. Tracked via Stage listener + internal ref.
  const panState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault();
      panState.current = {
        startX: e.evt.clientX,
        startY: e.evt.clientY,
        panX: vp.pan.x,
        panY: vp.pan.y,
      };
    }
    // Left-click interactions are Phase 1.2+.
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!panState.current) return;
    const dx = e.evt.clientX - panState.current.startX;
    const dy = e.evt.clientY - panState.current.startY;
    setVp((cur) => ({
      ...cur,
      pan: { x: panState.current!.panX + dx, y: panState.current!.panY + dy },
    }));
  }

  function handleMouseUp() {
    panState.current = null;
  }

  // Suppress browser context menu so right-click pan works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: MouseEvent) => e.preventDefault();
    el.addEventListener('contextmenu', h);
    return () => el.removeEventListener('contextmenu', h);
  }, []);

  function classColor(idx: number) {
    return classes[idx]?.color ?? '#888';
  }

  function renderBox(box: Box) {
    const bx = (box.x - box.w / 2) * natW;
    const by = (box.y - box.h / 2) * natH;
    const bw = box.w * natW;
    const bh = box.h * natH;
    const tl = imgToDisp(bx, by, vp);
    const dispW = bw * vp.zoom;
    const dispH = bh * vp.zoom;
    const isSel = selectedId === box.id;
    return (
      <Group key={box.id}>
        <Rect
          x={tl.x}
          y={tl.y}
          width={dispW}
          height={dispH}
          stroke={classColor(box.classIdx)}
          strokeWidth={isSel ? 3 : 2}
          dash={box.source === 'gemini' ? [6, 4] : undefined}
        />
        <Text
          x={tl.x}
          y={tl.y - 14}
          text={`${classes[box.classIdx]?.name ?? '?'}${box.source === 'gemini' ? ' (AI)' : ''}`}
          fontSize={11}
          fontStyle={isSel ? 'bold' : 'normal'}
          fill={classColor(box.classIdx)}
        />
      </Group>
    );
  }

  // Image render rect in display coords.
  const imgTL = imgToDisp(0, 0, vp);
  const imgDispW = natW * vp.zoom;
  const imgDispH = natH * vp.zoom;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ cursor: readOnly ? 'grab' : 'default' }}
    >
      <Stage
        width={containerSize.w}
        height={containerSize.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {img && (
            <KImage image={img} x={imgTL.x} y={imgTL.y} width={imgDispW} height={imgDispH} />
          )}
          {boxes.map(renderBox)}
        </Layer>
      </Stage>
    </div>
  );
}
```

- [ ] **Step 2: Update `editor.tsx` to pass new props**

In `web/app/(protected)/annotate/[imageId]/editor.tsx`, add `selectedId` state and pass new props. Minimal change — other rewrites come in Phase 2.

Find the current AnnotationCanvas invocation in `editor.tsx` (~line 157) and the surrounding `<main>` container, plus add the selectedId state at the top of `Editor`. Full replacement of the component body follows (whole file). Replace the existing `export function Editor` body with:

```tsx
export function Editor(p: Props) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<Box[]>(p.initialBoxes);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(p.initialUpdatedAt);
  const [status, setStatus] = useState('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentIdx = p.queueIds.indexOf(p.imageId);
  const nextId = p.queueIds[currentIdx + 1];

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus('saving...');
      const res = await fetch(`/api/images/${p.imageId}/annotations`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lastKnownUpdatedAt: updatedAt,
          boxes: boxes.map((b) => ({
            classIdx: b.classIdx,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
          })),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setUpdatedAt(json.updatedAt);
        setStatus('saved');
      } else {
        setStatus('save failed');
      }
    }, 2000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes]);

  const submit = useCallback(async () => {
    setStatus('submitting...');
    const res = await fetch(`/api/images/${p.imageId}/submit`, {
      method: 'POST',
    });
    if (res.ok) {
      if (nextId) router.push(`/annotate/${nextId}`);
      else router.push('/');
    } else {
      setStatus('submit failed');
    }
  }, [p.imageId, nextId, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      if (key === 's') {
        submit();
        return;
      }

      const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
      if (matchByShortcut >= 0) {
        setActiveIdx(matchByShortcut);
        return;
      }

      if (key >= '1' && key <= '9') {
        const idx = parseInt(key, 10) - 1;
        if (idx < p.classes.length) setActiveIdx(idx);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submit, p.classes]);

  useEffect(() => {
    const nextIds = p.queueIds.slice(currentIdx + 1, currentIdx + 6);
    for (const id of nextIds) {
      fetch(`/api/images/${id}/signed-url`)
        .then((r) => r.json())
        .then((j) => {
          const img = new Image();
          img.src = j.url;
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.imageId]);

  return (
    <div className="grid grid-cols-[220px_1fr_200px] h-screen">
      <aside className="border-r p-3 overflow-y-auto">
        <div className="text-xs uppercase text-gray-500 mb-2">
          Queue ({p.queueIds.length})
        </div>
        {p.queueIds.map((qid, i) => (
          <div
            key={qid}
            className={`py-1 text-xs ${qid === p.imageId ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}
          >
            {i < currentIdx ? '✓' : qid === p.imageId ? '●' : '○'} {i + 1}
          </div>
        ))}
      </aside>

      <main className="flex flex-col">
        <header className="px-4 py-2 border-b text-xs flex justify-between text-gray-600">
          <span>
            {p.projectName} / {p.batchName} / {currentIdx + 1} of{' '}
            {p.queueIds.length}
          </span>
          <span>
            wheel zoom · mid/right drag pan · f fit · 1-9 / letters class · S submit
          </span>
        </header>
        <div className="flex-1 flex bg-gray-50">
          <AnnotationCanvas
            imageUrl={p.imageUrl}
            classes={p.classes}
            activeClassIdx={activeIdx}
            boxes={boxes}
            onChange={setBoxes}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <footer className="px-4 py-2 border-t flex justify-between items-center text-xs">
          <span className="text-gray-500">{status}</span>
          <Button onClick={submit}>Submit &amp; next (S)</Button>
        </footer>
      </main>

      <aside className="border-l overflow-y-auto">
        <ClassPalette
          classes={p.classes}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
        />
      </aside>
    </div>
  );
}
```

Note the changes vs. previous:
- Added `const [selectedId, setSelectedId] = useState<string | null>(null);`
- Removed `width={800} height={600}` from `<AnnotationCanvas>`
- Added `selectedId={selectedId} onSelect={setSelectedId}`
- Wrapper div of canvas changed from `items-center justify-center` to just `flex` (canvas now fills)
- Updated header hint text (first pass — full text in Phase 2.4)

- [ ] **Step 3: Update `review-tray.tsx` to pass new props**

In `web/app/(protected)/review/[batchId]/review-tray.tsx`, find the `<AnnotationCanvas>` element (~line 104) and update:

Replace:
```tsx
<AnnotationCanvas
  imageUrl={current.imageUrl}
  classes={classes}
  activeClassIdx={0}
  boxes={current.boxes}
  onChange={() => {}}
  width={900}
  height={600}
/>
```

With:
```tsx
<AnnotationCanvas
  imageUrl={current.imageUrl}
  classes={classes}
  activeClassIdx={0}
  boxes={current.boxes}
  onChange={() => {}}
  selectedId={null}
  onSelect={() => {}}
  readOnly
/>
```

Also change the outer wrapper div around it from `flex items-center justify-center` to `flex` so the canvas fills:

Replace:
```tsx
<div className="flex-1 flex items-center justify-center bg-gray-50">
```

With:
```tsx
<div className="flex-1 flex bg-gray-50">
```

- [ ] **Step 4: Verify build and existing tests still pass**

Run:
```bash
pnpm --dir web build
pnpm --dir web lint
pnpm --dir web test
```

Expected: all green. Type errors would flag any missed prop. Old Canvas tests (if any) should still pass — we kept component name and public API additive.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Start `pnpm --dir web dev`, sign in, open an annotate page. Expect:
- Image renders, auto-fits on load.
- Wheel zoom works; point under cursor stays put.
- Middle-click drag pans; right-click drag pans; right-click does NOT show context menu.
- `f` key refits.
- No bbox interactions yet (clicking bboxes doesn't select) — this is expected.

- [ ] **Step 6: Commit**

```bash
git add web/components/annotation/AnnotationCanvas.tsx \
        web/app/\(protected\)/annotate/\[imageId\]/editor.tsx \
        web/app/\(protected\)/review/\[batchId\]/review-tray.tsx
git commit -m "feat(web): annotation canvas viewport (zoom/pan/fit + responsive stage)"
```

---

### Task 1.2: Modeless interactions — select + move + draw

**Files:**
- Modify: `web/components/annotation/AnnotationCanvas.tsx`

After this task: click bbox → select; drag selected bbox → move; drag empty → draw new box.

- [ ] **Step 1: Update imports in `AnnotationCanvas.tsx`**

Replace the existing `viewport` import (to add `dispToImg`) and add two new imports. Final import block for Task 1.2:

```ts
import {
  imgToDisp,
  dispToImg,
  computeFitView,
  applyWheelZoom,
  type Viewport,
} from './viewport';
import { hitTestBox } from './hit-test';
import { clampMoveNorm, commitDraw } from './editor-actions';
```

(`hitTestHandle`, `boxToImgRect`, `HANDLE_CURSORS`, and `commitResize` are added in Task 1.3.)

- [ ] **Step 2: Replace destructure block to actually use `onChange`, `onSelect`, `activeClassIdx`**

At the top of `AnnotationCanvas` function body, replace:

```tsx
export function AnnotationCanvas({
  imageUrl,
  classes,
  boxes,
  selectedId,
  readOnly = false,
  activeClassIdx: _activeClassIdx,
  onChange: _onChange,
  onSelect: _onSelect,
}: Props) {
  void _activeClassIdx;
  void _onChange;
  void _onSelect;
```

With:

```tsx
export function AnnotationCanvas({
  imageUrl,
  classes,
  boxes,
  selectedId,
  readOnly = false,
  activeClassIdx,
  onChange,
  onSelect,
}: Props) {
```

- [ ] **Step 3: Add drag state refs and draw preview state**

Just below the existing `panState` ref declaration, add:

```ts
type DragAction =
  | null
  | { kind: 'move'; id: string; startImgX: number; startImgY: number; orig: Box }
  | { kind: 'draw'; startImgX: number; startImgY: number; curImgX: number; curImgY: number };

const dragState = useRef<DragAction>(null);
const [drawPreview, setDrawPreview] = useState<{
  x1: number; y1: number; x2: number; y2: number;
} | null>(null); // image coords
```

(During move/resize drag, `onChange` fires on every mouse-move event, which causes the parent to re-render with new `boxes`. That's sufficient — no internal tick state needed. Task 2.1 will refactor this to fire `onChange` only on commit using a shadow box.)

- [ ] **Step 4: Replace the mouse handlers**

Replace the existing `handleMouseDown`, `handleMouseMove`, `handleMouseUp` with this expanded set:

```tsx
function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
  // Pan first (middle/right button)
  if (e.evt.button === 1 || e.evt.button === 2) {
    e.evt.preventDefault();
    panState.current = {
      startX: e.evt.clientX,
      startY: e.evt.clientY,
      panX: vp.pan.x,
      panY: vp.pan.y,
    };
    return;
  }
  if (readOnly) return;
  if (e.evt.button !== 0) return;

  const stage = e.target.getStage();
  const p = stage?.getPointerPosition();
  if (!p) return;

  // Priority: handle > box > empty. Handle-hit is added in Task 1.3.
  const hitId = hitTestBox(p.x, p.y, boxes, natW, natH, vp);
  if (hitId) {
    onSelect(hitId);
    const orig = boxes.find((b) => b.id === hitId);
    if (!orig) return;
    const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);
    dragState.current = {
      kind: 'move',
      id: hitId,
      startImgX: ix,
      startImgY: iy,
      orig,
    };
    return;
  }

  // Empty: start draw. (Defer deselect to mouseup if no drag.)
  const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);
  dragState.current = {
    kind: 'draw',
    startImgX: ix,
    startImgY: iy,
    curImgX: ix,
    curImgY: iy,
  };
  setDrawPreview({ x1: ix, y1: iy, x2: ix, y2: iy });
}

function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
  // Pan
  if (panState.current) {
    const dx = e.evt.clientX - panState.current.startX;
    const dy = e.evt.clientY - panState.current.startY;
    setVp((cur) => ({
      ...cur,
      pan: { x: panState.current!.panX + dx, y: panState.current!.panY + dy },
    }));
    return;
  }

  if (!dragState.current) return;
  const stage = e.target.getStage();
  const p = stage?.getPointerPosition();
  if (!p) return;
  const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);

  if (dragState.current.kind === 'move') {
    const s = dragState.current;
    const dx = (ix - s.startImgX) / natW;
    const dy = (iy - s.startImgY) / natH;
    const moved = clampMoveNorm({
      ...s.orig,
      x: s.orig.x + dx,
      y: s.orig.y + dy,
    });
    onChange(boxes.map((b) => (b.id === s.id ? moved : b)));
  } else if (dragState.current.kind === 'draw') {
    dragState.current.curImgX = ix;
    dragState.current.curImgY = iy;
    setDrawPreview({
      x1: dragState.current.startImgX,
      y1: dragState.current.startImgY,
      x2: ix,
      y2: iy,
    });
  }
}

function handleMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
  if (panState.current) {
    panState.current = null;
    return;
  }
  if (!dragState.current) return;
  if (e.evt.button !== 0) return;

  const action = dragState.current;
  dragState.current = null;

  if (action.kind === 'move') {
    // Already committed in handleMouseMove; nothing to do.
  } else if (action.kind === 'draw') {
    const dw = Math.abs(action.curImgX - action.startImgX);
    const dh = Math.abs(action.curImgY - action.startImgY);
    // < 5 image-pixel drag treated as a plain click → deselect.
    if (dw < 5 && dh < 5) {
      onSelect(null);
      setDrawPreview(null);
      return;
    }
    const newBox = commitDraw(
      {
        x1: action.startImgX,
        y1: action.startImgY,
        x2: action.curImgX,
        y2: action.curImgY,
      },
      natW,
      natH,
      activeClassIdx
    );
    setDrawPreview(null);
    if (!newBox) return;
    onChange([...boxes, newBox]);
    onSelect(newBox.id);
  }
}
```

- [ ] **Step 5: Render the draw preview**

Inside the `<Layer>`, after `{boxes.map(renderBox)}`, add:

```tsx
{drawPreview && (() => {
  const tl = imgToDisp(
    Math.min(drawPreview.x1, drawPreview.x2),
    Math.min(drawPreview.y1, drawPreview.y2),
    vp
  );
  const w = Math.abs(drawPreview.x2 - drawPreview.x1) * vp.zoom;
  const h = Math.abs(drawPreview.y2 - drawPreview.y1) * vp.zoom;
  return (
    <Rect
      x={tl.x}
      y={tl.y}
      width={w}
      height={h}
      stroke="#e0b400"
      strokeWidth={2}
      dash={[4, 2]}
      listening={false}
    />
  );
})()}
```

- [ ] **Step 6: Adjust cursor based on hit target**

Add just above `return` in the component:

```tsx
const [hoverBoxId, setHoverBoxId] = useState<string | null>(null);

function handleMouseMoveForHover(e: Konva.KonvaEventObject<MouseEvent>) {
  handleMouseMove(e);
  if (dragState.current || panState.current) return;
  const stage = e.target.getStage();
  const p = stage?.getPointerPosition();
  if (!p) return;
  const id = hitTestBox(p.x, p.y, boxes, natW, natH, vp);
  setHoverBoxId(id);
}
```

Compute cursor style:
```ts
const cursor = readOnly
  ? panState.current
    ? 'grabbing'
    : 'grab'
  : panState.current
    ? 'grabbing'
    : dragState.current?.kind === 'draw'
      ? 'crosshair'
      : hoverBoxId
        ? 'move'
        : 'crosshair';
```

Update the wrapper div `style`:
```tsx
<div
  ref={containerRef}
  className="w-full h-full relative"
  style={{ cursor }}
>
```

And replace `onMouseMove={handleMouseMove}` on `<Stage>` with `onMouseMove={handleMouseMoveForHover}`.

- [ ] **Step 7: Verify build and manual test**

Run:
```bash
pnpm --dir web build
```

Expected: no TypeScript errors.

Start dev server and test:
- Click an existing Gemini box → it shows 3px stroke (selected).
- Drag a selected box → moves; commits on release; stays within image bounds (no negative coords).
- Drag on empty area → dashed yellow preview appears; release creates new box in `activeClassIdx` color.
- Very short drag (<5 img-px) → deselect (not accidental draw).

- [ ] **Step 8: Commit**

```bash
git add web/components/annotation/AnnotationCanvas.tsx
git commit -m "feat(web): annotation canvas select + move + draw (modeless)"
```

---

### Task 1.3: Resize handles — render + drag

**Files:**
- Modify: `web/components/annotation/AnnotationCanvas.tsx`

After this task: 8 handles show on selected box; drag handle resizes; reverse-flip works.

- [ ] **Step 1: Add `commitResize` import + handle rendering + hit-test integration**

Update imports at top:

```ts
import {
  clampMoveNorm,
  commitDraw,
  commitResize,
} from './editor-actions';
import {
  hitTestBox,
  hitTestHandle,
  boxToImgRect,
  HANDLE_CURSORS,
  type HandleIndex,
} from './hit-test';
```

- [ ] **Step 2: Extend `DragAction` union to include resize**

Replace the `DragAction` type and `dragState` ref block:

```ts
type DragAction =
  | null
  | { kind: 'move'; id: string; startImgX: number; startImgY: number; orig: Box }
  | { kind: 'draw'; startImgX: number; startImgY: number; curImgX: number; curImgY: number }
  | {
      kind: 'resize';
      id: string;
      handle: HandleIndex;
      orig: Box;
      curRect: { x1: number; y1: number; x2: number; y2: number };
    };

const dragState = useRef<DragAction>(null);
```

- [ ] **Step 3: Add handle-hit branch to `handleMouseDown` (runs before box-hit)**

Inside `handleMouseDown`, just after the `readOnly` and `e.evt.button !== 0` guards (before `const hitId = hitTestBox(...)`), insert:

```tsx
// Handle hit only when a box is already selected
const selectedBox = selectedId ? boxes.find((b) => b.id === selectedId) ?? null : null;
const handleIdx = hitTestHandle(p.x, p.y, selectedBox, natW, natH, vp);
if (handleIdx !== -1 && selectedBox) {
  const origRect = boxToImgRect(selectedBox, natW, natH);
  dragState.current = {
    kind: 'resize',
    id: selectedBox.id,
    handle: handleIdx,
    orig: selectedBox,
    curRect: origRect,
  };
  return;
}
```

- [ ] **Step 4: Add resize handling in `handleMouseMove`**

Inside `handleMouseMove`, after the existing `if (dragState.current.kind === 'move')` and `else if (… 'draw') …` branches, add:

```tsx
else if (dragState.current.kind === 'resize') {
  const s = dragState.current;
  const orig = boxToImgRect(s.orig, natW, natH);
  let { x1, y1, x2, y2 } = orig;
  // Handle layout:
  // 0 TL   1 TC   2 TR
  // 3 ML          4 MR
  // 5 BL   6 BC   7 BR
  if (s.handle === 0 || s.handle === 3 || s.handle === 5) x1 = ix;
  if (s.handle === 2 || s.handle === 4 || s.handle === 7) x2 = ix;
  if (s.handle === 0 || s.handle === 1 || s.handle === 2) y1 = iy;
  if (s.handle === 5 || s.handle === 6 || s.handle === 7) y2 = iy;

  s.curRect = { x1, y1, x2, y2 };
  const committed = commitResize(s.orig, { x1, y1, x2, y2 }, natW, natH);
  if (committed) {
    onChange(boxes.map((b) => (b.id === s.id ? committed : b)));
  }
}
```

- [ ] **Step 5: Render handles on selected box**

Inside `renderBox`, replace the existing `return (<Group …> …` block with a version that includes handles:

```tsx
function renderBox(box: Box) {
  const bx = (box.x - box.w / 2) * natW;
  const by = (box.y - box.h / 2) * natH;
  const bw = box.w * natW;
  const bh = box.h * natH;
  const tl = imgToDisp(bx, by, vp);
  const dispW = bw * vp.zoom;
  const dispH = bh * vp.zoom;
  const isSel = selectedId === box.id;
  const color = classColor(box.classIdx);
  return (
    <Group key={box.id}>
      <Rect
        x={tl.x}
        y={tl.y}
        width={dispW}
        height={dispH}
        stroke={color}
        strokeWidth={isSel ? 3 : 2}
        dash={box.source === 'gemini' ? [6, 4] : undefined}
      />
      <Text
        x={tl.x}
        y={tl.y - 14}
        text={`${classes[box.classIdx]?.name ?? '?'}${box.source === 'gemini' ? ' (AI)' : ''}`}
        fontSize={11}
        fontStyle={isSel ? 'bold' : 'normal'}
        fill={color}
      />
      {isSel && !readOnly && renderHandles(tl.x, tl.y, dispW, dispH, color)}
    </Group>
  );
}

function renderHandles(x: number, y: number, w: number, h: number, color: string) {
  const HS = 5; // half-size in px for rendering
  const positions: Array<[number, number]> = [
    [x, y], [x + w / 2, y], [x + w, y],
    [x, y + h / 2],          [x + w, y + h / 2],
    [x, y + h], [x + w / 2, y + h], [x + w, y + h],
  ];
  return positions.map(([hx, hy], i) => (
    <Rect
      key={i}
      x={hx - HS}
      y={hy - HS}
      width={HS * 2}
      height={HS * 2}
      fill="white"
      stroke={color}
      strokeWidth={1}
      listening={false}
    />
  ));
}
```

- [ ] **Step 6: Cursor feedback for handles**

In `handleMouseMoveForHover`, replace the current hover-id update with extended logic that also tracks handle:

```tsx
const [hoverHandleIdx, setHoverHandleIdx] = useState<HandleIndex | -1>(-1);

function handleMouseMoveForHover(e: Konva.KonvaEventObject<MouseEvent>) {
  handleMouseMove(e);
  if (dragState.current || panState.current) return;
  const stage = e.target.getStage();
  const p = stage?.getPointerPosition();
  if (!p) return;
  const selectedBox = selectedId ? boxes.find((b) => b.id === selectedId) ?? null : null;
  const h = hitTestHandle(p.x, p.y, selectedBox, natW, natH, vp);
  if (h !== -1) {
    setHoverHandleIdx(h);
    setHoverBoxId(null);
    return;
  }
  setHoverHandleIdx(-1);
  const id = hitTestBox(p.x, p.y, boxes, natW, natH, vp);
  setHoverBoxId(id);
}
```

Update the `cursor` computed value to prefer handle cursor:

```ts
const cursor = readOnly
  ? panState.current
    ? 'grabbing'
    : 'grab'
  : panState.current
    ? 'grabbing'
    : hoverHandleIdx !== -1
      ? HANDLE_CURSORS[hoverHandleIdx]
      : dragState.current?.kind === 'draw'
        ? 'crosshair'
        : hoverBoxId
          ? 'move'
          : 'crosshair';
```

- [ ] **Step 7: Verify build + manual test**

Run:
```bash
pnpm --dir web build
```

Manual test:
- Select a box → see 8 white-filled handles on corners/edges.
- Hover over TL handle → cursor becomes `nwse-resize`.
- Drag TL handle inward → box shrinks from top-left; release commits.
- Drag BR past TL → box "reverse-flips" and still commits correctly.
- Try resizing to near-zero → no commit (5px min).
- Empty click with no selection → no handles rendered.

- [ ] **Step 8: Commit**

```bash
git add web/components/annotation/AnnotationCanvas.tsx
git commit -m "feat(web): annotation canvas 8-handle resize (with reverse-flip)"
```

---

### Task 1.4: Esc (cancel draw) + final `readOnly` polish

**Files:**
- Modify: `web/components/annotation/AnnotationCanvas.tsx`

After this task: Esc cancels in-progress draw; `readOnly` fully locks bbox interactions but keeps zoom/pan/fit.

- [ ] **Step 1: Add Esc handler inside the canvas**

Inside `AnnotationCanvas`, below the existing `f`-key useEffect, add:

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!dragState.current) return;
    // Cancel in-progress draw. (Move/resize will get full revert in Task 2.1
    // when shadowBox is introduced — in Task 1.4 they already committed
    // frame-by-frame, so Esc just stops further progression.)
    dragState.current = null;
    setDrawPreview(null);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

- [ ] **Step 2: Verify `readOnly` already fully locks interactions**

Re-read `handleMouseDown`. The guard `if (readOnly) return;` after the pan block already skips box-hit/handle-hit/draw when in read-only mode. Only middle/right-click pan is processed — this is exactly what the spec wants.

Re-read `renderBox`. The handle rendering is guarded by `isSel && !readOnly`.

No code changes needed in this task; this is a verification checkpoint.

- [ ] **Step 3: Verify build + manual test**

Run:
```bash
pnpm --dir web build
```

Manual test on editor page:
- Start a draw (drag on empty) → before release, press Esc → preview disappears.
- Middle-drag pan → works.
- Press `f` → fits.

Switch to reviewer tray (`/review/[batchId]`):
- Read-only. No handles visible even if you click a box.
- Wheel zoom works. Middle/right-drag pan works. `f` fits.
- Click on a box does nothing (no selection visual change because `selectedId` is always null).

- [ ] **Step 4: Commit**

```bash
git add web/components/annotation/AnnotationCanvas.tsx
git commit -m "feat(web): annotation canvas Esc cancels in-progress draw"
```

---

# Phase 2 — Editor Page Integration

`editor.tsx` currently has: 2s debounce save, class shortcut (single-action: set active only), S submit, Del key handled inside the old canvas (no longer — old canvas is rewritten). We now:
- Bring Del and Ctrl+Z into the editor (editor owns undo/selected).
- Make class shortcut a dual action.
- Add ←/→ nav with save flush.
- Make Submit and nav flush save first, bail on save failure.

---

### Task 2.1: Undo stack + `onBoxesChange` wrapper + `Del` + `Ctrl+Z` + `Esc`

**Files:**
- Modify: `web/app/(protected)/annotate/[imageId]/editor.tsx`

- [ ] **Step 1: Add undo stack state and wrapper**

In `editor.tsx`, `Box` is already imported on the existing line:

```ts
import type { Box, ClassDef } from '@/components/annotation/types';
```

Add two new imports next to the existing annotation imports:

```ts
import { pushUndo, popUndo } from '@/components/annotation/undo';
import {
  changeSelectedClass,
  deleteSelected,
} from '@/components/annotation/editor-actions';
```

Inside `Editor` function body, add below `useState` for `selectedId`:

```ts
const [undoStack, setUndoStack] = useState<Box[][]>([]);

// `onBoxesChange` is what the canvas calls whenever boxes mutate (draw/move/resize/class/delete).
// It snapshots the OLD boxes into undo stack before setting new.
const onBoxesChange = useCallback(
  (next: Box[]) => {
    setUndoStack((stack) => pushUndo(stack, boxes, 50));
    setBoxes(next);
  },
  [boxes]
);

// Clear selected and undo stack when imageId changes (component re-render for new page).
// Not strictly required because this is a fresh mount per route, but defensive.
useEffect(() => {
  setSelectedId(null);
  setUndoStack([]);
}, [p.imageId]);
```

Change the Canvas `onChange` prop from `setBoxes` to `onBoxesChange`:

```tsx
<AnnotationCanvas
  imageUrl={p.imageUrl}
  classes={p.classes}
  activeClassIdx={activeIdx}
  boxes={boxes}
  onChange={onBoxesChange}
  selectedId={selectedId}
  onSelect={setSelectedId}
/>
```

**Subtle issue**: the canvas currently fires `onChange` during drag (live move/resize). Every frame of drag would push to undo. That's 50 frames → undo cap exhausted in 1 second. Fix: the canvas should only call `onChange` on final commit (release), not during drag. Revisit canvas → but we already call `onChange` inside move drag for live feedback. **Change the canvas instead**: call `onChange` only on drag end; during drag use an internal shadow state.

- [ ] **Step 2: Refactor canvas to only call `onChange` on commit (not on live drag)**

Open `web/components/annotation/AnnotationCanvas.tsx`.

Add a live-drag shadow state at the top of the component body, near `drawPreview`:

```ts
const [shadowBox, setShadowBox] = useState<Box | null>(null); // live preview during move/resize
```

In `handleMouseMove`, replace the `if (dragState.current.kind === 'move')` block:

```tsx
if (dragState.current.kind === 'move') {
  const s = dragState.current;
  const dx = (ix - s.startImgX) / natW;
  const dy = (iy - s.startImgY) / natH;
  setShadowBox(
    clampMoveNorm({
      ...s.orig,
      x: s.orig.x + dx,
      y: s.orig.y + dy,
    })
  );
}
```

Replace the `else if (dragState.current.kind === 'resize')` block:

```tsx
else if (dragState.current.kind === 'resize') {
  const s = dragState.current;
  const orig = boxToImgRect(s.orig, natW, natH);
  let { x1, y1, x2, y2 } = orig;
  if (s.handle === 0 || s.handle === 3 || s.handle === 5) x1 = ix;
  if (s.handle === 2 || s.handle === 4 || s.handle === 7) x2 = ix;
  if (s.handle === 0 || s.handle === 1 || s.handle === 2) y1 = iy;
  if (s.handle === 5 || s.handle === 6 || s.handle === 7) y2 = iy;
  s.curRect = { x1, y1, x2, y2 };
  const committed = commitResize(s.orig, { x1, y1, x2, y2 }, natW, natH);
  if (committed) setShadowBox(committed);
}
```

In `handleMouseUp`, add commit-on-release logic for move and resize:

```tsx
function handleMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
  if (panState.current) {
    panState.current = null;
    return;
  }
  if (!dragState.current) return;
  if (e.evt.button !== 0) return;

  const action = dragState.current;
  dragState.current = null;

  if (action.kind === 'move') {
    if (shadowBox) {
      onChange(boxes.map((b) => (b.id === action.id ? shadowBox : b)));
      setShadowBox(null);
    }
  } else if (action.kind === 'resize') {
    if (shadowBox) {
      onChange(boxes.map((b) => (b.id === action.id ? shadowBox : b)));
      setShadowBox(null);
    }
  } else if (action.kind === 'draw') {
    const dw = Math.abs(action.curImgX - action.startImgX);
    const dh = Math.abs(action.curImgY - action.startImgY);
    if (dw < 5 && dh < 5) {
      onSelect(null);
      setDrawPreview(null);
      return;
    }
    const newBox = commitDraw(
      {
        x1: action.startImgX,
        y1: action.startImgY,
        x2: action.curImgX,
        y2: action.curImgY,
      },
      natW,
      natH,
      activeClassIdx
    );
    setDrawPreview(null);
    if (!newBox) return;
    onChange([...boxes, newBox]);
    onSelect(newBox.id);
  }
}
```

In `renderBox`, substitute shadow box for display when matched:

Above `return` in component, add:

```ts
const displayBoxes = shadowBox
  ? boxes.map((b) => (b.id === shadowBox.id ? shadowBox : b))
  : boxes;
```

Then change `{boxes.map(renderBox)}` → `{displayBoxes.map(renderBox)}`.

Also in the Esc handler (from Task 1.4), add `setShadowBox(null)`:

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!dragState.current) return;
    dragState.current = null;
    setDrawPreview(null);
    setShadowBox(null);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

- [ ] **Step 3: Add Del / Ctrl+Z / Esc keyboard handlers in `editor.tsx`**

In `editor.tsx`, modify the existing keyboard `useEffect` (the one handling `s` and class shortcuts). Extend its body:

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    // Ctrl+Z undo (Mac: metaKey)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      setUndoStack((stack) => {
        const popped = popUndo(stack);
        if (!popped) return stack;
        setBoxes(popped.top);
        setSelectedId(null);
        return popped.stack;
      });
      return;
    }

    // Delete / Backspace → remove selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) {
        e.preventDefault();
        onBoxesChange(deleteSelected(boxes, selectedId));
        setSelectedId(null);
      }
      return;
    }

    // Escape → deselect
    if (e.key === 'Escape') {
      setSelectedId(null);
      return;
    }

    const key = e.key.toLowerCase();

    // Submit takes priority — if user bound 's' to a class, we still submit.
    if (key === 's' && !e.ctrlKey && !e.metaKey) {
      submit();
      return;
    }

    // Class-shortcut dual action (Task 2.2 will extend this; for now: just set active).
    const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
    if (matchByShortcut >= 0) {
      setActiveIdx(matchByShortcut);
      return;
    }

    // Numeric fallback
    if (key >= '1' && key <= '9') {
      const idx = parseInt(key, 10) - 1;
      if (idx < p.classes.length) setActiveIdx(idx);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [submit, p.classes, selectedId, boxes, onBoxesChange]);
```

- [ ] **Step 4: Verify build + manual test**

Run:
```bash
pnpm --dir web build
```

Manual:
- Select a box → press Del → box removed → Ctrl+Z → box restored.
- Draw a new box → Ctrl+Z → box removed.
- Move box → Ctrl+Z → back to original position.
- Resize box → Ctrl+Z → back to original size.
- Press Esc → selection cleared.
- Press Esc during in-progress draw → preview disappears.
- Ctrl+Z 60 times — only 50 of the latest mutations are reversible.

- [ ] **Step 5: Commit**

```bash
git add web/components/annotation/AnnotationCanvas.tsx \
        web/app/\(protected\)/annotate/\[imageId\]/editor.tsx
git commit -m "feat(web): annotation editor undo stack + Del + Ctrl+Z + Esc"
```

---

### Task 2.2: Class shortcut dual action

**Files:**
- Modify: `web/app/(protected)/annotate/[imageId]/editor.tsx`

After this: when a bbox is selected, pressing a class shortcut both changes its class AND sets the active class.

- [ ] **Step 1: Update class shortcut branch in keyboard handler**

In `editor.tsx`, find the keyboard `useEffect`'s class-shortcut branch:

```tsx
const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
if (matchByShortcut >= 0) {
  setActiveIdx(matchByShortcut);
  return;
}
```

Replace with:

```tsx
const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
if (matchByShortcut >= 0) {
  if (selectedId) {
    onBoxesChange(changeSelectedClass(boxes, selectedId, matchByShortcut));
  }
  setActiveIdx(matchByShortcut);
  return;
}
```

Apply the same dual action to the numeric fallback:

```tsx
if (key >= '1' && key <= '9') {
  const idx = parseInt(key, 10) - 1;
  if (idx < p.classes.length) {
    if (selectedId) {
      onBoxesChange(changeSelectedClass(boxes, selectedId, idx));
    }
    setActiveIdx(idx);
  }
}
```

- [ ] **Step 2: Verify build + manual test**

Run `pnpm --dir web build`.

Manual:
- Project with classes `Red` (shortcut `r`) and `Blue` (shortcut `b`).
- Select a Red bbox → press `b` → bbox turns Blue AND active class becomes Blue → next drag on empty draws a Blue box.
- Press `r` with no selection → only active class changes (no bbox mutation).

- [ ] **Step 3: Commit**

```bash
git add web/app/\(protected\)/annotate/\[imageId\]/editor.tsx
git commit -m "feat(web): annotation class shortcut dual action (change selected + set active)"
```

---

### Task 2.3: Flush-save + ←/→ nav + submit flush + unmount flush

**Files:**
- Modify: `web/app/(protected)/annotate/[imageId]/editor.tsx`

- [ ] **Step 1: Replace the debounced save effect with a shared `flushSave` function**

In `editor.tsx`:
1. **Delete** the existing `useEffect` that contains `saveTimer.current = setTimeout(async () => { … }, 2000)`.
2. **Delete** the existing `submit = useCallback(...)` block.
3. Keep the `saveTimer` `useRef` declaration at the top of `Editor`.
4. Insert the following block in place of the deleted code (same vertical position, just after the `saveTimer` ref and `currentIdx`/`nextId` declarations):

```tsx
// Ref to latest boxes for flush. Stays in sync via effect.
const boxesRef = useRef(boxes);
useEffect(() => {
  boxesRef.current = boxes;
}, [boxes]);

const updatedAtRef = useRef(updatedAt);
useEffect(() => {
  updatedAtRef.current = updatedAt;
}, [updatedAt]);

const saveInFlight = useRef(false);
const pendingDirty = useRef(false);

// Perform the save; return whether we ended up with all pending changes persisted.
const doSave = useCallback(async (): Promise<boolean> => {
  if (saveInFlight.current) {
    // Another save is running — don't start a second; mark pending and return true-ish.
    pendingDirty.current = true;
    return true;
  }
  saveInFlight.current = true;
  setStatus('saving...');
  try {
    const res = await fetch(`/api/images/${p.imageId}/annotations`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: updatedAtRef.current,
        boxes: boxesRef.current.map((b) => ({
          classIdx: b.classIdx,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        })),
      }),
    });
    if (res.ok) {
      const json = await res.json();
      setUpdatedAt(json.updatedAt);
      setStatus('saved');
      return true;
    }
    setStatus('save failed');
    return false;
  } finally {
    saveInFlight.current = false;
  }
}, [p.imageId]);

// Debounced auto-save (2s) — replaces the old inline useEffect.
useEffect(() => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(() => {
    doSave();
  }, 2000);
  return () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  };
}, [boxes, doSave]);

// Flush: cancel pending debounce and save immediately. Returns true if persisted.
const flushSave = useCallback(async (): Promise<boolean> => {
  if (saveTimer.current) {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }
  return await doSave();
}, [doSave]);

const submit = useCallback(async () => {
  const ok = await flushSave();
  if (!ok) return;
  setStatus('submitting...');
  const res = await fetch(`/api/images/${p.imageId}/submit`, {
    method: 'POST',
  });
  if (res.ok) {
    if (nextId) router.push(`/annotate/${nextId}`);
    else router.push('/');
  } else {
    setStatus('submit failed');
  }
}, [p.imageId, nextId, router, flushSave]);

// Best-effort flush on unmount (page close, route away outside ←/→).
useEffect(() => {
  return () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Fire-and-forget; we can't await here.
    doSave();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

(The existing `saveTimer` ref declaration at the top of `Editor` stays.)

- [ ] **Step 2: Add ←/→ nav**

First add `prevId` next to the existing `nextId` declaration (at the top of `Editor`):

```ts
const currentIdx = p.queueIds.indexOf(p.imageId);
const nextId = p.queueIds[currentIdx + 1];
const prevId = p.queueIds[currentIdx - 1]; // undefined at index 0
```

Then add a new `useEffect` below the main keyboard handler:

```tsx
useEffect(() => {
  const handler = async (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const targetId = e.key === 'ArrowLeft' ? prevId : nextId;
    if (!targetId) return;
    e.preventDefault();
    const ok = await flushSave();
    if (!ok) return;
    router.push(`/annotate/${targetId}`);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [prevId, nextId, flushSave, router]);
```

- [ ] **Step 3: Verify build + manual test**

Run:
```bash
pnpm --dir web build
```

Manual:
- Draw a box, wait 2s → "saved" appears (unchanged auto-save).
- Draw a box, press `→` immediately → flush triggers; status flickers saving → saved → navigates to next image.
- Simulate save failure (e.g., disconnect DB or throttle network) — pressing `→` does NOT navigate; "save failed" shows. Reconnect → `→` works.
- Press S → flush + submit → navigate.
- Navigate away via browser back (or another nav) → best-effort flush fires.

- [ ] **Step 4: Commit**

```bash
git add web/app/\(protected\)/annotate/\[imageId\]/editor.tsx
git commit -m "feat(web): annotation editor flush-save + ←/→ nav + submit flush"
```

---

### Task 2.4: Update header hint text

**Files:**
- Modify: `web/app/(protected)/annotate/[imageId]/editor.tsx`

- [ ] **Step 1: Update the `<header>` hint span**

Find the `<header>` inside `Editor`'s main column and replace the hint `<span>`:

```tsx
<span>
  wheel zoom · mid/right drag pan · f fit · 1-9 / letters class · S submit
</span>
```

With:

```tsx
<span className="text-right">
  drag: empty→draw · box→move · handle→resize ·
  wheel zoom · mid/right drag pan · f fit ·
  ←/→ nav · 1-9/letters class · Del · Ctrl+Z · Esc · S submit
</span>
```

- [ ] **Step 2: Verify build**

Run:
```bash
pnpm --dir web build
```

- [ ] **Step 3: Commit**

```bash
git add web/app/\(protected\)/annotate/\[imageId\]/editor.tsx
git commit -m "feat(web): annotation editor header hint reflects new shortcuts"
```

---

# Phase 3 — Review Tray

Already wired in Task 1.1. Verify it works end-to-end.

---

### Task 3.1: Verify review tray `readOnly` mode

**Files:**
- Modify (if needed): `web/app/(protected)/review/[batchId]/review-tray.tsx`

- [ ] **Step 1: Verify current props**

Open `web/app/(protected)/review/[batchId]/review-tray.tsx`. Confirm the Canvas invocation includes:

```tsx
<AnnotationCanvas
  imageUrl={current.imageUrl}
  classes={classes}
  activeClassIdx={0}
  boxes={current.boxes}
  onChange={() => {}}
  selectedId={null}
  onSelect={() => {}}
  readOnly
/>
```

If the outer flex container is not yet `flex-1 flex bg-gray-50` (without `items-center justify-center`), fix it (we want the canvas to fill).

- [ ] **Step 2: Manual QA**

Start dev server, sign in as admin or final_reviewer, enter step-up (`frc6998`), open `/review/[batchId]`:
- Image renders, auto-fits.
- Wheel zoom works. `f` fits. Middle/right-drag pans.
- Clicking on a bbox does nothing visual (no selection ring, no handles).
- Space approves, `r` opens reject dialog (existing behavior preserved).

- [ ] **Step 3: Commit (only if anything changed)**

If you made layout adjustments:
```bash
git add web/app/\(protected\)/review/\[batchId\]/review-tray.tsx
git commit -m "feat(web): reviewer tray uses readOnly annotation canvas with zoom/pan"
```

If nothing changed here (Task 1.1 handled it), skip commit — note this in the execution log.

---

# Phase 4 — Final Validation

---

### Task 4.1: Full test + build + lint + manual QA + push

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm --dir web test
```

Expected: all green, including the 4 new unit test files (annotation-viewport, annotation-hit-test, annotation-undo, annotation-actions) and all pre-existing 93 tests.

- [ ] **Step 2: Run build**

```bash
pnpm --dir web build
```

Expected: green, no TypeScript errors.

- [ ] **Step 3: Run lint**

```bash
pnpm --dir web lint
```

Expected: 0 errors. Warnings acceptable if unrelated.

- [ ] **Step 4: Manual QA checklist on dev server**

Start `pnpm --dir web dev`, sign in, use the `test_batch_8.zip` flow from prior sessions if convenient (or any existing batch in assigned state):

**Annotate page (`/annotate/[imageId]`):**
- [ ] Image loads, auto-fits to container on first render.
- [ ] Wheel zoom — point under cursor stays stable.
- [ ] Middle-click drag pans. Right-click drag pans. No context menu appears.
- [ ] `f` key refits to container.
- [ ] Click existing bbox → selected (3px stroke + 8 handles + bold label).
- [ ] Drag selected bbox → moves. Clamped so full bbox stays in [0, 1]. Commits on release.
- [ ] Drag corner handle (TL/TR/BL/BR) → resize, cursor shows `nwse-resize` or `nesw-resize`.
- [ ] Drag edge handle (TC/BC/ML/MR) → 1-axis resize, cursor shows `ns-resize` or `ew-resize`.
- [ ] Drag BR past TL → reverse-flip; stays valid.
- [ ] Drag resize to < 5 px → no commit (box reverts).
- [ ] Drag on empty → dashed yellow preview → release → new box in `activeIdx` color.
- [ ] Very short drag (<5 img-px) on empty → deselect, no box created.
- [ ] Del / Backspace with selection → removes bbox.
- [ ] Ctrl+Z → undo last mutation (draw, move, resize, class change, delete).
- [ ] Esc during draw → cancels preview. Esc otherwise → deselect.
- [ ] Class shortcut (e.g. `r`, `b`, `1`, `2`) with selection → changes class AND sets active.
- [ ] Class shortcut without selection → only sets active.
- [ ] `←` → go to prev image; save flushed first; if save fails, stays.
- [ ] `→` → go to next image; same flush semantics.
- [ ] `S` → flushes save, submits, moves to next in queue.
- [ ] Auto-save status indicator flickers (saving → saved).

**Review tray (`/review/[batchId]`):**
- [ ] Image loads, auto-fits.
- [ ] Wheel zoom, middle/right-drag pan, `f` fit all work.
- [ ] Clicking bboxes does NOT select (no ring, no handles).
- [ ] Space approves (existing). `r` opens reject dialog (existing).

- [ ] **Step 5: Squash-review-free commit history**

Optional: the plan produced ~13 small commits. If you prefer a cleaner history, fast-forward-merge as-is (recommended — each commit is a complete working state). Otherwise leave the individual commits for archaeology.

- [ ] **Step 6: Push to master**

```bash
git push origin master
```

Verify Vercel auto-deploy succeeds (check `https://vercel.com/<team>/frc-annotation/deployments`).

- [ ] **Step 7: Smoke test production**

Open `https://frc-annotation.vercel.app`, sign in, open any annotate page, verify at least: wheel zoom, `f` fit, click bbox select, Del removes, Ctrl+Z restores. If all work, close out.

---

# Appendix A — Task Dependency Graph

```
Phase 0 (pure helpers):    0.1 ─┐
                           0.2 ─┤
                           0.3 ─┤
                           0.4 ─┤
                                ▼
Phase 1 (canvas):               1.1  (scaffold viewport)
                                 │
                                 ▼
                                1.2  (select/move/draw)
                                 │
                                 ▼
                                1.3  (resize handles)
                                 │
                                 ▼
                                1.4  (Esc + readOnly verify)
                                 │
                                 ▼
Phase 2 (editor):               2.1  (undo + Del + Ctrl+Z + Esc)
                                 │
                                 ▼
                                2.2  (class shortcut dual)
                                 │
                                 ▼
                                2.3  (flush + nav + submit)
                                 │
                                 ▼
                                2.4  (help text)
                                 │
                                 ▼
Phase 3:                        3.1  (review tray verify)
                                 │
                                 ▼
Phase 4:                        4.1  (final validation + push)
```

# Appendix B — Rollback Plan

If a Phase 1 or 2 task regresses production after push, revert the specific commit(s):

```bash
git revert <commit-sha>
git push origin master
```

Vercel auto-deploys the revert. All commits are small and focused; reverting one should not cascade. If test passes before push but dev-only issues appear, revert locally and fix-forward.

# Appendix C — Known Non-Goals

Re-stated from design spec §2:
- Do NOT modify API, DB schema, state machine, or class definitions.
- Do NOT implement Redo (Ctrl+Y).
- Do NOT support touchpad pinch zoom (desktop-first).
- Do NOT add Playwright tests (Konva mouse events too flaky).

**Deferred from spec §11 (Integration tests):** The spec listed editor-page jsdom integration tests for ←/→ flush+navigate, class shortcut dual action, and Ctrl+Z. Those are **not** included in this plan — they would require adding `jsdom`, `@testing-library/react`, and `@testing-library/user-event` as dev deps plus a separate vitest env config, which inflates scope beyond the UX upgrade itself. The underlying business logic (`changeSelectedClass`, `deleteSelected`, `pushUndo`/`popUndo`, `commitDraw`, `commitResize`, `clampMoveNorm`) is all fully unit-tested in Phase 0 as pure functions. The editor layer is thin orchestration (fetch + setState), covered by the manual QA checklist in Task 4.1. Add jsdom integration tests in a follow-up plan if regressions appear.

# Appendix D — Divergence from Reference (`label_editor.py`)

Documented in the spec §5.4 but worth repeating:
- Move clamp: web version forces full bbox inside [0, 1]; Python version only clamps center.
- No explicit "Draw mode" — modeless interactions replace `d` key.
- Class toggle: Tab → per-class shortcut (`r`, `b`, …) with dual action.
- Review state (`review_state.json`) is handled by Prisma state machine, not a sidecar JSON.
- No "resume to first unreviewed" — server-side queue order already handles this.
