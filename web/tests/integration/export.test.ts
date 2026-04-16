import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';
import { unzipSync, strFromU8 } from 'fflate';

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
global.fetch = vi.fn(async () => new Response(fakeJpeg)) as typeof fetch;

describe('GET /api/projects/[id]/export', () => {
  let projectId: string;

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
      data: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
    const p = await prisma.project.create({
      data: {
        name: 'coral',
        classes: [
          { idx: 0, name: 'coral', color: '#eab308' },
          { idx: 1, name: 'algae', color: '#22c55e' },
        ],
      },
    });
    projectId = p.id;
    const b = await prisma.batch.create({
      data: {
        projectId: p.id,
        uploaderId: 'u-admin',
        name: 'b1',
        state: 'completed',
      },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id,
        blobPath: 'https://fake.public.blob.vercel-storage.com/img.jpg',
        width: 0,
        height: 0,
        state: 'approved',
      },
    });
    await prisma.annotation.create({
      data: {
        imageId: img.id,
        classIdx: 0,
        x: 0.5,
        y: 0.5,
        w: 0.2,
        h: 0.2,
        source: 'human',
      },
    });
    __setFakeSession({
      user: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
  });

  it('returns a YOLO zip with approved images', async () => {
    const { GET } = await import('@/app/api/projects/[id]/export/route');
    const c = signStepUpCookie({ userId: 'u-admin', scope: 'reviewer' });
    const res = await GET(
      new Request('http://x', {
        headers: { cookie: `${stepUpCookieName('reviewer')}=${c}` },
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(buf);
    expect(Object.keys(entries)).toContain('classes.txt');
    expect(Object.keys(entries)).toContain('data.yaml');
    expect(strFromU8(entries['classes.txt'])).toContain('coral');
    const labelKey = Object.keys(entries).find(
      (k) => k.startsWith('labels/') && k.endsWith('.txt'),
    );
    expect(labelKey).toBeTruthy();
    expect(strFromU8(entries[labelKey!])).toContain('0 0.5 0.5 0.2 0.2');
  });
});
