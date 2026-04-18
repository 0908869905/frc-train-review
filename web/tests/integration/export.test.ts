import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';
import { unzipSync, strFromU8 } from 'fflate';

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
global.fetch = vi.fn(async () => new Response(fakeJpeg)) as typeof fetch;

const { capturedZipRef } = vi.hoisted(() => ({
  capturedZipRef: { current: null as Uint8Array | null },
}));

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string, body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const buf = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      buf.set(c, o);
      o += c.length;
    }
    capturedZipRef.current = buf;
    const fakeUrl = `https://fake.public.blob.vercel-storage.com/${key}`;
    return {
      url: fakeUrl,
      downloadUrl: fakeUrl,
      pathname: key,
      contentType: 'application/zip',
      contentDisposition: `attachment; filename="${key.split('/').pop()}"`,
    };
  }),
}));

describe('POST /api/projects/[id]/export', () => {
  let projectId: string;

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  });

  beforeEach(async () => {
    capturedZipRef.current = null;
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

  it('returns a signed url and packs a valid YOLO zip into blob', async () => {
    const { POST } = await import('@/app/api/projects/[id]/export/route');
    const c = signStepUpCookie({ userId: 'u-admin', scope: 'reviewer' });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { cookie: `${stepUpCookieName('reviewer')}=${c}` },
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      url: string;
      filename: string;
      imageCount: number;
    };
    expect(body.url).toMatch(/\.blob\.vercel-storage\.com\//);
    expect(body.filename).toMatch(/\.zip$/);
    expect(body.imageCount).toBe(1);

    expect(capturedZipRef.current).not.toBeNull();
    const entries = unzipSync(capturedZipRef.current!);
    expect(Object.keys(entries)).toContain('classes.txt');
    expect(Object.keys(entries)).toContain('data.yaml');
    expect(strFromU8(entries['classes.txt'])).toContain('coral');
    const labelKey = Object.keys(entries).find(
      (k) => k.startsWith('labels/') && k.endsWith('.txt'),
    );
    expect(labelKey).toBeTruthy();
    expect(strFromU8(entries[labelKey!])).toContain('0 0.5 0.5 0.2 0.2');
    const imgKey = Object.keys(entries).find(
      (k) => k.startsWith('images/') && k.endsWith('.jpg'),
    );
    expect(imgKey).toBeTruthy();
  });

  it('returns 400 when project has no approved images', async () => {
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    const { POST } = await import('@/app/api/projects/[id]/export/route');
    const c = signStepUpCookie({ userId: 'u-admin', scope: 'reviewer' });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { cookie: `${stepUpCookieName('reviewer')}=${c}` },
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });
});
