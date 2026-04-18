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
    const { id } = await params;

    await prisma.$transaction(async (tx) => {
      const img = await tx.image.findUnique({ where: { id } });
      if (!img) throw new HttpError(404, 'Not found');
      if (img.assignedToId !== session.user.id) {
        throw new HttpError(403, 'Not your image');
      }
      if (img.state !== 'annotated') {
        throw new HttpError(
          409,
          `Cannot unsubmit from ${img.state} (only annotated images can be unsubmitted)`,
        );
      }
      await tx.image.update({
        where: { id },
        data: { state: 'assigned' },
      });
    });

    await writeAudit(session.user.id, 'image.unsubmit', 'image', id, {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
