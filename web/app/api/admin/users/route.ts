import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  requireRole,
  requireStepUp,
  StepUpRequiredError,
  UnauthorizedError,
} from '@/lib/rbac';

const PostBody = z.object({
  email: z.email(),
  role: z.enum(['admin', 'annotator', 'final_reviewer']),
});

export async function GET() {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const rows = await prisma.emailWhitelist.findMany({
    orderBy: { addedAt: 'asc' },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  try {
    requireStepUp(session, 'admin', req);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      return NextResponse.json(
        { error: 'step_up_required', scope: err.scope },
        { status: 401 },
      );
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }
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
