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
    // 1920x1080 image in 800x600 container: limit is width (800/1920)
    const vp = computeFitView(1920, 1080, 800, 600);
    expect(vp.zoom).toBeCloseTo(800 / 1920, 6);
    expect(vp.pan.x).toBeCloseTo(0, 6); // centered; width exactly fills
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
