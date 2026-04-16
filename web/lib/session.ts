import { __getFakeSession, type FakeSession } from '@/lib/auth-test';

export async function getSession(): Promise<FakeSession> {
  if (process.env.NODE_ENV === 'test') {
    return __getFakeSession();
  }
  const { auth } = await import('@/lib/auth');
  const s = await auth();
  return s as unknown as FakeSession;
}
