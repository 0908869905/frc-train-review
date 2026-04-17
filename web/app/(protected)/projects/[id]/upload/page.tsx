import { getSession } from '@/lib/session';
import { StepUpGuard } from '@/components/step-up-guard';
import { BatchUploader } from './batch-uploader';

export default async function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { id } = await params;
  return (
    <StepUpGuard scope="admin">
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-6">Upload Batch</h1>
        <BatchUploader projectId={id} />
      </main>
    </StepUpGuard>
  );
}
