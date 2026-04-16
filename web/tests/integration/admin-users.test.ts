import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

describe('POST /api/admin/users', () => {
  beforeEach(async () => {
    await prisma.emailWhitelist.deleteMany();
    const { __setFakeSession } = await import('@/lib/auth-test');
    __setFakeSession({
      user: { id: 'test-admin', email: 'admin@test', role: 'admin' },
    });
    await prisma.user.upsert({
      where: { email: 'admin@test' },
      update: {},
      create: { id: 'test-admin', email: 'admin@test', role: 'admin' },
    });
  });

  it('adds email to whitelist', async () => {
    const { POST } = await import('@/app/api/admin/users/route');
    const req = new Request('http://x/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z', role: 'annotator' }),
    });
    await expect(POST(req)).rejects.toMatchObject({ status: 403 });
  });
});
