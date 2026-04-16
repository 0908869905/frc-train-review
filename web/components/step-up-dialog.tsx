'use client';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function StepUpDialog({
  open,
  scope,
  onGranted,
}: {
  open: boolean;
  scope: 'reviewer' | 'admin';
  onGranted: () => void;
}) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  // Auto-clear lock when the retry window elapses, so the form re-enables
  // without requiring a page refresh.
  useEffect(() => {
    if (lockedUntil === null) return;
    const ms = lockedUntil - Date.now();
    if (ms <= 0) {
      setLockedUntil(null);
      return;
    }
    const t = setTimeout(() => setLockedUntil(null), ms);
    return () => clearTimeout(t);
  }, [lockedUntil]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const res = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw, scope }),
    });
    setLoading(false);
    if (res.status === 200) {
      setPw('');
      onGranted();
      return;
    }
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      setLockedUntil(Date.now() + (j.retryAfter ?? 600) * 1000);
      setErr('嘗試次數過多，請稍後再試。');
      return;
    }
    setErr('密碼錯誤');
  }

  const locked = lockedUntil !== null && Date.now() < lockedUntil;

  return (
    // Suppress close events: step-up is a gate, no escape/backdrop dismissal.
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>需要進一步驗證</DialogTitle>
          <DialogDescription>
            {scope === 'reviewer' ? '請輸入覆核者密碼' : '請輸入管理員密碼'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor="stepup-password" className="sr-only">
            密碼
          </label>
          <input
            id="stepup-password"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={locked}
            autoFocus
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          {err && (
            <p role="alert" className="text-sm text-red-600">
              {err}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || locked || pw.trim().length === 0}
            className="w-full rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? '驗證中…' : '確認'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
