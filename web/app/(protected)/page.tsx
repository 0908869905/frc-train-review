import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) return null;

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework'] },
    },
    include: { batch: { include: { project: true } } },
    orderBy: { updatedAt: 'asc' },
  });

  const firstId = queue[0]?.id;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">My Queue</h1>
      {queue.length === 0 ? (
        <p className="text-gray-500">No assigned images.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            {queue.length} image{queue.length === 1 ? '' : 's'} waiting.
          </p>
          <Link href={`/annotate/${firstId}`} className="underline">
            Start annotating →
          </Link>
        </>
      )}
      <div className="mt-12">
        <Link href="/projects" className="underline">
          View all projects
        </Link>
      </div>
    </main>
  );
}
