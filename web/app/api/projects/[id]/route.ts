import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';

const ClassDef = z.object({
  idx: z.number().int().min(0),
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

const PatchBody = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  classes: z.array(ClassDef).max(50).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) throw Object.assign(new Error('Not found'), { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'project.update');
  const { id } = await params;
  const body = PatchBody.parse(await req.json());
  const p = await prisma.project.update({ where: { id }, data: body });
  return NextResponse.json(p);
}
