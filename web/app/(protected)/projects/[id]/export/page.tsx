import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';

export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  requireRole(session?.user.role, 'export.download');
  const { id } = await params;

  const approved = await prisma.image.count({
    where: { batch: { projectId: id }, state: 'approved' },
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-2">Export YOLO Dataset</h1>
      <p className="text-sm text-gray-600 mb-6">
        {approved} approved images will be included.
      </p>
      <a href={`/api/projects/${id}/export`}>
        <Button disabled={approved === 0}>Download zip</Button>
      </a>
      <p className="text-xs text-gray-400 mt-6">
        The downloaded zip is ready for{' '}
        <code>train_robot_model.py --local-dataset data.yaml</code> on the GPU
        machine.
      </p>
    </main>
  );
}
