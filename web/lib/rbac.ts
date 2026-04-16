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
