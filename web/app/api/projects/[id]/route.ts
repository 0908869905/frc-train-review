import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';

const ClassDef = z.object({
  idx: z.number().int().min(0),
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  shortcut: z.string().regex(/^[a-z]$/).optional(),
});

const Classes = z.array(ClassDef).max(50).refine(
  (arr) => {
    const shortcuts = arr
      .map((c) => c.shortcut)
      .filter((s) => s !== undefined);
    return new Set(shortcuts).size === shortcuts.length;
  },
  { message: 'shortcut letters must be unique across classes' },
);

const PatchBody = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  classes: Classes.optional(),
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
  const denial = authzOr401(session, 'project.update', req);
  if (denial) return denial;
  const { id } = await params;
  const body = PatchBody.parse(await req.json());
  const p = await prisma.project.update({ where: { id }, data: body });
  return NextResponse.json(p);
}
