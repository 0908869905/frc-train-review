import { getSession } from '@/lib/session';
import { StepUpGuard } from '@/components/step-up-guard';
import { ProjectForm } from './project-form';

export default async function NewProjectPage() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  return (
    <StepUpGuard scope="admin">
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-6">New Project</h1>
        <ProjectForm />
      </main>
    </StepUpGuard>
  );
}
