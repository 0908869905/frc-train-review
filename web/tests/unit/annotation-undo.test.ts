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
