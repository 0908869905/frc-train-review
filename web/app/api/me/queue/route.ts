import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const images = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      batchId: true,
      state: true,
      blobPath: true,
      batch: {
        select: {
          id: true,
          name: true,
          projectId: true,
          project: { select: { name: true, classes: true } },
        },
      },
    },
  });
  return NextResponse.json(images);
}
