import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('PATCH /api/images/[id]/annotations', () => {
  let imageId: string;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
      data: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: {
        projectId: p.id,
        uploaderId: 'alice',
        name: 'b',
        state: 'in_annotation',
      },
    });
    const img = await prisma.image.create({
      data: {
        batchId: b.id,
        blobPath: 'x',
        width: 0,
        height: 0,
        assignedToId: 'alice',
        state: 'assigned',
      },
    });
    imageId = img.id;
    __setFakeSession({
      user: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
  });

  it('replaces annotations for an assigned image', async () => {
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: img.updatedAt.toISOString(),
        boxes: [{ classIdx: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: imageId }) });
    expect(res.status).toBe(200);
    const ann = await prisma.annotation.findMany({ where: { imageId } });
    expect(ann).toHaveLength(1);
    expect(ann[0].source).toBe('human');
  });

  it('rejects stale write', async () => {
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: new Date('2000-01-01').toISOString(),
        boxes: [],
      }),
    });
    await expect(
      PATCH(req, { params: Promise.resolve({ id: imageId }) }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects when caller is not assignee', async () => {
    __setFakeSession({
      user: { id: 'someone-else', email: 'x@t', role: 'annotator' },
    });
    const { PATCH } = await import('@/app/api/images/[id]/annotations/route');
    const req = new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lastKnownUpdatedAt: new Date().toISOString(),
        boxes: [],
      }),
    });
    await expect(
      PATCH(req, { params: Promise.resolve({ id: imageId }) }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('POST /api/images/[id]/submit', () => {
  let imageId: string;
  let batchId: string;
  let secondImageId: string;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.create({
      data: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'c', color: '#f00' }] },
    });
    const b = await prisma.batch.create({
      data: {
        projectId: p.id,
        uploaderId: 'alice',
        name: 'b',
        state: 'in_annotation',
      },
    });
    batchId = b.id;
    const img1 = await prisma.image.create({
      data: {
        batchId: b.id,
        blobPath: '1',
        width: 0,
        height: 0,
        assignedToId: 'alice',
        state: 'assigned',
      },
    });
    const img2 = await prisma.image.create({
      data: {
        batchId: b.id,
        blobPath: '2',
        width: 0,
        height: 0,
        assignedToId: 'alice',
        state: 'assigned',
      },
    });
    imageId = img1.id;
    secondImageId = img2.id;
    __setFakeSession({
      user: { id: 'alice', email: 'a@t', role: 'annotator' },
    });
  });

  it('marks annotated; does not enter review until all are annotated', async () => {
    const { POST } = await import('@/app/api/images/[id]/submit/route');
    const req = new Request('http://x', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: imageId }) });
    expect(res.status).toBe(200);
    const img = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
    expect(img.state).toBe('annotated');
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.state).toBe('in_annotation');
  });

  it('enters review when last image is submitted', async () => {
    const { POST } = await import('@/app/api/images/[id]/submit/route');
    await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: imageId }),
    });
    await POST(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ id: secondImageId }),
    });
    const images = await prisma.image.findMany({ where: { batchId } });
    expect(images.every((i) => i.state === 'under_review')).toBe(true);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.state).toBe('under_review');
  });
});
