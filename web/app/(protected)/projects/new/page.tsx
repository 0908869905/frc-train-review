import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { ProjectForm } from './project-form';

export default async function NewProjectPage() {
  const session = await getSession();
  requireRole(session?.user.role, 'project.create');
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
      <ProjectForm />
    </main>
  );
}
