'use client';
import { useState } from 'react';

export function NameForm({ initial, isEdit }: { initial: string; isEdit: boolean }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const res = await fetch('/api/me/display-name', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setSaving(false);
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      setErr('儲存失敗，請稍後再試');
      return;
    }
    // Full-page nav so proxy.ts re-runs auth() → jwt callback re-reads
    // displayNameSetAt from DB and rotates the cookie. useSession().update()
    // in next-auth v5 beta is unreliable at rotating the JWT cookie, which
    // caused router.push('/') to bounce back here with stale claim.
    window.location.href = '/';
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label htmlFor="display-name" className="sr-only">
        姓名
      </label>
      <input
        id="display-name"
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={64}
        required
        autoFocus
        placeholder="例：張小明"
      />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={saving || name.trim().length === 0}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}
