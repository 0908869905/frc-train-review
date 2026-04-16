'use client';

import { useEffect, useState } from 'react';
import { Stage, Layer, Rect, Image as KImage, Text, Group } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import type { Box, ClassDef } from './types';

type Props = {
  imageUrl: string;
  classes: ClassDef[];
  activeClassIdx: number;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  width: number;
  height: number;
};

export function AnnotationCanvas({
  imageUrl,
  classes,
  activeClassIdx,
  boxes,
  onChange,
  width,
  height,
}: Props) {
  const [img] = useImage(imageUrl);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const natW = img?.naturalWidth ?? 1;
  const natH = img?.naturalHeight ?? 1;
  const scale = Math.min(width / natW, height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;

  function toNorm(px: number, total: number) {
    return Math.max(0, Math.min(1, px / total));
  }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (drawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setDrawing({
      id: crypto.randomUUID(),
      classIdx: activeClassIdx,
      x: toNorm(pos.x, dispW),
      y: toNorm(pos.y, dispH),
      w: 0,
      h: 0,
      source: 'human',
    });
    setSelectedId(null);
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const nx = toNorm(pos.x, dispW);
    const ny = toNorm(pos.y, dispH);
    setDrawing({ ...drawing, w: nx - drawing.x, h: ny - drawing.y });
  }

  function handleMouseUp() {
    if (!drawing) return;
    const cx = drawing.x + drawing.w / 2;
    const cy = drawing.y + drawing.h / 2;
    const aw = Math.abs(drawing.w);
    const ah = Math.abs(drawing.h);
    if (aw < 0.01 || ah < 0.01) {
      setDrawing(null);
      return;
    }
    const normalized: Box = {
      ...drawing,
      x: cx,
      y: cy,
      w: aw,
      h: ah,
      source: 'human',
    };
    onChange([...boxes, normalized]);
    setDrawing(null);
  }

  function classColor(idx: number) {
    return classes[idx]?.color ?? '#888';
  }

  function renderBox(box: Box) {
    const bx = (box.x - box.w / 2) * dispW;
    const by = (box.y - box.h / 2) * dispH;
    const bw = box.w * dispW;
    const bh = box.h * dispH;
    const isSelected = selectedId === box.id;
    return (
      <Group key={box.id} onClick={() => setSelectedId(box.id)}>
        <Rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          stroke={classColor(box.classIdx)}
          strokeWidth={isSelected ? 3 : 2}
          dash={box.source === 'gemini' ? [6, 4] : undefined}
        />
        <Text
          x={bx}
          y={by - 14}
          text={`${classes[box.classIdx]?.name ?? '?'}${box.source === 'gemini' ? ' (AI)' : ''}`}
          fontSize={11}
          fill={classColor(box.classIdx)}
        />
      </Group>
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    onChange(boxes.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, boxes]);

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer>
        {img && <KImage image={img} width={dispW} height={dispH} />}
        {boxes.map(renderBox)}
        {drawing && (
          <Rect
            x={drawing.x * dispW}
            y={drawing.y * dispH}
            width={drawing.w * dispW}
            height={drawing.h * dispH}
            stroke={classColor(drawing.classIdx)}
            strokeWidth={2}
            dash={[4, 2]}
          />
        )}
      </Layer>
    </Stage>
  );
}
