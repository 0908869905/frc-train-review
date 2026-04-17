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
