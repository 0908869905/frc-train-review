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

// A box centered at (0.5, 0.5) with size 0.2 x 0.4 → image rect (400, 150)→(600, 350)
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
    // display (500, 250) at zoom=1 pan=0 → image (500, 250) inside box1 (400..600, 150..350)
    expect(hitTestBox(500, 250, [box1], natW, natH, vp)).toBe('a');
  });

  it('prefers later boxes in array (top-most z-order)', () => {
    // Both boxes cover (100, 50) when we inflate box2 coverage? box2 only covers (50-150, 25-75)
    // box1 covers (400-600, 100-300). Put them overlapping — use a different box:
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
    // MR = (600, 250) middle of right edge
    expect(hitTestHandle(600, 250, box1, natW, natH, vp)).toBe(4);
  });

  it('detects BR handle (7) — bottom-right', () => {
    expect(hitTestHandle(600, 350, box1, natW, natH, vp)).toBe(7);
  });

  it('returns -1 when far from any handle', () => {
    expect(hitTestHandle(500, 250, box1, natW, natH, vp)).toBe(-1);
  });

  it('respects hit radius (9 px default)', () => {
    // 8px offset from TL (400, 150) → hit
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
