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

    const refreshed = await prisma.$transaction(async (tx) => {
      const image = await tx.image.findUnique({ where: { id } });
      if (!image) throw new HttpError(404, 'Not found');
      if (image.assignedToId !== session.user.id) {
        throw new HttpError(403, 'Not your image');
      }
      if (image.state !== 'assigned' && image.state !== 'needs_rework') {
        throw new HttpError(409, `Cannot edit in state ${image.state}`);
      }

      const now = new Date();
      const bumped = await tx.image.updateMany({
        where: { id, updatedAt: lastKnown },
        data: { updatedAt: now },
      });
      if (bumped.count !== 1) {
        throw new HttpError(409, 'Stale write');
      }

      await tx.annotation.deleteMany({ where: { imageId: id } });
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

      return tx.image.findUniqueOrThrow({ where: { id } });
    });

    return NextResponse.json({ updatedAt: refreshed.updatedAt });
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
