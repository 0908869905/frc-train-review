'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ClassPalette } from '@/components/annotation/ClassPalette';
import type { Box, ClassDef } from '@/components/annotation/types';
import { Button } from '@/components/ui/button';

const AnnotationCanvas = dynamic(
  () =>
    import('@/components/annotation/AnnotationCanvas').then(
      (m) => m.AnnotationCanvas,
    ),
  { ssr: false },
);

type Props = {
  imageId: string;
  imageUrl: string;
  classes: ClassDef[];
  initialBoxes: Box[];
  initialUpdatedAt: string;
  queueIds: string[];
  batchName: string;
  projectName: string;
};

export function Editor(p: Props) {
  const router = useRouter();
  const [boxes, setBoxes] = useState<Box[]>(p.initialBoxes);
  const [activeIdx, setActiveIdx] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(p.initialUpdatedAt);
  const [status, setStatus] = useState('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentIdx = p.queueIds.indexOf(p.imageId);
  const nextId = p.queueIds[currentIdx + 1];

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus('saving...');
      const res = await fetch(`/api/images/${p.imageId}/annotations`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lastKnownUpdatedAt: updatedAt,
          boxes: boxes.map((b) => ({
            classIdx: b.classIdx,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
          })),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setUpdatedAt(json.updatedAt);
        setStatus('saved');
      } else {
        setStatus('save failed');
      }
    }, 2000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes]);

  const submit = useCallback(async () => {
    setStatus('submitting...');
    const res = await fetch(`/api/images/${p.imageId}/submit`, {
      method: 'POST',
    });
    if (res.ok) {
      if (nextId) router.push(`/annotate/${nextId}`);
      else router.push('/');
    } else {
      setStatus('submit failed');
    }
  }, [p.imageId, nextId, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      // Submit takes priority — if user bound 's' to a class, we still submit.
      if (key === 's') {
        submit();
        return;
      }

      // Letter shortcut
      const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
      if (matchByShortcut >= 0) {
        setActiveIdx(matchByShortcut);
        return;
      }

      // Numeric fallback
      if (key >= '1' && key <= '9') {
        const idx = parseInt(key, 10) - 1;
        if (idx < p.classes.length) setActiveIdx(idx);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submit, p.classes]);

  useEffect(() => {
    const nextIds = p.queueIds.slice(currentIdx + 1, currentIdx + 6);
    for (const id of nextIds) {
      fetch(`/api/images/${id}/signed-url`)
        .then((r) => r.json())
        .then((j) => {
          const img = new Image();
          img.src = j.url;
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.imageId]);

  return (
    <div className="grid grid-cols-[220px_1fr_200px] h-screen">
      <aside className="border-r p-3 overflow-y-auto">
        <div className="text-xs uppercase text-gray-500 mb-2">
          Queue ({p.queueIds.length})
        </div>
        {p.queueIds.map((qid, i) => (
          <div
            key={qid}
            className={`py-1 text-xs ${qid === p.imageId ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}
          >
            {i < currentIdx ? '✓' : qid === p.imageId ? '●' : '○'} {i + 1}
          </div>
        ))}
      </aside>

      <main className="flex flex-col">
        <header className="px-4 py-2 border-b text-xs flex justify-between text-gray-600">
          <span>
            {p.projectName} / {p.batchName} / {currentIdx + 1} of{' '}
            {p.queueIds.length}
          </span>
          <span>
            drag to draw · Del delete · 1-9 / letters class · S submit
          </span>
        </header>
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <AnnotationCanvas
            imageUrl={p.imageUrl}
            classes={p.classes}
            activeClassIdx={activeIdx}
            boxes={boxes}
            onChange={setBoxes}
            width={800}
            height={600}
          />
        </div>
        <footer className="px-4 py-2 border-t flex justify-between items-center text-xs">
          <span className="text-gray-500">{status}</span>
          <Button onClick={submit}>Submit &amp; next (S)</Button>
        </footer>
      </main>

      <aside className="border-l overflow-y-auto">
        <ClassPalette
          classes={p.classes}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
        />
      </aside>
    </div>
  );
}
