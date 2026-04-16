import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, stepUpOr401 } from '@/lib/rbac';

const PostBody = z.object({
  email: z.email(),
  role: z.enum(['admin', 'annotator', 'final_reviewer']),
});

export async function GET(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const denial = stepUpOr401(session, 'admin', req);
  if (denial) return denial;
  const rows = await prisma.emailWhitelist.findMany({
    orderBy: { addedAt: 'asc' },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const denial = stepUpOr401(session, 'admin', req);
  if (denial) return denial;
  const body = PostBody.parse(await req.json());
  const row = await prisma.emailWhitelist.upsert({
    where: { email: body.email },
    update: { role: body.role },
    create: {
      email: body.email,
      role: body.role,
      addedById: session!.user.id,
    },
  });
  return NextResponse.json(row);
}
