import { describe, it, expect, beforeAll } from 'vitest';
import { requireStepUp } from '@/lib/rbac';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
});

function makeReq(cookie?: string): Request {
  return new Request('http://localhost/x', {
    headers: cookie ? { cookie } : {},
  });
}

type FakeSession = { user: { id: string } };

describe('requireStepUp', () => {
  it('throws when no session', () => {
    expect(() =>
      requireStepUp(null, 'reviewer', makeReq()),
    ).toThrow(/unauthorized/i);
  });

  it('throws when cookie missing', () => {
    const session: FakeSession = { user: { id: 'u1' } };
    expect(() =>
      requireStepUp(session, 'reviewer', makeReq()),
    ).toThrow(/step-up/i);
  });

  it('throws when cookie for wrong scope', () => {
    const c = signStepUpCookie({ userId: 'u1', scope: 'admin' });
    const session: FakeSession = { user: { id: 'u1' } };
    expect(() =>
      requireStepUp(
        session,
        'reviewer',
        makeReq(`${stepUpCookieName('admin')}=${c}`),
      ),
    ).toThrow(/step-up/i);
  });

  it('passes when cookie valid for scope', () => {
    const c = signStepUpCookie({ userId: 'u1', scope: 'reviewer' });
    const session: FakeSession = { user: { id: 'u1' } };
    expect(() =>
      requireStepUp(
        session,
        'reviewer',
        makeReq(`${stepUpCookieName('reviewer')}=${c}`),
      ),
    ).not.toThrow();
  });

  it('throws when cookie userId does not match session', () => {
    const c = signStepUpCookie({ userId: 'attacker', scope: 'reviewer' });
    const session: FakeSession = { user: { id: 'victim' } };
    expect(() =>
      requireStepUp(
        session,
        'reviewer',
        makeReq(`${stepUpCookieName('reviewer')}=${c}`),
      ),
    ).toThrow(/step-up/i);
  });
});
