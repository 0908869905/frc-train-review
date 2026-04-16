import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';

const body = z.object({
  name: z.string().trim().min(1).max(64),
});

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name, displayNameSetAt: new Date() },
  });
  await writeAudit(
    session.user.id,
    'user.display_name_set',
    'user',
    session.user.id,
    { name: parsed.data.name },
  );
  return NextResponse.json({ ok: true });
}
