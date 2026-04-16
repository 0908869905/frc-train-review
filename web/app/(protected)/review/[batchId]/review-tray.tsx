'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [rejectComment, setRejectComment] = useState('');

  const current = images[idx];

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
    setRejectComment('');
    setRejectOpen(true);
  }, []);

  async function confirmReject() {
    if (!current || !rejectComment.trim()) return;
    const res = await fetch(`/api/images/${current.id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: rejectComment }),
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
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <AnnotationCanvas
          imageUrl={current.imageUrl}
          classes={classes}
          activeClassIdx={0}
          boxes={current.boxes}
          onChange={() => {}}
          width={900}
          height={600}
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
            <DialogTitle>Reject with comment</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Why reject? (required)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmReject}
              disabled={!rejectComment.trim()}
            >
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
