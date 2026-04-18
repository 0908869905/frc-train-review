import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

const Box = z.object({
  classIdx: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const Body = z.object({
  lastKnownUpdatedAt: z.iso.datetime(),
  boxes: z.array(Box),
});

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { id } = await params;
    const body = Body.parse(await req.json());
    const lastKnown = new Date(body.lastKnownUpdatedAt);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Single updateMany combines: existence + assignedTo check + state check
      // + optimistic concurrency (updatedAt CAS) + updatedAt bump.
      // If count != 1, we can't tell which condition failed; client retries /
      // refreshes. Server returns 409; page.tsx will reload fresh state.
      const bumped = await tx.image.updateMany({
        where: {
          id,
          assignedToId: session.user.id,
          state: { in: ['assigned', 'needs_rework'] },
          updatedAt: lastKnown,
        },
        data: { updatedAt: now },
      });
      if (bumped.count !== 1) {
        throw new HttpError(409, 'Stale write or not editable');
      }

      await tx.annotation.deleteMany({ where: { imageId: id } });
      if (body.boxes.length > 0) {
        await tx.annotation.createMany({
          data: body.boxes.map((b) => ({
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
    });

    return NextResponse.json({ updatedAt: now.toISOString() });
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
