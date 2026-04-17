import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export default async function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const role = session?.user?.role;
  if (role !== 'admin' && role !== 'final_reviewer') {
    redirect('/');
  }
  return <>{children}</>;
}
