'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Box, ClassDef } from '@/components/annotation/types';

const AnnotationCanvas = dynamic(
  () =>
    import('@/components/annotation/AnnotationCanvas').then(
      (m) => m.AnnotationCanvas,
    ),
  { ssr: false },
);

type ReviewImage = { id: string; imageUrl: string; boxes: Box[] };

const REJECT_PRESETS = [
  '菜就多練',
  '邊框沒框好',
  '沒框',
  '少框機器人',
  '少框 fuels',
] as const;
const OTHER = '其他';

export function ReviewTray({
  batchName,
  projectName,
  classes,
  images,
}: {
  batchName: string;
  projectName: string;
  classes: ClassDef[];
  images: ReviewImage[];
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectChoice, setRejectChoice] = useState<string>('');
  const [rejectOther, setRejectOther] = useState('');

  const current = images[idx];

  const counts = useMemo(() => {
    const out = new Array<number>(classes.length).fill(0);
    if (!current) return out;
    for (const b of current.boxes) {
      if (b.classIdx >= 0 && b.classIdx < out.length) out[b.classIdx] += 1;
    }
    return out;
  }, [current, classes.length]);

  const next = useCallback(() => {
    if (idx + 1 < images.length) setIdx(idx + 1);
    else router.push('/');
  }, [idx, images.length, router]);

  const approve = useCallback(async () => {
    if (!current) return;
    const res = await fetch(`/api/images/${current.id}/approve`, {
      method: 'POST',
    });
    if (res.ok) next();
  }, [current, next]);

  const openReject = useCallback(() => {
    setRejectChoice('');
    setRejectOther('');
    setRejectOpen(true);
  }, []);

  const finalComment =
    rejectChoice === OTHER ? rejectOther.trim() : rejectChoice;
  const canConfirm = finalComment.length > 0;

  async function confirmReject() {
    if (!current || !canConfirm) return;
    const res = await fetch(`/api/images/${current.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: finalComment }),
    });
    if (res.ok) {
      setRejectOpen(false);
      next();
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (rejectOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        approve();
      }
      if (e.key === 'r' || e.key === 'R') openReject();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [approve, openReject, rejectOpen]);

  if (!current) {
    return (
      <main className="p-8">All images reviewed for batch {batchName}.</main>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="px-4 py-2 border-b text-xs flex justify-between text-gray-600">
        <span>
          {projectName} / {batchName} / {idx + 1} of {images.length}
        </span>
        <span>Space approve · R reject</span>
      </header>
      <div className="px-4 py-2 border-b flex flex-wrap gap-2">
        {classes.map((c) => (
          <span
            key={c.idx}
            className="inline-flex items-center gap-2 px-3 py-1 border rounded-md text-xs"
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            <span>{c.name}</span>
            <span className="tabular-nums text-gray-600">
              × {counts[c.idx] ?? 0}
            </span>
          </span>
        ))}
      </div>
      <div className="flex-1 flex bg-gray-50">
        <AnnotationCanvas
          imageUrl={current.imageUrl}
          classes={classes}
          activeClassIdx={0}
          boxes={current.boxes}
          onChange={() => {}}
          selectedId={null}
          onSelect={() => {}}
          readOnly
        />
      </div>
      <footer className="px-4 py-3 border-t flex gap-2 justify-end">
        <Button variant="outline" onClick={openReject}>
          Reject (R)
        </Button>
        <Button onClick={approve}>Approve (Space)</Button>
      </footer>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退回原因</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {[...REJECT_PRESETS, OTHER].map((label) => (
              <label
                key={label}
                className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-sm cursor-pointer hover:bg-neutral-50 has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-50"
              >
                <input
                  type="radio"
                  name="reject-reason"
                  value={label}
                  checked={rejectChoice === label}
                  onChange={() => setRejectChoice(label)}
                  className="accent-neutral-900"
                />
                <span>{label}</span>
              </label>
            ))}
            {rejectChoice === OTHER && (
              <Textarea
                value={rejectOther}
                onChange={(e) => setRejectOther(e.target.value)}
                placeholder="請填寫退回原因"
                autoFocus
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button onClick={confirmReject} disabled={!canConfirm}>
              確認退回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
