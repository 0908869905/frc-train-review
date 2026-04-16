'use client';
import { useEffect, useState } from 'react';
import { StepUpDialog } from './step-up-dialog';

export function StepUpGuard({
  scope,
  children,
}: {
  scope: 'reviewer' | 'admin';
  children: React.ReactNode;
}) {
  const [state, setState] = useState<'checking' | 'granted' | 'required'>('checking');

  async function check() {
    const res = await fetch(`/api/auth/step-up?scope=${scope}`, { cache: 'no-store' });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const j = await res.json().catch(() => ({ granted: false }));
    setState(j.granted ? 'granted' : 'required');
  }

  useEffect(() => {
    check();
  }, [scope]);

  if (state === 'checking') {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }
  if (state === 'granted') {
    return <>{children}</>;
  }
  return (
    <>
      <div className="p-8 text-sm text-neutral-500">Verifying access…</div>
      <StepUpDialog open scope={scope} onGranted={() => setState('granted')} />
    </>
  );
}
