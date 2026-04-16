import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { NameForm } from './name-form';

export default async function OnboardingNamePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect('/login');
  const { edit } = await searchParams;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, displayNameSetAt: true },
  });
  if (!edit && u?.displayNameSetAt) redirect('/');
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold mb-2">請輸入您的姓名</h1>
      <p className="text-sm text-neutral-500 mb-6">
        這個姓名會出現在 audit log、指派列表、審核紀錄中。
      </p>
      <NameForm initial={u?.name ?? ''} isEdit={!!edit} />
    </main>
  );
}
