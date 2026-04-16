import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';

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
        <h2 className="text-lg font-semibold mb-2">Batches</h2>
        <p className="text-sm text-gray-400">
          No batches yet — M3 will add upload.
        </p>
      </section>
    </main>
  );
}
