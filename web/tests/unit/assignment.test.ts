import { describe, it, expect } from 'vitest';
import { splitEvenly } from '@/lib/assignment';

describe('splitEvenly', () => {
  it('divides 100 items across 4 people', () => {
    const r = splitEvenly(100, 4);
    expect(r).toEqual([25, 25, 25, 25]);
  });
  it('handles remainder', () => {
    const r = splitEvenly(103, 4);
    expect(r).toEqual([26, 26, 26, 25]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(103);
  });
  it('handles 0 items', () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
  });
  it('throws on 0 people', () => {
    expect(() => splitEvenly(10, 0)).toThrow();
  });
});
