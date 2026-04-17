import Link from 'next/link';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';

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

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">{p.name}</h1>
      <p className="text-sm text-gray-500 mb-6">{p.description ?? '—'}</p>
      <section className="mb-8">
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
                    href={`/projects/${id}/batches/${b.id}/assign`}
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
