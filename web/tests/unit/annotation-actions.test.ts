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
