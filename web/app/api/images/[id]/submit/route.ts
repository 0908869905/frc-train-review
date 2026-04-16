import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { canTransition } from '@/lib/state-machine';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const { id } = await params;

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    if (img.assignedToId !== session.user.id) {
      throw Object.assign(new Error('Not your image'), { status: 403 });
    }

    if (img.state === 'assigned' && canTransition('assigned', 'submit')) {
      await tx.image.update({ where: { id }, data: { state: 'annotated' } });
    } else if (
      img.state === 'needs_rework' &&
      canTransition('needs_rework', 'resubmit')
    ) {
      await tx.image.update({
        where: { id },
        data: { state: 'under_review' },
      });
      return;
    } else {
      throw Object.assign(new Error(`Illegal submit from ${img.state}`), {
        status: 409,
      });
    }

    const remaining = await tx.image.count({
      where: { batchId: img.batchId, state: { not: 'annotated' } },
    });
    if (remaining === 0) {
      await tx.image.updateMany({
        where: { batchId: img.batchId, state: 'annotated' },
        data: { state: 'under_review' },
      });
      await tx.batch.update({
        where: { id: img.batchId },
        data: { state: 'under_review' },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
