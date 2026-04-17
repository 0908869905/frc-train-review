import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { Button } from '@/components/ui/button';

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link href="/projects/new">
          <Button>New Project</Button>
        </Link>
      </div>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="border rounded-md p-4 hover:bg-gray-50">
            <Link href={`/projects/${p.id}`} className="block">
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-gray-500">{p.description ?? '—'}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
