import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { __setFakeSession } from '@/lib/auth-test';

describe('POST /api/batches/[id]/assign', () => {
  let batchId: string;
  const IMAGE_IDS: string[] = [];

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.reviewEvent.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
    IMAGE_IDS.length = 0;

    const admin = await prisma.user.create({
      data: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
    await prisma.user.create({
      data: { id: 'alice', email: 'alice@t', role: 'annotator' },
    });
    await prisma.user.create({
      data: { id: 'bob', email: 'bob@t', role: 'annotator' },
    });
    const p = await prisma.project.create({
      data: { name: 'p', classes: [{ idx: 0, name: 'a', color: '#f00' }] },
    });
    const batch = await prisma.batch.create({
      data: {
        projectId: p.id,
        uploaderId: admin.id,
        name: 'b',
        state: 'ready',
      },
    });
    batchId = batch.id;
    for (let i = 0; i < 6; i++) {
      const img = await prisma.image.create({
        data: { batchId: batch.id, blobPath: `u${i}`, width: 0, height: 0 },
      });
      IMAGE_IDS.push(img.id);
    }
    __setFakeSession({
      user: { id: 'u-admin', email: 'a@t', role: 'admin' },
    });
  });

  it('assigns images evenly to annotators', async () => {
    const { POST } = await import('@/app/api/batches/[id]/assign/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignments: [
          { annotatorId: 'alice', count: 3 },
          { annotatorId: 'bob', count: 3 },
        ],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: batchId }) });
    expect(res.status).toBe(200);
    const alice = await prisma.image.count({
      where: { assignedToId: 'alice' },
    });
    const bob = await prisma.image.count({
      where: { assignedToId: 'bob' },
    });
    expect(alice).toBe(3);
    expect(bob).toBe(3);
    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    expect(batch?.state).toBe('in_annotation');
  });

  it('rejects if requested count exceeds unassigned pool', async () => {
    const { POST } = await import('@/app/api/batches/[id]/assign/route');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignments: [{ annotatorId: 'alice', count: 100 }],
      }),
    });
    await expect(
      POST(req, { params: Promise.resolve({ id: batchId }) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
