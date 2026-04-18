'use client';

import type { ClassDef } from './types';

export function ClassPalette({
  classes,
  activeIdx,
  onSelect,
  counts,
}: {
  classes: ClassDef[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  counts?: number[];
}) {
  return (
    <div className="p-3 space-y-1">
      <div className="text-xs uppercase text-gray-500 mb-2">Classes</div>
      {classes.map((c) => {
        const isActive = c.idx === activeIdx;
        const count = counts?.[c.idx] ?? 0;
        return (
          <button
            key={c.idx}
            onClick={() => onSelect(c.idx)}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-sm text-left ${
              isActive ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            <span className="flex-1">{c.name}</span>
            {counts && (
              <span
                className={`text-[11px] tabular-nums ${
                  isActive ? 'text-gray-300' : 'text-gray-500'
                }`}
              >
                {count}
              </span>
            )}
            <span className="text-[10px] border px-1 rounded uppercase">
              {c.shortcut ?? c.idx + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
