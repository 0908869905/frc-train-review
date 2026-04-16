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
