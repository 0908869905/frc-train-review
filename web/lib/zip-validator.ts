import { unzipSync } from 'fflate';

export type ZipLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxCompressedBytes?: number;
};

export function validateAndExtractZip(
  buf: Uint8Array,
  limits: ZipLimits,
): Record<string, Uint8Array> {
  if (
    limits.maxCompressedBytes !== undefined &&
    buf.length > limits.maxCompressedBytes
  ) {
    throw new Error(
      `compressed too big: ${buf.length} > ${limits.maxCompressedBytes}`,
    );
  }

  const entries = unzipSync(buf);
  const keys = Object.keys(entries);

  if (keys.length > limits.maxEntries) {
    throw new Error(`too many entries: ${keys.length} > ${limits.maxEntries}`);
  }

  let total = 0;
  for (const [path, data] of Object.entries(entries)) {
    const normalized = path.replace(/\\/g, '/');
    if (
      normalized.includes('..') ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      /[\0\x01-\x1f]/.test(normalized)
    ) {
      throw new Error(`path traversal: ${path}`);
    }
    if (data.length > limits.maxFileBytes) {
      throw new Error(`file too big: ${path} (${data.length} bytes)`);
    }
    total += data.length;
    if (total > limits.maxTotalBytes) {
      throw new Error(`total too big: ${total}`);
    }
  }

  return entries;
}
