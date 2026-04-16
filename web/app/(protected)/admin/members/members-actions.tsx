'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MembersActions() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'annotator' | 'final_reviewer' | 'admin'>('annotator');
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setOpen(false);
      setEmail('');
      router.refresh();
      return;
    }
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    setErr('新增失敗，請檢查 email 格式');
  }

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
      >
        新增成員
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="mt-4 flex items-center gap-2 rounded border border-neutral-200 p-3"
        >
          <input
            type="email"
            required
            placeholder="gmail@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as 'annotator' | 'final_reviewer' | 'admin')
            }
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="annotator">annotator</option>
            <option value="final_reviewer">final_reviewer</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            加入
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setErr(null);
            }}
            className="text-sm text-neutral-500"
          >
            取消
          </button>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        </form>
      )}
    </div>
  );
}
