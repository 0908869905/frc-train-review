export type ClassDef = { idx: number; name: string; color: string };

export type Box = {
  id: string;
  classIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'gemini' | 'human';
};
