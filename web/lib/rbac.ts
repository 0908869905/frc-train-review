import { NextResponse } from 'next/server';
import { verifyStepUpCookie, readStepUpCookie, type StepUpScope } from '@/lib/stepup';

export type Role = 'admin' | 'annotator' | 'final_reviewer';

export type Action =
  | 'project.create'
  | 'project.update'
  | 'batch.upload'
  | 'batch.assign'
  | 'image.submit'
  | 'image.annotate'
  | 'image.approve'
  | 'image.reject'
  | 'export.download'
  | 'whitelist.manage';

const MATRIX: Record<Action, Role[]> = {
  'project.create': ['admin'],
  'project.update': ['admin'],
  'batch.upload': ['admin'],
  'batch.assign': ['admin'],
  'image.annotate': ['annotator'],
  'image.submit': ['annotator'],
  'image.approve': ['final_reviewer'],
  'image.reject': ['final_reviewer'],
  'export.download': ['admin'],
  'whitelist.manage': ['admin'],
};

export function canPerform(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function requireRole(
  role: Role | undefined,
  action: Action,
): asserts role is Role {
  if (!role || !canPerform(role, action)) {
    const err = new Error(`Forbidden: role ${role} cannot perform ${action}`);
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'unauthorized') {
    super(message);
  }
}

export class StepUpRequiredError extends Error {
  status = 401;
  constructor(public scope: StepUpScope) {
    super(`step-up required for scope=${scope}`);
  }
}

export function requireStepUp(
  session: { user: { id: string } } | null | undefined,
  scope: StepUpScope,
  request: Request,
): void {
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  const value = readStepUpCookie(request, scope);
  const ok = verifyStepUpCookie(value, {
    userId: session.user.id,
    scope,
  });
  if (!ok) throw new StepUpRequiredError(scope);
}

/**
 * Wraps `requireStepUp` with typed-error-to-Response conversion.
 * Returns a 401 Response on denial (either step-up-required or unauthenticated),
 * or null on success. Callers: `const denial = stepUpOr401(...); if (denial) return denial;`
 *
 * Response body differentiates the two 401 cases so the client can decide
 * between "show password modal" (step_up_required) and "redirect to /login" (unauthorized).
 */
export function stepUpOr401(
  session: { user: { id: string } } | null | undefined,
  scope: StepUpScope,
  request: Request,
): Response | null {
  try {
    requireStepUp(session, scope, request);
    return null;
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      return NextResponse.json(
        { error: 'step_up_required', scope: err.scope },
        { status: 401 },
      );
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }
}
