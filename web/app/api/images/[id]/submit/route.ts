import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { canTransition } from '@/lib/state-machine';

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;

    await prisma.$transaction(async (tx) => {
      const img = await tx.image.findUnique({
        where: { id },
        include: { batch: { select: { state: true } } },
      });
      if (!img) throw new HttpError(404, 'Not found');
      if (img.assignedToId !== session.user.id) {
        throw new HttpError(403, 'Not your image');
      }

      // If the batch is already under review (due to a prior partial
      // promote), fresh submits skip the `annotated` intermediate state so
      // the reviewer sees them immediately.
      const batchPromoted = img.batch.state === 'under_review';

      if (img.state === 'assigned' && canTransition('assigned', 'submit')) {
        await tx.image.update({
          where: { id },
          data: { state: batchPromoted ? 'under_review' : 'annotated' },
        });
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
        throw new HttpError(409, `Illegal submit from ${img.state}`);
      }

      if (batchPromoted) return;

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
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
