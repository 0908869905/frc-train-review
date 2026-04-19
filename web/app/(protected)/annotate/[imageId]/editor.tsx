'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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

type QueueItem = {
  id: string;
  state: 'assigned' | 'needs_rework' | 'annotated' | string;
};

type Props = {
  imageId: string;
  imageUrl: string;
  imageState: 'assigned' | 'needs_rework' | 'annotated' | string;
  classes: ClassDef[];
  initialBoxes: Box[];
  initialUpdatedAt: string;
  queueItems: QueueItem[];
  batchId: string;
  batchName: string;
  projectName: string;
};

export function Editor(p: Props) {
  const router = useRouter();
  const readOnly =
    p.imageState === 'annotated' || p.imageState === 'under_review';
  const [boxes, setBoxes] = useState<Box[]>(p.initialBoxes);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(p.initialUpdatedAt);
  const [status, setStatus] = useState(
    p.imageState === 'under_review'
      ? '已送審核（唯讀）'
      : p.imageState === 'annotated'
        ? 'submitted (read-only)'
        : 'saved',
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo stack lives entirely in a ref — no UI depends on it, so no useState needed.
  const undoStackRef = useRef<Box[][]>([]);

  // `onBoxesChange` is what the canvas calls whenever boxes mutate (draw/move/resize/class/delete).
  // It snapshots the OLD boxes into undo stack before setting new.
  const onBoxesChange = useCallback(
    (next: Box[]) => {
      undoStackRef.current = pushUndo(undoStackRef.current, boxes, 50);
      setBoxes(next);
    },
    [boxes]
  );

  // Clear selected, undo stack, submitted flag when imageId changes.
  useEffect(() => {
    undoStackRef.current = [];
    setSelectedId(null);
    submittedRef.current = false;
  }, [p.imageId]);

  const counts = useMemo(() => {
    const out = new Array<number>(p.classes.length).fill(0);
    for (const b of boxes) {
      if (b.classIdx >= 0 && b.classIdx < out.length) out[b.classIdx] += 1;
    }
    return out;
  }, [boxes, p.classes.length]);

  const deleteAll = useCallback(() => {
    if (readOnly || boxes.length === 0) return;
    if (!window.confirm(`刪除全部 ${boxes.length} 個標註？（可按 Ctrl+Z 復原）`)) return;
    undoStackRef.current = pushUndo(undoStackRef.current, boxes, 50);
    setBoxes([]);
    setSelectedId(null);
  }, [boxes, readOnly]);

  const currentIdx = p.queueItems.findIndex((q) => q.id === p.imageId);
  const nextId = p.queueItems[currentIdx + 1]?.id;
  const prevId = p.queueItems[currentIdx - 1]?.id; // undefined at index 0

  // Ref to latest boxes for flush. Stays in sync via effect.
  const boxesRef = useRef(boxes);
  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

  const updatedAtRef = useRef(updatedAt);
  useEffect(() => {
    updatedAtRef.current = updatedAt;
  }, [updatedAt]);

  // Promise of the currently-in-flight save (if any), used to coalesce rapid flushes.
  const inFlightSave = useRef<Promise<boolean> | null>(null);

  // Last boxes reference that was successfully persisted. Flush skips the PATCH
  // round trip when current boxes ref-equals this (nothing to persist).
  const lastSavedBoxesRef = useRef<Box[]>(p.initialBoxes);

  // Marks this editor as "already submitted this image"; unmount flush then
  // skips doSave (server state is already `annotated` → PATCH would 409).
  const submittedRef = useRef(false);

  // Perform the save; return whether we ended up with all pending changes persisted.
  // If a save is already in flight, await it first — then kick off a fresh save
  // with the LATEST boxes. Prevents silent data loss on rapid ←/→/S navigation.
  const doSave = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    if (inFlightSave.current) {
      await inFlightSave.current;
    }
    const snapshot = boxesRef.current;
    const promise = (async (): Promise<boolean> => {
      setStatus('saving...');
      try {
        const res = await fetch(`/api/images/${p.imageId}/annotations`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            lastKnownUpdatedAt: updatedAtRef.current,
            boxes: snapshot.map((b) => ({
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
          // Sync ref synchronously — callers that await inFlightSave then read
          // updatedAtRef (e.g. submit) must not pick up the stale value while
          // React waits to commit the setUpdatedAt render.
          updatedAtRef.current = json.updatedAt;
          setUpdatedAt(json.updatedAt);
          lastSavedBoxesRef.current = snapshot;
          setStatus('saved');
          return true;
        }
        if (res.status === 401) {
          setStatus('session expired — redirecting…');
          window.location.href = '/login';
          return false;
        }
        const msg = await res
          .json()
          .then((j) => j?.error as string | undefined)
          .catch(() => undefined);
        setStatus(msg ? `save failed: ${msg}` : 'save failed');
        return false;
      } finally {
        inFlightSave.current = null;
      }
    })();
    inFlightSave.current = promise;
    return await promise;
  }, [p.imageId, readOnly]);

  // Debounced auto-save (2s) — skipped entirely when read-only.
  useEffect(() => {
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      doSave();
    }, 2000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [boxes, doSave, readOnly]);

  // Flush: cancel pending debounce and save immediately. Returns true if persisted.
  // Skips the PATCH round trip when boxes ref-equal the last persisted snapshot
  // AND no debounce / in-flight save is outstanding (nothing to persist).
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (
      boxesRef.current === lastSavedBoxesRef.current &&
      saveTimer.current === null &&
      inFlightSave.current === null
    ) {
      return true;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    return await doSave();
  }, [doSave]);

  const submit = useCallback(() => {
    if (readOnly) return;
    // Cancel pending autosave debounce — submit POST carries the boxes.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Snapshot payload before navigating; refs will change after unmount.
    const imageId = p.imageId;
    const payload = JSON.stringify({
      lastKnownUpdatedAt: updatedAtRef.current,
      boxes: boxesRef.current.map((b) => ({
        classIdx: b.classIdx,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
      })),
    });

    // Optimistic: navigate away first so the UI feels instant, persist in
    // background. submittedRef tells the unmount flush to stay out of the way.
    submittedRef.current = true;
    if (nextId) router.push(`/annotate/${nextId}`);
    else router.push('/');

    void fetch(`/api/images/${imageId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    })
      .then(async (res) => {
        if (res.ok) return;
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const msg = await res
          .json()
          .then((j) => j?.error as string | undefined)
          .catch(() => undefined);
        // The original editor instance has unmounted — surface the failure
        // loudly so the annotator realises their submit did not land.
        window.alert(
          `送出失敗（圖片 ${imageId.slice(-6)}）${msg ? `：${msg}` : ''}。請回到佇列找這張重標/重送。`,
        );
      })
      .catch((e) => {
        window.alert(
          `送出網路錯誤（圖片 ${imageId.slice(-6)}）：${String(e?.message ?? e)}。請回到佇列找這張重標/重送。`,
        );
      });
  }, [p.imageId, nextId, router, readOnly]);

  const promoteBatch = useCallback(async () => {
    const ok = await flushSave();
    if (!ok) return;
    if (
      !window.confirm(
        '送出本批次目前已標註圖片給審核？之後的 submit 會直接進 review queue。',
      )
    )
      return;
    setStatus('promoting…');
    const res = await fetch(`/api/batches/${p.batchId}/promote`, {
      method: 'POST',
    });
    if (res.ok) {
      // Full reload: router.refresh() only invalidates the current route's
      // RSC cache, leaving prefetched /annotate/[nextId] entries stale —
      // after promote, queueItems on those cached pages still include the
      // just-promoted images, so S / ← jumps land on pages with a wrong
      // sidebar. Hard reload nukes the entire router cache.
      window.location.reload();
    } else if (res.status === 401) {
      setStatus('session expired — redirecting…');
      window.location.href = '/login';
    } else {
      const msg = await res
        .json()
        .then((j) => j?.error as string | undefined)
        .catch(() => undefined);
      setStatus(msg ? `promote failed: ${msg}` : 'promote failed');
    }
  }, [p.batchId, flushSave, router]);

  const unsubmit = useCallback(async () => {
    setStatus('unlocking…');
    const res = await fetch(`/api/images/${p.imageId}/unsubmit`, {
      method: 'POST',
    });
    if (res.ok) {
      router.refresh();
    } else if (res.status === 401) {
      setStatus('session expired — redirecting…');
      window.location.href = '/login';
    } else {
      const msg = await res
        .json()
        .then((j) => j?.error as string | undefined)
        .catch(() => undefined);
      setStatus(msg ? `unlock failed: ${msg}` : 'unlock failed');
    }
  }, [p.imageId, router]);

  // Best-effort flush on unmount (page close, route away outside ←/→).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (readOnly || submittedRef.current) return;
      // Fire-and-forget; we can't await here.
      doSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.repeat) return;

      if (readOnly) {
        if (e.key === 'Escape') setSelectedId(null);
        return;
      }

      // Ctrl+Z undo (Mac: metaKey)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const popped = popUndo(undoStackRef.current);
        if (!popped) return;
        undoStackRef.current = popped.stack;
        setBoxes(popped.top);
        setSelectedId(null);
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

  const navTo = useCallback(
    async (targetId: string) => {
      if (!targetId || targetId === p.imageId) return;
      const ok = await flushSave();
      if (!ok) return;
      router.push(`/annotate/${targetId}`);
    },
    [p.imageId, flushSave, router],
  );

  // ←/→ nav: flush save then navigate.
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.repeat) {
        // Held-key OS repeat fires ~30Hz → would stack dozens of router.push
        // before the first navigation unmounts. Require discrete keypresses.
        e.preventDefault();
        return;
      }
      const targetId = e.key === 'ArrowLeft' ? prevId : nextId;
      if (!targetId) return;
      e.preventDefault();
      await navTo(targetId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prevId, nextId, navTo]);

  useEffect(() => {
    const nextIds = p.queueItems
      .slice(currentIdx + 1, currentIdx + 6)
      .map((q) => q.id);
    for (const id of nextIds) {
      router.prefetch(`/annotate/${id}`);
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
          Queue ({p.queueItems.length})
        </div>
        {p.queueItems.map((q, i) => {
          const isCurrent = q.id === p.imageId;
          const icon = isCurrent
            ? '●'
            : q.state === 'annotated'
              ? '✓'
              : q.state === 'needs_rework'
                ? '✎'
                : '○';
          return (
            <button
              key={q.id}
              type="button"
              disabled={isCurrent}
              onClick={() => navTo(q.id)}
              className={`block w-full text-left px-1 py-1 text-xs rounded ${
                isCurrent
                  ? 'text-gray-900 font-semibold bg-gray-100 cursor-default'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer'
              }`}
            >
              <span className="inline-block w-4 text-center">{icon}</span>{' '}
              {i + 1}
            </button>
          );
        })}
      </aside>

      <main className="flex flex-col">
        <header className="px-4 py-2 border-b text-xs flex justify-between text-gray-600">
          <span>
            {p.projectName} / {p.batchName} / {currentIdx + 1} of{' '}
            {p.queueItems.length}
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
            readOnly={readOnly}
          />
        </div>
        <footer className="px-4 py-2 border-t flex justify-between items-center text-xs">
          <span className="text-gray-500">{status}</span>
          <div className="flex items-center gap-2">
            {!readOnly && (
              <Button
                variant="outline"
                onClick={deleteAll}
                disabled={boxes.length === 0}
              >
                全部刪除
              </Button>
            )}
            <Button variant="outline" onClick={promoteBatch}>
              送出目前進度給審核
            </Button>
            {p.imageState === 'annotated' ? (
              <Button variant="outline" onClick={unsubmit}>
                解鎖重標
              </Button>
            ) : p.imageState === 'under_review' ? (
              <span className="text-xs text-gray-500 px-2">已送審核</span>
            ) : (
              <Button onClick={submit}>Submit &amp; next (S)</Button>
            )}
          </div>
        </footer>
      </main>

      <aside className="border-l overflow-y-auto">
        <ClassPalette
          classes={p.classes}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
          counts={counts}
        />
      </aside>
    </div>
  );
}
