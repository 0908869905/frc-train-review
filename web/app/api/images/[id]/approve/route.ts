import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { nextState } from '@/lib/state-machine';
import { writeAudit } from '@/lib/audit';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.approve');
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    const to = nextState(img.state, 'approve');
    await tx.image.update({ where: { id }, data: { state: to } });
    await tx.reviewEvent.create({
      data: { imageId: id, reviewerId: session!.user.id, action: 'approve' },
    });

    const remaining = await tx.image.count({
      where: {
        batchId: img.batchId,
        state: {
          in: ['under_review', 'needs_rework', 'assigned', 'annotated'],
        },
      },
    });
    if (remaining === 0) {
      await tx.batch.update({
        where: { id: img.batchId },
        data: { state: 'completed' },
      });
    }
  });

  await writeAudit(session!.user.id, 'image.approve', 'image', id, {});
  return NextResponse.json({ ok: true });
}
