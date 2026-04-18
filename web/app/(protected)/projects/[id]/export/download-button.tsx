'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function DownloadButton({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
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
        setLoading(false);
        return;
      }
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={start} disabled={disabled || loading}>
        {loading ? 'Packing…' : 'Download zip'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
