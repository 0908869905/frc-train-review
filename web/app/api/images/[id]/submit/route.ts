import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { canTransition } from '@/lib/state-machine';

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

const Box = z.object({
  classIdx: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

// Combined save-and-submit: when `boxes` + `lastKnownUpdatedAt` are provided
// we persist the final box set in the same transaction that flips image state.
// Both fields are optional for backward compat with clients that still do a
// separate PATCH /annotations before submitting.
const Body = z
  .object({
    lastKnownUpdatedAt: z.iso.datetime().optional(),
    boxes: z.array(Box).optional(),
  })
  .optional();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;

    const rawBody = await req.text();
    const parsedBody = rawBody
      ? Body.parse(JSON.parse(rawBody))
      : undefined;
    const hasBoxes =
      !!parsedBody?.boxes && !!parsedBody.lastKnownUpdatedAt;

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

      let newState: 'annotated' | 'under_review';
      if (img.state === 'assigned' && canTransition('assigned', 'submit')) {
        newState = batchPromoted ? 'under_review' : 'annotated';
      } else if (
        img.state === 'needs_rework' &&
        canTransition('needs_rework', 'resubmit')
      ) {
        newState = 'under_review';
      } else {
        throw new HttpError(409, `Illegal submit from ${img.state}`);
      }

      if (hasBoxes) {
        const now = new Date();
        // No updatedAt CAS here — submit runs optimistically alongside any
        // in-flight autosave PATCH. The state match (`state: img.state`) is
        // enough: the first writer wins, the second's state check fails
        // harmlessly (submit after submit → 409; submit after autosave →
        // submit still wins because state was `assigned` when this tx opened).
        const bumped = await tx.image.updateMany({
          where: {
            id,
            assignedToId: session.user.id,
            state: img.state,
          },
          data: { updatedAt: now, state: newState },
        });
        if (bumped.count !== 1) {
          throw new HttpError(409, 'State changed');
        }
        await tx.annotation.deleteMany({ where: { imageId: id } });
        const incoming = parsedBody!.boxes!;
        if (incoming.length > 0) {
          await tx.annotation.createMany({
            data: incoming.map((b) => ({
              imageId: id,
              classIdx: b.classIdx,
              x: b.x,
              y: b.y,
              w: b.w,
              h: b.h,
              source: 'human' as const,
              authorId: session.user.id,
            })),
          });
        }
      } else {
        await tx.image.update({
          where: { id },
          data: { state: newState },
        });
      }

      // Only need to check batch completion if we flipped to `annotated`
      // (still waiting for the whole batch); if newState === 'under_review'
      // either batch was already promoted or it's a resubmit of a previously
      // rejected image — no batch.state transition needed here.
      if (newState === 'annotated') {
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
      }
    });

    return NextResponse.json({ ok: true });
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
