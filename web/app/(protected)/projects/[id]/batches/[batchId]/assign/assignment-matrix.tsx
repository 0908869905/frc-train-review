'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { splitEvenly } from '@/lib/assignment';

type Annotator = { id: string; email: string };

export function AssignmentMatrix({
  batchId,
  unassignedCount,
  annotators,
}: {
  batchId: string;
  unassignedCount: number;
  annotators: Annotator[];
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const total = Object.values(counts).reduce((s, v) => s + (v || 0), 0);

  function distributeEvenly() {
    const parts = splitEvenly(unassignedCount, annotators.length);
    const next: Record<string, number> = {};
    annotators.forEach((a, i) => (next[a.id] = parts[i]));
    setCounts(next);
  }

  async function submit() {
    setBusy(true);
    const assignments = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([annotatorId, count]) => ({ annotatorId, count }));
    const res = await fetch(`/api/batches/${batchId}/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignments }),
    });
    setBusy(false);
    if (res.ok) location.href = `/`;
    else alert('Failed: ' + (await res.text()));
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={distributeEvenly}>
          Distribute evenly
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Annotator</th>
            <th className="text-left py-2">Count</th>
          </tr>
        </thead>
        <tbody>
          {annotators.map((a) => (
            <tr key={a.id} className="border-b">
              <td className="py-2">{a.email}</td>
              <td>
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={counts[a.id] ?? 0}
                  onChange={(e) =>
                    setCounts({
                      ...counts,
                      [a.id]: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-sm">
        Total: {total} / {unassignedCount}
      </div>
      <Button
        onClick={submit}
        disabled={busy || total === 0 || total > unassignedCount}
      >
        {busy ? 'Assigning...' : 'Assign'}
      </Button>
    </div>
  );
}
