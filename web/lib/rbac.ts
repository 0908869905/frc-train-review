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

// Actions gated by step-up password. Actions not in this map only require
// authentication (any logged-in user).
const ACTION_SCOPE: Partial<Record<Action, StepUpScope>> = {
  'project.create': 'admin',
  'project.update': 'admin',
  'batch.upload': 'admin',
  'batch.assign': 'admin',
  'whitelist.manage': 'admin',
  'export.download': 'reviewer',
  'image.approve': 'reviewer',
  'image.reject': 'reviewer',
};

export function actionStepUpScope(action: Action): StepUpScope | undefined {
  return ACTION_SCOPE[action];
}

const ROLE_MATRIX: Record<Action, Role[]> = {
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

// Legacy role-matrix check. No longer used by routes (which now use
// requireAuthz / authzOr401 against step-up), retained for unit tests that
// document intended role semantics.
export function canPerform(role: Role, action: Action): boolean {
  return ROLE_MATRIX[action].includes(role);
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
): NextResponse | null {
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

/**
 * Step-up-only authorization for API routes. Any logged-in user can perform
 * actions that are not step-up-gated (annotate / submit). For gated actions,
 * the caller must also have a valid step-up cookie for the matching scope.
 *
 * Throws UnauthorizedError when the request is unauthenticated, or
 * StepUpRequiredError when step-up is required but the cookie is missing or
 * invalid. Role is ignored — password knowledge is the sole gate.
 */
export function requireAuthz(
  session: { user: { id: string } } | null | undefined,
  action: Action,
  request: Request,
): void {
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  const scope = ACTION_SCOPE[action];
  if (!scope) return;
  const value = readStepUpCookie(request, scope);
  const ok = verifyStepUpCookie(value, { userId: session.user.id, scope });
  if (!ok) throw new StepUpRequiredError(scope);
}

/**
 * Response-returning wrapper for requireAuthz. Callers use:
 * `const denial = authzOr401(session, 'project.create', req); if (denial) return denial;`
 */
export function authzOr401(
  session: { user: { id: string } } | null | undefined,
  action: Action,
  request: Request,
): NextResponse | null {
  try {
    requireAuthz(session, action, request);
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
