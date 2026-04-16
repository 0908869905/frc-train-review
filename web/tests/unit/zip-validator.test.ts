import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { validateAndExtractZip } from '@/lib/zip-validator';

function makeZip(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) data[k] = strToU8(v);
  return zipSync(data);
}

describe('validateAndExtractZip', () => {
  it('rejects path traversal', () => {
    const buf = makeZip({ '../evil.txt': 'bad' });
    expect(() =>
      validateAndExtractZip(buf, {
        maxEntries: 10,
        maxTotalBytes: 1e6,
        maxFileBytes: 1e5,
      }),
    ).toThrow(/path traversal/i);
  });

  it('rejects too many entries', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`f${i}.txt`] = 'x';
    const buf = makeZip(files);
    expect(() =>
      validateAndExtractZip(buf, {
        maxEntries: 10,
        maxTotalBytes: 1e6,
        maxFileBytes: 1e5,
      }),
    ).toThrow(/too many/i);
  });

  it('extracts valid flat structure', () => {
    const buf = makeZip({ 'a.txt': 'hello', 'b.txt': 'world' });
    const out = validateAndExtractZip(buf, {
      maxEntries: 10,
      maxTotalBytes: 1e6,
      maxFileBytes: 1e5,
    });
    expect(Object.keys(out).sort()).toEqual(['a.txt', 'b.txt']);
  });
});
