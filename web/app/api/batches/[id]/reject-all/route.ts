import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

const Body = z.object({ comment: z.string().min(1).max(500) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    const denial = authzOr401(session, 'image.reject', req);
    if (denial) return denial;
    const { id: batchId } = await params;
    const { comment } = Body.parse(await req.json());
    const reviewerId = session!.user.id;

    const rejected = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findUnique({ where: { id: batchId } });
      if (!batch) throw new HttpError(404, 'Batch not found');
      if (batch.state !== 'under_review') {
        throw new HttpError(409, `Cannot reject-all from state=${batch.state}`);
      }

      const images = await tx.image.findMany({
        where: { batchId, state: 'under_review' },
        select: { id: true },
      });
      if (images.length === 0) {
        throw new HttpError(400, '這批已經沒有待審圖了');
      }

      await tx.image.updateMany({
        where: { batchId, state: 'under_review' },
        data: { state: 'needs_rework' },
      });

      await tx.reviewEvent.createMany({
        data: images.map((img) => ({
          imageId: img.id,
          reviewerId,
          action: 'reject' as const,
          comment,
        })),
      });

      // Batch returns to annotation phase so it clears out of the reviewer
      // dashboard. submit route re-flips batch → under_review when the
      // annotator resubmits any of these images.
      await tx.batch.update({
        where: { id: batchId },
        data: { state: 'in_annotation' },
      });

      return images.length;
    });

    await writeAudit(reviewerId, 'batch.reject_all', 'batch', batchId, {
      rejectedImages: rejected,
      comment,
    });
    return NextResponse.json({ ok: true, rejected });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    throw e;
  }
}
