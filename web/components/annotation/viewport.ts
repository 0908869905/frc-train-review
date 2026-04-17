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
