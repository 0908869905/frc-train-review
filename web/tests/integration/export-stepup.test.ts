import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/projects/[id]/export/route';
import { __setFakeSession } from '@/lib/auth-test';
import { signStepUpCookie, stepUpCookieName } from '@/lib/stepup';

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
global.fetch = vi.fn(async () => new Response(fakeJpeg)) as typeof fetch;

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string, body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
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

let reviewerId: string;
let annotatorId: string;
let projectId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = 'test-secret-min-32-chars-please';
  await prisma.auditLog.deleteMany({});
  await prisma.reviewEvent.deleteMany({});
  await prisma.annotation.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.emailWhitelist.deleteMany({});
  await prisma.user.deleteMany({});

  await prisma.emailWhitelist.create({
    data: { email: 'r@t.com', role: 'final_reviewer' },
  });
  const r = await prisma.user.create({
    data: { email: 'r@t.com', name: 'R', role: 'final_reviewer' },
  });
  reviewerId = r.id;

  await prisma.emailWhitelist.create({
    data: { email: 'n@t.com', role: 'annotator' },
  });
  const n = await prisma.user.create({
    data: { email: 'n@t.com', name: 'N', role: 'annotator' },
  });
  annotatorId = n.id;

  const p = await prisma.project.create({
    data: {
      name: 'P',
      classes: [{ idx: 0, name: 'c', color: '#000' }],
    },
  });
  projectId = p.id;
  const b = await prisma.batch.create({
    data: {
      projectId,
      uploaderId: reviewerId,
      name: 'B',
      state: 'completed',
    },
  });
  await prisma.image.create({
    data: {
      batchId: b.id,
      blobPath: 'https://example.blob.vercel-storage.com/img.jpg',
      width: 100,
      height: 100,
      state: 'approved',
    },
  });
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

function makeReq(cookie?: string): Request {
  return new Request(`http://localhost/api/projects/${projectId}/export`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

describe('POST /api/projects/[id]/export — scope relaxation + step-up', () => {
  it('401 as final_reviewer without cookie', async () => {
    __setFakeSession({
      user: { id: reviewerId, email: 'r@t.com', role: 'final_reviewer' },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(401);
  });

  it('200 as final_reviewer with reviewer cookie', async () => {
    __setFakeSession({
      user: { id: reviewerId, email: 'r@t.com', role: 'final_reviewer' },
    });
    const c = signStepUpCookie({ userId: reviewerId, scope: 'reviewer' });
    const res = await POST(makeReq(`${stepUpCookieName('reviewer')}=${c}`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
  });

  it('200 as any logged-in user with reviewer cookie (role is no longer a gate)', async () => {
    __setFakeSession({
      user: { id: annotatorId, email: 'n@t.com', role: 'annotator' },
    });
    const c = signStepUpCookie({ userId: annotatorId, scope: 'reviewer' });
    const res = await POST(makeReq(`${stepUpCookieName('reviewer')}=${c}`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
  });

  it('401 as final_reviewer with admin cookie (wrong scope)', async () => {
    __setFakeSession({
      user: { id: reviewerId, email: 'r@t.com', role: 'final_reviewer' },
    });
    const c = signStepUpCookie({ userId: reviewerId, scope: 'admin' });
    const res = await POST(makeReq(`${stepUpCookieName('admin')}=${c}`), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(401);
  });
});
