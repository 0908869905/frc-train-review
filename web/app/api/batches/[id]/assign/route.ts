import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

const Body = z.object({
  assignments: z
    .array(
      z.object({
        annotatorId: z.string(),
        count: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.assign');
  const { id: batchId } = await params;
  const body = Body.parse(await req.json());

  await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { id: { in: body.assignments.map((a) => a.annotatorId) } },
    });
    if (users.length !== body.assignments.length) {
      throw Object.assign(new Error('Unknown annotator'), { status: 400 });
    }
    for (const u of users) {
      if (u.role !== 'annotator' && u.role !== 'admin') {
        throw Object.assign(new Error(`${u.email} is not an annotator`), {
          status: 400,
        });
      }
    }

    const totalRequested = body.assignments.reduce((s, a) => s + a.count, 0);
    const available = await tx.image.count({
      where: { batchId, state: 'unassigned' },
    });
    if (available < totalRequested) {
      throw Object.assign(
        new Error(
          `Not enough unassigned images (${available} < ${totalRequested})`,
        ),
        { status: 400 },
      );
    }

    for (const a of body.assignments) {
      const toClaim = await tx.image.findMany({
        where: { batchId, state: 'unassigned' },
        take: a.count,
        select: { id: true },
      });
      const ids = toClaim.map((i) => i.id);
      const upd = await tx.image.updateMany({
        where: { id: { in: ids }, state: 'unassigned' },
        data: { state: 'assigned', assignedToId: a.annotatorId },
      });
      if (upd.count !== a.count) {
        throw Object.assign(new Error('Concurrent assign conflict'), {
          status: 409,
        });
      }
    }

    await tx.batch.update({
      where: { id: batchId },
      data: { state: 'in_annotation' },
    });
  });

  await writeAudit(session!.user.id, 'batch.assign', 'batch', batchId, {
    assignments: body.assignments,
  });
  return NextResponse.json({ ok: true });
}
