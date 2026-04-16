import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { AddUserForm } from './add-user-form';

export default async function AdminUsersPage() {
  const session = await getSession();
  requireRole(session?.user.role, 'whitelist.manage');
  const rows = await prisma.emailWhitelist.findMany({
    orderBy: { addedAt: 'asc' },
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Email Whitelist</h1>
      <AddUserForm />
      <table className="w-full mt-6 text-sm">
        <thead>
          <tr>
            <th className="text-left py-2">Email</th>
            <th className="text-left py-2">Role</th>
            <th className="text-left py-2">Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email} className="border-t">
              <td className="py-2">{r.email}</td>
              <td>{r.role}</td>
              <td>{r.addedAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
