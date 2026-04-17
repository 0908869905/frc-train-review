import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string) => ({
    url: `https://fake-blob.local/${key}`,
    pathname: key,
  })),
  del: vi.fn(async () => {}),
}));

describe('POST /api/batches/[id]/finalize', () => {
  let adminCookie: string;

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
    adminCookie = `${stepUpCookieName('admin')}=${signStepUpCookie({
      userId: 'u-admin',
      scope: 'admin',
    })}`;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
      data: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
    __setFakeSession({
      user: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
  });

  it('parses zip and creates images + gemini annotations', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'p1',
        classes: [
          { idx: 0, name: 'a', color: '#ff0000' },
          { idx: 1, name: 'b', color: '#00ff00' },
        ],
      },
    });
    const batch = await prisma.batch.create({
      data: {
        projectId: project.id,
        uploaderId: 'u-admin',
        name: 'b1',
        state: 'pending_upload',
      },
    });

    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const zipBuf = zipSync({
      'images/001.jpg': fakeJpeg,
      'images/002.jpg': fakeJpeg,
      'labels/001.txt': strToU8('0 0.5 0.5 0.2 0.2\n'),
      'labels/002.txt': strToU8('1 0.3 0.3 0.1 0.1\n'),
      'classes.txt': strToU8('a\nb\n'),
    });

    global.fetch = vi.fn(async () => new Response(zipBuf)) as typeof fetch;

    const { POST } = await import('@/app/api/batches/[id]/finalize/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        zipUrl: 'https://test-tenant.public.blob.vercel-storage.com/zip',
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: batch.id }) });
    expect(res.status).toBe(200);

    const images = await prisma.image.findMany({ where: { batchId: batch.id } });
    expect(images).toHaveLength(2);
    const anns = await prisma.annotation.findMany();
    expect(anns).toHaveLength(2);
    expect(anns.every((a) => a.source === 'gemini')).toBe(true);

    const updated = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(updated?.state).toBe('ready');
  });
});
