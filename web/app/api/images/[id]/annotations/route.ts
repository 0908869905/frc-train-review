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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const { id } = await params;
  const body = Body.parse(await req.json());

  const lastKnown = new Date(body.lastKnownUpdatedAt);

  const refreshed = await prisma.$transaction(async (tx) => {
    const image = await tx.image.findUnique({ where: { id } });
    if (!image) throw Object.assign(new Error('Not found'), { status: 404 });
    if (image.assignedToId !== session.user.id) {
      throw Object.assign(new Error('Not your image'), { status: 403 });
    }
    if (image.state !== 'assigned' && image.state !== 'needs_rework') {
      throw Object.assign(new Error(`Cannot edit in state ${image.state}`), {
        status: 409,
      });
    }

    // Atomic stale check: only flip updatedAt if it still matches lastKnown.
    const now = new Date();
    const bumped = await tx.image.updateMany({
      where: { id, updatedAt: lastKnown },
      data: { updatedAt: now },
    });
    if (bumped.count !== 1) {
      throw Object.assign(new Error('Stale write'), { status: 409 });
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
}
