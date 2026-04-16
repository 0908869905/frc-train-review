'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ClassRow = { idx: number; name: string; color: string };

const DEFAULT_CLASSES: ClassRow[] = [
  { idx: 0, name: 'class_0', color: '#ef4444' },
];

export function ProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classes, setClasses] = useState<ClassRow[]>(DEFAULT_CLASSES);
  const [busy, setBusy] = useState(false);

  function addClass() {
    setClasses([
      ...classes,
      { idx: classes.length, name: `class_${classes.length}`, color: '#3b82f6' },
    ]);
  }

  function removeClass(i: number) {
    setClasses(
      classes.filter((_, j) => j !== i).map((c, j) => ({ ...c, idx: j })),
    );
  }

  function updateClass(i: number, patch: Partial<ClassRow>) {
    setClasses(classes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, classes }),
    });
    setBusy(false);
    if (res.ok) {
      const p = await res.json();
      router.push(`/projects/${p.id}`);
    } else {
      alert('Failed');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl">
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Classes</label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addClass}
          >
            Add class
          </Button>
        </div>
        <div className="space-y-2">
          {classes.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs w-6">{c.idx}</span>
              <Input
                value={c.name}
                onChange={(e) => updateClass(i, { name: e.target.value })}
                className="flex-1"
              />
              <input
                type="color"
                value={c.color}
                onChange={(e) => updateClass(i, { color: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeClass(i)}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Creating...' : 'Create Project'}
      </Button>
    </form>
  );
}
