export type YoloBox = {
  classIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function parseYoloLabel(text: string): YoloBox[] {
  const boxes: YoloBox[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) throw new Error(`Bad YOLO line: ${line}`);
    const classIdx = parseInt(parts[0], 10);
    const [x, y, w, h] = parts.slice(1).map(parseFloat);
    if (!Number.isFinite(classIdx) || classIdx < 0) {
      throw new Error(`Bad class: ${line}`);
    }
    for (const v of [x, y, w, h]) {
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`Out of range: ${line}`);
      }
    }
    boxes.push({ classIdx, x, y, w, h });
  }
  return boxes;
}

export function serializeYoloLabel(boxes: YoloBox[]): string {
  return (
    boxes.map((b) => `${b.classIdx} ${b.x} ${b.y} ${b.w} ${b.h}`).join('\n') +
    '\n'
  );
}

export function parseClassesTxt(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
