'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import type { Box, ClassDef } from './types';
import {
  imgToDisp,
  computeFitView,
  applyWheelZoom,
  type Viewport,
} from './viewport';

type Props = {
  imageUrl: string;
  classes: ClassDef[];
  activeClassIdx: number;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  readOnly?: boolean;
};

export function AnnotationCanvas({
  imageUrl,
  classes,
  boxes,
  selectedId,
  readOnly = false,
  // The following are wired later (Phase 1.2+) — keep in destructure to silence TS.
  activeClassIdx: _activeClassIdx,
  onChange: _onChange,
  onSelect: _onSelect,
}: Props) {
  void _activeClassIdx;
  void _onChange;
  void _onSelect;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [img] = useImage(imageUrl);
  const natW = img?.naturalWidth ?? 1;
  const natH = img?.naturalHeight ?? 1;

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>({ zoom: 1, pan: { x: 0, y: 0 } });

  // Track container size via ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setContainerSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit view whenever image loads, image URL changes, or container resizes.
  useEffect(() => {
    if (!img || containerSize.w === 0 || containerSize.h === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVp(computeFitView(natW, natH, containerSize.w, containerSize.h));
  }, [img, natW, natH, containerSize.w, containerSize.h, imageUrl]);

  // `f` key → fit view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!img || containerSize.w === 0 || containerSize.h === 0) return;
      setVp(computeFitView(natW, natH, containerSize.w, containerSize.h));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [img, natW, natH, containerSize.w, containerSize.h]);

  // Wheel zoom (cursor-centered).
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;
    const delta = e.evt.deltaY < 0 ? +1 : -1;
    setVp((cur) => applyWheelZoom(cur, p.x, p.y, delta));
  }

  // Middle-click + right-click pan. Tracked via Stage listener + internal ref.
  const panState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault();
      panState.current = {
        startX: e.evt.clientX,
        startY: e.evt.clientY,
        panX: vp.pan.x,
        panY: vp.pan.y,
      };
    }
    // Left-click interactions are Phase 1.2+.
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!panState.current) return;
    const dx = e.evt.clientX - panState.current.startX;
    const dy = e.evt.clientY - panState.current.startY;
    setVp((cur) => ({
      ...cur,
      pan: { x: panState.current!.panX + dx, y: panState.current!.panY + dy },
    }));
  }

  function handleMouseUp() {
    panState.current = null;
  }

  // Suppress browser context menu so right-click pan works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: MouseEvent) => e.preventDefault();
    el.addEventListener('contextmenu', h);
    return () => el.removeEventListener('contextmenu', h);
  }, []);

  function classColor(idx: number) {
    return classes[idx]?.color ?? '#888';
  }

  function renderBox(box: Box) {
    const bx = (box.x - box.w / 2) * natW;
    const by = (box.y - box.h / 2) * natH;
    const bw = box.w * natW;
    const bh = box.h * natH;
    const tl = imgToDisp(bx, by, vp);
    const dispW = bw * vp.zoom;
    const dispH = bh * vp.zoom;
    const isSel = selectedId === box.id;
    return (
      <Group key={box.id}>
        <Rect
          x={tl.x}
          y={tl.y}
          width={dispW}
          height={dispH}
          stroke={classColor(box.classIdx)}
          strokeWidth={isSel ? 3 : 2}
          dash={box.source === 'gemini' ? [6, 4] : undefined}
        />
        <Text
          x={tl.x}
          y={tl.y - 14}
          text={`${classes[box.classIdx]?.name ?? '?'}${box.source === 'gemini' ? ' (AI)' : ''}`}
          fontSize={11}
          fontStyle={isSel ? 'bold' : 'normal'}
          fill={classColor(box.classIdx)}
        />
      </Group>
    );
  }

  // Image render rect in display coords.
  const imgTL = imgToDisp(0, 0, vp);
  const imgDispW = natW * vp.zoom;
  const imgDispH = natH * vp.zoom;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ cursor: readOnly ? 'grab' : 'default' }}
    >
      <Stage
        width={containerSize.w}
        height={containerSize.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {img && (
            <KImage image={img} x={imgTL.x} y={imgTL.y} width={imgDispW} height={imgDispH} />
          )}
          {boxes.map(renderBox)}
        </Layer>
      </Stage>
    </div>
  );
}
