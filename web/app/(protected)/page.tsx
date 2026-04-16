import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) return null;
  const role = session.user.role;

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const reviewableBatches =
    role === 'final_reviewer' || role === 'admin'
      ? await prisma.batch.findMany({
          where: { state: 'under_review' },
          include: {
            project: true,
            _count: {
              select: { images: { where: { state: 'under_review' } } },
            },
          },
        })
      : [];

  const firstQueueId = queue[0]?.id;

  return (
    <main className="p-8 space-y-10">
      <section>
        <h1 className="text-2xl font-bold mb-4">My Queue</h1>
        {queue.length === 0 ? (
          <p className="text-gray-500">No assigned images.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-2">
              {queue.length} waiting.
            </p>
            <Link href={`/annotate/${firstQueueId}`} className="underline">
              Start annotating →
            </Link>
          </>
        )}
      </section>

      {reviewableBatches.length > 0 && (
        <section>
          <h1 className="text-2xl font-bold mb-4">Ready for Review</h1>
          <ul className="space-y-2">
            {reviewableBatches.map((b) => (
              <li key={b.id} className="border rounded-md p-3">
                <Link href={`/review/${b.id}`} className="underline">
                  {b.project.name} — {b.name} ({b._count.images} images)
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <Link href="/projects" className="underline text-sm">
          All projects
        </Link>
      </section>
    </main>
  );
}
