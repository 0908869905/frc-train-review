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

const PostBody = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  classes: z.array(ClassDef).max(50),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    throw Object.assign(new Error('Unauthenticated'), { status: 401 });
  }
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const session = await getSession();
  requireRole(session?.user.role, 'project.create');
  const body = PostBody.parse(await req.json());
  const p = await prisma.project.create({
    data: {
      name: body.name,
      description: body.description,
      classes: body.classes,
    },
  });
  return NextResponse.json(p);
}
