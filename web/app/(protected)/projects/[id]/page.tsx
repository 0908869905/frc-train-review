import Link from 'next/link';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { BatchState } from '@prisma/client';

function batchHref(projectId: string, batchId: string, state: BatchState) {
  if (state === 'under_review') return `/review/${batchId}`;
  if (state === 'completed') return `/projects/${projectId}/export`;
  return `/projects/${projectId}/batches/${batchId}/assign`;
}

export default async function ProjectHome({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) notFound();
  const classes = p.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;

  const batches = await prisma.batch.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { images: true } },
    },
  });

  const approvedCount = await prisma.image.count({
    where: { batch: { projectId: id }, state: 'approved' },
  });

  return (
    <main className="p-8">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="text-sm text-gray-500">{p.description ?? '—'}</p>
        </div>
        <Link href={`/projects/${id}/export`}>
          <Button variant="outline">
            Export YOLO zip ({approvedCount})
          </Button>
        </Link>
      </div>

      <section className="mb-8 mt-6">
        <h2 className="text-lg font-semibold mb-2">
          Classes ({classes.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <span
              key={c.idx}
              className="inline-flex items-center gap-2 px-3 py-1 border rounded-md text-sm"
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.idx}: {c.name}
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Batches</h2>
          <Link href={`/projects/${id}/upload`}>
            <Button>New batch</Button>
          </Link>
        </div>
        {batches.length === 0 ? (
          <p className="text-sm text-gray-400">No batches yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 border rounded-md">
            {batches.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <Link
                    href={batchHref(id, b.id, b.state)}
                    className="text-sm font-medium underline"
                  >
                    {b.name}
                  </Link>
                  <div className="text-xs text-neutral-500">
                    {b.state} · {b._count.images} images
                  </div>
                </div>
                <span className="text-xs text-neutral-400">
                  {b.createdAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
