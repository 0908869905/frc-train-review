import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/me/display-name/route';
import { __setFakeSession } from '@/lib/auth-test';

let userId: string;

beforeAll(async () => {
  // FK-safe cleanup: follow the pattern from stepup-api.test.ts
  await prisma.auditLog.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.create({
    data: { email: 'a@test.com', role: 'annotator' },
  });
  const u = await prisma.user.create({
    data: { email: 'a@test.com', name: null, role: 'annotator' },
  });
  userId = u.id;
});

beforeEach(() => {
  __setFakeSession({ user: { id: userId, email: 'a@test.com', role: 'annotator' } });
});

afterAll(async () => {
  __setFakeSession(null);
  await prisma.auditLog.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
});

function req(body: object | null) {
  return new Request('http://localhost/api/me/display-name', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: body === null ? undefined : JSON.stringify(body),
  });
}

describe('PATCH /api/me/display-name', () => {
  it('401 when unauthenticated', async () => {
    __setFakeSession(null);
    const res = await PATCH(req({ name: '張小明' }));
    expect(res.status).toBe(401);
  });

  it('rejects empty name', async () => {
    const res = await PATCH(req({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only name', async () => {
    const res = await PATCH(req({ name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('rejects overly long name (>64 chars)', async () => {
    const res = await PATCH(req({ name: 'x'.repeat(200) }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed body', async () => {
    const res = await PATCH(req({ wrongKey: 'x' }));
    expect(res.status).toBe(400);
  });

  it('updates name and stamps displayNameSetAt', async () => {
    const res = await PATCH(req({ name: '張小明' }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.name).toBe('張小明');
    expect(u?.displayNameSetAt).not.toBeNull();
  });

  it('writes audit log with action=user.display_name_set', async () => {
    await prisma.auditLog.deleteMany({});
    await PATCH(req({ name: 'Alice Chen' }));
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.display_name_set', actorId: userId },
    });
    expect(audit).not.toBeNull();
  });

  it('trims surrounding whitespace', async () => {
    await PATCH(req({ name: '  李小華  ' }));
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u?.name).toBe('李小華');
  });
});
