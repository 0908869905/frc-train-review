import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { verifyStepUpCookie, readStepUpCookie } from '@/lib/stepup';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const { id } = await params;
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw Object.assign(new Error('Not found'), { status: 404 });

  const userId = session.user.id;
  const hasReviewer = verifyStepUpCookie(
    readStepUpCookie(req, 'reviewer'),
    { userId, scope: 'reviewer' },
  );
  const hasAdmin = verifyStepUpCookie(
    readStepUpCookie(req, 'admin'),
    { userId, scope: 'admin' },
  );
  const isPrivileged = hasReviewer || hasAdmin;
  if (!isPrivileged && img.assignedToId !== userId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return NextResponse.json({ url: img.blobPath });
}
