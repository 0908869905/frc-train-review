import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';

const InitBody = z.object({
  name: z.string().min(1).max(128),
  source: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const denial = authzOr401(session, 'batch.upload', req);
  if (denial) return denial;
  const { id: projectId } = await params;

  const body = InitBody.parse(await req.json());
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }

  const batch = await prisma.batch.create({
    data: {
      projectId,
      uploaderId: session!.user.id,
      name: body.name,
      source: body.source,
      state: 'pending_upload',
    },
  });
  return NextResponse.json({ batchId: batch.id });
}
