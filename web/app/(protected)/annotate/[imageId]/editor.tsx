'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ClassPalette } from '@/components/annotation/ClassPalette';
import type { Box, ClassDef } from '@/components/annotation/types';
import { Button } from '@/components/ui/button';
import { pushUndo, popUndo } from '@/components/annotation/undo';
import {
  changeSelectedClass,
  deleteSelected,
} from '@/components/annotation/editor-actions';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(p.initialUpdatedAt);
  const [status, setStatus] = useState('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [undoStack, setUndoStack] = useState<Box[][]>([]);

  // `onBoxesChange` is what the canvas calls whenever boxes mutate (draw/move/resize/class/delete).
  // It snapshots the OLD boxes into undo stack before setting new.
  const onBoxesChange = useCallback(
    (next: Box[]) => {
      setUndoStack((stack) => pushUndo(stack, boxes, 50));
      setBoxes(next);
    },
    [boxes]
  );

  // Clear selected and undo stack when imageId changes.
  useEffect(() => {
    setSelectedId(null);
    setUndoStack([]);
  }, [p.imageId]);

  const currentIdx = p.queueIds.indexOf(p.imageId);
  const nextId = p.queueIds[currentIdx + 1];
  const prevId = p.queueIds[currentIdx - 1]; // undefined at index 0

  // Ref to latest boxes for flush. Stays in sync via effect.
  const boxesRef = useRef(boxes);
  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

  const updatedAtRef = useRef(updatedAt);
  useEffect(() => {
    updatedAtRef.current = updatedAt;
  }, [updatedAt]);

  const saveInFlight = useRef(false);
  const pendingDirty = useRef(false);

  // Perform the save; return whether we ended up with all pending changes persisted.
  const doSave = useCallback(async (): Promise<boolean> => {
    if (saveInFlight.current) {
      pendingDirty.current = true;
      return true;
    }
    saveInFlight.current = true;
    setStatus('saving...');
    try {
      const res = await fetch(`/api/images/${p.imageId}/annotations`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lastKnownUpdatedAt: updatedAtRef.current,
          boxes: boxesRef.current.map((b) => ({
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
        return true;
      }
      setStatus('save failed');
      return false;
    } finally {
      saveInFlight.current = false;
    }
  }, [p.imageId]);

  // Debounced auto-save (2s) — replaces the old inline useEffect.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      doSave();
    }, 2000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [boxes, doSave]);

  // Flush: cancel pending debounce and save immediately. Returns true if persisted.
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    return await doSave();
  }, [doSave]);

  const submit = useCallback(async () => {
    const ok = await flushSave();
    if (!ok) return;
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
  }, [p.imageId, nextId, router, flushSave]);

  // Best-effort flush on unmount (page close, route away outside ←/→).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // Fire-and-forget; we can't await here.
      doSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Ctrl+Z undo (Mac: metaKey)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setUndoStack((stack) => {
          const popped = popUndo(stack);
          if (!popped) return stack;
          setBoxes(popped.top);
          setSelectedId(null);
          return popped.stack;
        });
        return;
      }

      // Delete / Backspace → remove selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          onBoxesChange(deleteSelected(boxes, selectedId));
          setSelectedId(null);
        }
        return;
      }

      // Escape → deselect
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }

      const key = e.key.toLowerCase();

      // Submit takes priority — if user bound 's' to a class, we still submit.
      if (key === 's' && !e.ctrlKey && !e.metaKey) {
        submit();
        return;
      }

      // Class-shortcut: change selected box's class + set active
      const matchByShortcut = p.classes.findIndex((c) => c.shortcut === key);
      if (matchByShortcut >= 0) {
        if (selectedId) {
          onBoxesChange(changeSelectedClass(boxes, selectedId, matchByShortcut));
        }
        setActiveIdx(matchByShortcut);
        return;
      }

      // Numeric fallback: change selected box's class + set active
      if (key >= '1' && key <= '9') {
        const idx = parseInt(key, 10) - 1;
        if (idx < p.classes.length) {
          if (selectedId) {
            onBoxesChange(changeSelectedClass(boxes, selectedId, idx));
          }
          setActiveIdx(idx);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submit, p.classes, selectedId, boxes, onBoxesChange]);

  // ←/→ nav: flush save then navigate.
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const targetId = e.key === 'ArrowLeft' ? prevId : nextId;
      if (!targetId) return;
      e.preventDefault();
      const ok = await flushSave();
      if (!ok) return;
      router.push(`/annotate/${targetId}`);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, flushSave, router]);

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
          <span className="text-right">
            drag: empty→draw · box→move · handle→resize ·
            wheel zoom · mid/right drag pan · f fit ·
            ←/→ nav · 1-9/letters class · Del · Ctrl+Z · Esc · S submit
          </span>
        </header>
        <div className="flex-1 flex bg-gray-50">
          <AnnotationCanvas
            imageUrl={p.imageUrl}
            classes={p.classes}
            activeClassIdx={activeIdx}
            boxes={boxes}
            onChange={onBoxesChange}
            selectedId={selectedId}
            onSelect={setSelectedId}
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
