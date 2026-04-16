import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const { id } = await params;
  const img = await prisma.image.findUnique({ where: { id } });
  if (!img) throw Object.assign(new Error('Not found'), { status: 404 });
  return NextResponse.json({ url: img.blobPath });
}
