import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('review flow', () => {
  let imageId: string;

  beforeEach(async () => {
    await prisma.annotation.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
      data: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
    await prisma.user.create({
      data: { id: 'eve', email: 'eve@t', role: 'final_reviewer' },
    });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: {
        projectId: p.id,
        uploaderId: 'alice',
        name: 'b',
        state: 'under_review',
      },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id,
        blobPath: 'x',
        width: 0,
        height: 0,
        assignedToId: 'alice',
        state: 'under_review',
      },
    });
    imageId = img.id;
    __setFakeSession({
      user: { id: 'eve', email: 'eve@t', role: 'final_reviewer' },
    });
  });

  it('approves', async () => {
    const { POST } = await import('@/app/api/images/[id]/approve/route');
    const res = await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: imageId }),
    });
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({
      where: { id: imageId },
    });
    expect(img.state).toBe('approved');
  });

  it('rejects with comment and marks needs_rework', async () => {
    const { POST } = await import('@/app/api/images/[id]/reject/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'box too big' }),
      }),
      { params: Promise.resolve({ id: imageId }) },
    );
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({
      where: { id: imageId },
    });
    expect(img.state).toBe('needs_rework');
    const ev = await prisma.reviewEvent.findFirst({ where: { imageId } });
    expect(ev?.comment).toBe('box too big');
  });

  it('rejects rejection without comment', async () => {
    const { POST } = await import('@/app/api/images/[id]/reject/route');
    await expect(
      POST(
        new Request('http://x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
        { params: Promise.resolve({ id: imageId }) },
      ),
    ).rejects.toThrow();
  });

  it('annotator cannot approve', async () => {
    __setFakeSession({
      user: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
    const { POST } = await import('@/app/api/images/[id]/approve/route');
    await expect(
      POST(new Request('http://x', { method: 'POST' }), {
        params: Promise.resolve({ id: imageId }),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
