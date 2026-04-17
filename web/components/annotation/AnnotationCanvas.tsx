'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import useImage from 'use-image';
import type Konva from 'konva';
import type { Box, ClassDef } from './types';
import {
  imgToDisp,
  dispToImg,
  computeFitView,
  applyWheelZoom,
  type Viewport,
} from './viewport';
import { hitTestBox } from './hit-test';
import { clampMoveNorm, commitDraw } from './editor-actions';

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
  activeClassIdx,
  onChange,
  onSelect,
}: Props) {
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

  type DragAction =
    | null
    | { kind: 'move'; id: string; startImgX: number; startImgY: number; orig: Box }
    | { kind: 'draw'; startImgX: number; startImgY: number; curImgX: number; curImgY: number };

  const dragState = useRef<DragAction>(null);
  const [drawPreview, setDrawPreview] = useState<{
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null); // image coords
  const [isPanning, setIsPanning] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Pan first (middle/right button)
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault();
      panState.current = {
        startX: e.evt.clientX,
        startY: e.evt.clientY,
        panX: vp.pan.x,
        panY: vp.pan.y,
      };
      setIsPanning(true);
      return;
    }
    if (readOnly) return;
    if (e.evt.button !== 0) return;

    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;

    // Priority: handle > box > empty. Handle-hit is added in Task 1.3.
    const hitId = hitTestBox(p.x, p.y, boxes, natW, natH, vp);
    if (hitId) {
      onSelect(hitId);
      const orig = boxes.find((b) => b.id === hitId);
      if (!orig) return;
      const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);
      dragState.current = {
        kind: 'move',
        id: hitId,
        startImgX: ix,
        startImgY: iy,
        orig,
      };
      return;
    }

    // Empty: start draw. (Defer deselect to mouseup if no drag.)
    const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);
    dragState.current = {
      kind: 'draw',
      startImgX: ix,
      startImgY: iy,
      curImgX: ix,
      curImgY: iy,
    };
    setIsDrawing(true);
    setDrawPreview({ x1: ix, y1: iy, x2: ix, y2: iy });
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    // Pan
    if (panState.current) {
      const dx = e.evt.clientX - panState.current.startX;
      const dy = e.evt.clientY - panState.current.startY;
      setVp((cur) => ({
        ...cur,
        pan: { x: panState.current!.panX + dx, y: panState.current!.panY + dy },
      }));
      return;
    }

    if (!dragState.current) return;
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;
    const { x: ix, y: iy } = dispToImg(p.x, p.y, vp);

    if (dragState.current.kind === 'move') {
      const s = dragState.current;
      const dx = (ix - s.startImgX) / natW;
      const dy = (iy - s.startImgY) / natH;
      const moved = clampMoveNorm({
        ...s.orig,
        x: s.orig.x + dx,
        y: s.orig.y + dy,
      });
      onChange(boxes.map((b) => (b.id === s.id ? moved : b)));
    } else if (dragState.current.kind === 'draw') {
      dragState.current.curImgX = ix;
      dragState.current.curImgY = iy;
      setDrawPreview({
        x1: dragState.current.startImgX,
        y1: dragState.current.startImgY,
        x2: ix,
        y2: iy,
      });
    }
  }

  function handleMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
    if (panState.current) {
      panState.current = null;
      setIsPanning(false);
      return;
    }
    if (!dragState.current) return;
    if (e.evt.button !== 0) return;

    const action = dragState.current;
    dragState.current = null;

    if (action.kind === 'move') {
      // Already committed in handleMouseMove; nothing to do.
    } else if (action.kind === 'draw') {
      setIsDrawing(false);
      const dw = Math.abs(action.curImgX - action.startImgX);
      const dh = Math.abs(action.curImgY - action.startImgY);
      // < 5 image-pixel drag treated as a plain click → deselect.
      if (dw < 5 && dh < 5) {
        onSelect(null);
        setDrawPreview(null);
        return;
      }
      const newBox = commitDraw(
        {
          x1: action.startImgX,
          y1: action.startImgY,
          x2: action.curImgX,
          y2: action.curImgY,
        },
        natW,
        natH,
        activeClassIdx
      );
      setDrawPreview(null);
      if (!newBox) return;
      onChange([...boxes, newBox]);
      onSelect(newBox.id);
    }
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

  const [hoverBoxId, setHoverBoxId] = useState<string | null>(null);

  function handleMouseMoveForHover(e: Konva.KonvaEventObject<MouseEvent>) {
    handleMouseMove(e);
    if (dragState.current || panState.current) return;
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;
    const id = hitTestBox(p.x, p.y, boxes, natW, natH, vp);
    setHoverBoxId(id);
  }

  const cursor = readOnly
    ? isPanning
      ? 'grabbing'
      : 'grab'
    : isPanning
      ? 'grabbing'
      : isDrawing
        ? 'crosshair'
        : hoverBoxId
          ? 'move'
          : 'crosshair';

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ cursor }}
    >
      <Stage
        width={containerSize.w}
        height={containerSize.h}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveForHover}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {img && (
            <KImage image={img} x={imgTL.x} y={imgTL.y} width={imgDispW} height={imgDispH} />
          )}
          {boxes.map(renderBox)}
          {drawPreview && (() => {
            const tl = imgToDisp(
              Math.min(drawPreview.x1, drawPreview.x2),
              Math.min(drawPreview.y1, drawPreview.y2),
              vp
            );
            const w = Math.abs(drawPreview.x2 - drawPreview.x1) * vp.zoom;
            const h = Math.abs(drawPreview.y2 - drawPreview.y1) * vp.zoom;
            return (
              <Rect
                x={tl.x}
                y={tl.y}
                width={w}
                height={h}
                stroke="#e0b400"
                strokeWidth={2}
                dash={[4, 2]}
                listening={false}
              />
            );
          })()}
        </Layer>
      </Stage>
    </div>
  );
}
