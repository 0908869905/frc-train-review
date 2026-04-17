import type { Role } from '@/lib/rbac';

export type FakeSession =
  | {
      user: {
        id: string;
        email: string;
        role: Role;
        name?: string | null;
      };
    }
  | null;

let fake: FakeSession = null;

export function __setFakeSession(s: FakeSession) {
  fake = s;
}

export function __getFakeSession() {
  return fake;
}
