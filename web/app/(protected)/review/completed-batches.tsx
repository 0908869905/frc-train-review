'use client';
import { useState } from 'react';

export function CompletedBatches({
  items,
}: {
  items: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
    approvedCount: number;
  }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(projectId: string) {
    setBusy(projectId);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
      });
      const body = (await r.json()) as
        | { url: string; filename: string; imageCount: number }
        | { error: string };
      if (!r.ok || !('url' in body)) {
        setError('error' in body ? body.error : `export failed (${r.status})`);
        setBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">目前無已完成 batch。</p>;
  }
  return (
    <div>
      <ul className="divide-y divide-neutral-200">
        {items.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium">{b.name}</div>
              <div className="text-xs text-neutral-500">
                {b.projectName} · {b.approvedCount} approved
              </div>
            </div>
            <button
              onClick={() => download(b.projectId)}
              disabled={busy !== null}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {busy === b.projectId ? '打包中…' : '下載 project zip'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
