/**
 * Generic undo stack helpers. Pure functions — pass a stack in, get a new
 * stack out. State (useState etc) lives in the caller.
 */

export function pushUndo<T>(stack: T[], current: T, cap = 50): T[] {
  const next = [...stack, current];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function popUndo<T>(stack: T[]): { stack: T[]; top: T } | null {
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  return { stack: stack.slice(0, -1), top };
}
