import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

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
    const { id: batchId } = await params;

    const promoted = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findUnique({ where: { id: batchId } });
      if (!batch) throw new HttpError(404, 'Batch not found');
      if (batch.state !== 'in_annotation' && batch.state !== 'under_review') {
        throw new HttpError(
          409,
          `Cannot promote from batch state=${batch.state}`,
        );
      }

      // Only the annotator(s) who own images in this batch may promote.
      const ownCount = await tx.image.count({
        where: { batchId, assignedToId: session.user.id },
      });
      if (ownCount === 0) {
        throw new HttpError(403, 'No images assigned to you in this batch');
      }

      const { count } = await tx.image.updateMany({
        where: { batchId, state: 'annotated' },
        data: { state: 'under_review' },
      });

      if (batch.state === 'in_annotation') {
        await tx.batch.update({
          where: { id: batchId },
          data: { state: 'under_review' },
        });
      }

      return count;
    });

    await writeAudit(session.user.id, 'batch.promote', 'batch', batchId, {
      promotedImages: promoted,
    });
    return NextResponse.json({ ok: true, promoted });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
