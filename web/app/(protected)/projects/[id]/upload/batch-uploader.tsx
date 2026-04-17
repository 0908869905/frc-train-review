'use client';

import { useState } from 'react';
import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

export function BatchUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [batchName, setBatchName] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      setStatus('Creating batch...');
      const initRes = await fetch(`/api/projects/${projectId}/batches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: batchName, source: 'manual' }),
      });
      if (!initRes.ok) throw new Error('init failed');
      const { batchId } = await initRes.json();

      setStatus('Uploading to Blob...');
      const blob = await upload(
        `frc-annotation/batches/${batchId}/upload.zip`,
        file,
        {
          access: 'public',
          handleUploadUrl: '/api/blob/upload',
          onUploadProgress: ({ percentage }) => setProgress(percentage),
        },
      );

      setStatus('Finalizing...');
      const finRes = await fetch(`/api/batches/${batchId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ zipUrl: blob.url }),
      });
      if (!finRes.ok) {
        const detail = await finRes
          .json()
          .then((j) => j.error ?? JSON.stringify(j))
          .catch(() => finRes.text().catch(() => ''));
        throw new Error(`finalize failed (${finRes.status}): ${detail}`);
      }

      setStatus('Done');
      router.push(`/projects/${projectId}/batches/${batchId}/assign`);
    } catch (err) {
      setStatus('Error: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Batch name</label>
        <Input
          value={batchName}
          onChange={(e) => setBatchName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">YOLO zip</label>
        <input
          type="file"
          accept=".zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
      </div>
      {busy && <Progress value={progress} />}
      {status && <p className="text-sm text-gray-500">{status}</p>}
      <Button type="submit" disabled={busy || !file}>
        Upload
      </Button>
    </form>
  );
}
