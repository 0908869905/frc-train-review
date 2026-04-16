import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { BatchUploader } from './batch-uploader';

export default async function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');
  const { id } = await params;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Upload Batch</h1>
      <BatchUploader projectId={id} />
    </main>
  );
}
