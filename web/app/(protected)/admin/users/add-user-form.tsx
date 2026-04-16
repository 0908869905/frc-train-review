'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Role = 'admin' | 'annotator' | 'final_reviewer';

export function AddUserForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('annotator');
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    setMsg(res.ok ? 'Added' : `Failed: ${res.status}`);
    if (res.ok) {
      setEmail('');
      location.reload();
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-center">
      <Input
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="border rounded px-2 py-1"
      >
        <option value="annotator">annotator</option>
        <option value="admin">admin</option>
        <option value="final_reviewer">final_reviewer</option>
      </select>
      <Button type="submit">Add</Button>
      {msg && <span className="text-sm text-gray-500">{msg}</span>}
    </form>
  );
}
