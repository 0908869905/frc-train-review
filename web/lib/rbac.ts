import { verifyStepUpCookie, stepUpCookieName, type StepUpScope } from '@/lib/stepup';
import type { Session } from 'next-auth';

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

export class StepUpRequiredError extends Error {
  constructor(public scope: StepUpScope) {
    super(`step-up required for scope=${scope}`);
  }
}

export function requireStepUp(
  session: Session | null,
  scope: StepUpScope,
  request: Request,
): void {
  if (!session?.user?.id) {
    throw new Error('unauthorized');
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${stepUpCookieName(scope)}=`));
  const value = match?.slice(match.indexOf('=') + 1);
  const ok = verifyStepUpCookie(value, {
    userId: session.user.id,
    scope,
  });
  if (!ok) throw new StepUpRequiredError(scope);
}
