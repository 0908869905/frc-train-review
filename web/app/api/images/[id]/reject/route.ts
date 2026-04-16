import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { nextState } from '@/lib/state-machine';
import { writeAudit } from '@/lib/audit';

const Body = z.object({ comment: z.string().min(1).max(500) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.reject');
  const { id } = await params;
  const body = Body.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    const img = await tx.image.findUnique({ where: { id } });
    if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
    const to = nextState(img.state, 'reject');
    await tx.image.update({
      where: { id },
      data: { state: to, assignedToId: img.assignedToId },
    });
    await tx.reviewEvent.create({
      data: {
        imageId: id,
        reviewerId: session!.user.id,
        action: 'reject',
        comment: body.comment,
      },
    });
  });

  await writeAudit(session!.user.id, 'image.reject', 'image', id, {
    comment: body.comment,
  });
  return NextResponse.json({ ok: true });
}
