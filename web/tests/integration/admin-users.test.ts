import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

const ADMIN_ID = 'test-admin';
let adminStepUpCookie: string;

describe('POST /api/admin/users', () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
    adminStepUpCookie = `${stepUpCookieName('admin')}=${signStepUpCookie({
      userId: ADMIN_ID,
      scope: 'admin',
    })}`;
  });

  beforeEach(async () => {
    await prisma.emailWhitelist.deleteMany();
    const { __setFakeSession } = await import('@/lib/auth-test');
    __setFakeSession({
      user: { id: ADMIN_ID, email: 'admin@test', role: 'admin' },
    });
    await prisma.user.upsert({
      where: { email: 'admin@test' },
      update: {},
      create: { id: ADMIN_ID, email: 'admin@test', role: 'admin' },
    });
  });

  it('adds email to whitelist', async () => {
    const { POST } = await import('@/app/api/admin/users/route');
    const req = new Request('http://x/api/admin/users', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminStepUpCookie,
      },
      body: JSON.stringify({ email: 'alice@example.com', role: 'annotator' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const row = await prisma.emailWhitelist.findUnique({
      where: { email: 'alice@example.com' },
    });
    expect(row?.role).toBe('annotator');
  });

  it('rejects non-admin with 403', async () => {
    const { __setFakeSession } = await import('@/lib/auth-test');
    __setFakeSession({
      user: { id: 'not-admin', email: 'b@test', role: 'annotator' },
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const req = new Request('http://x/api/admin/users', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminStepUpCookie,
      },
      body: JSON.stringify({ email: 'x@y.z', role: 'annotator' }),
    });
    await expect(POST(req)).rejects.toMatchObject({ status: 403 });
  });
});
