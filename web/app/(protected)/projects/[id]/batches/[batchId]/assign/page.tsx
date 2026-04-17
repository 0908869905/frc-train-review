import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { StepUpGuard } from '@/components/step-up-guard';
import { AssignmentMatrix } from './assignment-matrix';

export default async function AssignPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { batchId } = await params;
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: true },
  });
  if (!batch) return <div className="p-8">Batch not found</div>;

  const counts = await prisma.image.groupBy({
    by: ['state'],
    where: { batchId },
    _count: true,
  });
  const unassigned =
    counts.find((c) => c.state === 'unassigned')?._count ?? 0;
  const annotators = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { email: 'asc' },
  });

  return (
    <StepUpGuard scope="admin">
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-2">Assign: {batch.name}</h1>
        <p className="text-sm text-gray-500 mb-6">
          Project {batch.project.name} — {unassigned} unassigned images
        </p>
        <AssignmentMatrix
          batchId={batchId}
          unassignedCount={unassigned}
          annotators={annotators.map((a) => ({ id: a.id, email: a.email }))}
        />
      </main>
    </StepUpGuard>
  );
}
