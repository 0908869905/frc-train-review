import { describe, it, expect } from 'vitest';
import { parseYoloLabel, serializeYoloLabel, parseClassesTxt } from '@/lib/yolo';

describe('parseYoloLabel', () => {
  it('parses YOLO format correctly', () => {
    const txt = '0 0.5 0.5 0.2 0.3\n1 0.75 0.25 0.1 0.1\n';
    const boxes = parseYoloLabel(txt);
    expect(boxes).toEqual([
      { classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 },
      { classIdx: 1, x: 0.75, y: 0.25, w: 0.1, h: 0.1 },
    ]);
  });

  it('ignores blank lines', () => {
    expect(parseYoloLabel('\n0 0.1 0.1 0.1 0.1\n\n')).toHaveLength(1);
  });

  it('rejects out-of-range coords', () => {
    expect(() => parseYoloLabel('0 1.2 0.5 0.2 0.3')).toThrow();
  });

  it('rejects negative class', () => {
    expect(() => parseYoloLabel('-1 0.5 0.5 0.2 0.3')).toThrow();
  });
});

describe('serializeYoloLabel', () => {
  it('round-trips with parse', () => {
    const boxes = [{ classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 }];
    expect(parseYoloLabel(serializeYoloLabel(boxes))).toEqual(boxes);
  });
});

describe('parseClassesTxt', () => {
  it('parses one class per line', () => {
    expect(parseClassesTxt('coral\nalgae\napriltag\n')).toEqual([
      'coral',
      'algae',
      'apriltag',
    ]);
  });
});
