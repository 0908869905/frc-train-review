import { describe, it, expect } from 'vitest';
import {
  canTransition,
  type ImageState,
  type Transition,
} from '@/lib/state-machine';

describe('canTransition', () => {
  const cases: Array<[ImageState, Transition, boolean]> = [
    ['unassigned', 'assign', true],
    ['assigned', 'submit', true],
    ['annotated', 'enter_review', true],
    ['under_review', 'approve', true],
    ['under_review', 'reject', true],
    ['needs_rework', 'resubmit', true],
    ['approved', 'assign', false],
    ['assigned', 'approve', false],
    ['unassigned', 'submit', false],
    ['annotated', 'approve', false],
  ];
  for (const [from, action, expected] of cases) {
    it(`${from} --${action}-->${expected ? ' ok' : ' denied'}`, () => {
      expect(canTransition(from, action)).toBe(expected);
    });
  }
});
