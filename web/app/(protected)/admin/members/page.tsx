import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { MembersActions } from './members-actions';

export default async function MembersPage() {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const [users, whitelist] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.emailWhitelist.findMany({ orderBy: { addedAt: 'asc' } }),
  ]);
  const whitelistByEmail = new Map(whitelist.map((w) => [w.email, w]));
  const userEmails = new Set(users.map((u) => u.email));

  // Two sections: users who have logged in (real members), and
  // whitelist entries that haven't produced a User yet (pre-provisioned).
  const members = users.map((u) => {
    const w = whitelistByEmail.get(u.email);
    return {
      email: u.email,
      name: u.name,
      role: u.role,
      whitelistRole: w?.role ?? null,
      addedAt: u.createdAt,
      isActive: u.isActive,
      lastLoginAt: u.displayNameSetAt ?? u.createdAt,
    };
  });
  const pending = whitelist
    .filter((w) => !userEmails.has(w.email))
    .map((w) => ({
      email: w.email,
      role: w.role,
      addedAt: w.addedAt,
    }));

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">成員</h1>
      <MembersActions />

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">已登入 ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-sm text-neutral-500">尚無成員登入。</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-2 font-medium">Email</th>
                <th className="font-medium">姓名</th>
                <th className="font-medium">Role</th>
                <th className="font-medium">白名單角色</th>
                <th className="font-medium">加入日</th>
                <th className="font-medium">狀態</th>
              </tr>
            </thead>
            <tbody>
              {members.map((r) => (
                <tr key={r.email} className="border-t">
                  <td className="py-2">{r.email}</td>
                  <td>
                    {r.name ?? (
                      <span className="text-neutral-400">（未設定）</span>
                    )}
                  </td>
                  <td>{r.role}</td>
                  <td>
                    {r.whitelistRole ? (
                      r.whitelistRole === r.role ? (
                        <span className="text-neutral-400">{r.whitelistRole}</span>
                      ) : (
                        <span className="text-amber-600">
                          {r.whitelistRole}（未同步）
                        </span>
                      )
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td>{r.addedAt.toISOString().slice(0, 10)}</td>
                  <td>{r.isActive ? '啟用' : '停用'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pending.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold mb-3">
            預訂白名單 ({pending.length})
          </h2>
          <p className="text-xs text-neutral-500 mb-2">
            Email 已加進白名單但尚未登入；首次登入時會自動套用這些角色。
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-2 font-medium">Email</th>
                <th className="font-medium">預定 Role</th>
                <th className="font-medium">加入日</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.email} className="border-t">
                  <td className="py-2">{r.email}</td>
                  <td>{r.role}</td>
                  <td>{r.addedAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
