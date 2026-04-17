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
