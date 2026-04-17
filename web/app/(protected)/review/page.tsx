import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { CompletedBatches } from './completed-batches';

export default async function ReviewHomePage() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }

  const completed = await prisma.batch.findMany({
    where: { state: 'completed' },
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { images: { where: { state: 'approved' } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const items = completed.map((b) => ({
    id: b.id,
    name: b.name,
    projectId: b.project.id,
    projectName: b.project.name,
    approvedCount: b._count.images,
  }));

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">覆核</h1>
      <section>
        <h2 className="text-lg font-semibold mb-4">已完成 batch — 可匯出</h2>
        <CompletedBatches items={items} />
      </section>
    </main>
  );
}
