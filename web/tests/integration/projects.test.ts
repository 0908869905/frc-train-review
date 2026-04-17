import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

const ADMIN_ID = 'u-admin';
let adminCookie: string;

async function adminSession() {
  await prisma.user.upsert({
    where: { email: 'admin@t' },
    update: {},
    create: { id: ADMIN_ID, email: 'admin@t', role: 'admin' },
  });
  __setFakeSession({
    user: { id: ADMIN_ID, email: 'admin@t', role: 'admin' },
  });
}

beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  adminCookie = `${stepUpCookieName('admin')}=${signStepUpCookie({
    userId: ADMIN_ID,
    scope: 'admin',
  })}`;
});

describe('POST /api/projects', () => {
  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    await adminSession();
  });

  it('creates a project with classes', async () => {
    const { POST } = await import('@/app/api/projects/route');
    const req = new Request('http://x/api/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: 'coral-detector-2026',
        description: 'on-robot coral detection',
        classes: [
          { idx: 0, name: 'coral', color: '#eab308' },
          { idx: 1, name: 'algae', color: '#22c55e' },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const list = await prisma.project.findMany();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('coral-detector-2026');
  });

  it('rejects caller without admin step-up', async () => {
    const { POST } = await import('@/app/api/projects/route');
    const req = new Request('http://x/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', classes: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/projects/[id]', () => {
  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    await adminSession();
  });

  it('updates project name and classes', async () => {
    const p = await prisma.project.create({
      data: {
        name: 'old',
        classes: [{ idx: 0, name: 'a', color: '#ff0000' }],
      },
    });
    const { PATCH } = await import('@/app/api/projects/[id]/route');
    const req = new Request(`http://x/api/projects/${p.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        name: 'new',
        classes: [
          { idx: 0, name: 'a', color: '#ff0000' },
          { idx: 1, name: 'b', color: '#00ff00' },
        ],
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.project.findUnique({ where: { id: p.id } });
    expect(updated?.name).toBe('new');
  });
});
