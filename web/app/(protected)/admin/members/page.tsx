import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { MembersActions } from './members-actions';

export default async function MembersPage() {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const whitelist = await prisma.emailWhitelist.findMany({
    orderBy: { addedAt: 'asc' },
  });
  const users = await prisma.user.findMany();
  const usersByEmail = new Map(users.map((u) => [u.email, u]));

  const rows = whitelist.map((w) => {
    const u = usersByEmail.get(w.email);
    return {
      email: w.email,
      role: w.role,
      addedAt: w.addedAt,
      name: u?.name ?? null,
      isActive: u?.isActive ?? null,
      hasLoggedIn: Boolean(u),
    };
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">成員</h1>
      <MembersActions />
      <table className="w-full mt-6 text-sm">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-2 font-medium">Email</th>
            <th className="font-medium">姓名</th>
            <th className="font-medium">Role</th>
            <th className="font-medium">加入日</th>
            <th className="font-medium">狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email} className="border-t">
              <td className="py-2">{r.email}</td>
              <td>{r.name ?? <span className="text-neutral-400">（未登入）</span>}</td>
              <td>{r.role}</td>
              <td>{r.addedAt.toISOString().slice(0, 10)}</td>
              <td>
                {!r.hasLoggedIn
                  ? '未登入'
                  : r.isActive
                  ? '啟用'
                  : '停用'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
