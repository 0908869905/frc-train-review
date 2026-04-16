import { put, del } from '@vercel/blob';
import type { PutBlobResult } from '@vercel/blob';

const PREFIX = 'frc-annotation';

export async function putImage(
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<PutBlobResult> {
  return put(`${PREFIX}/${key}`, new Blob([data as BlobPart], { type: contentType }), {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

export async function deleteBlob(url: string) {
  return del(url);
}

export function blobKey(batchId: string, filename: string): string {
  return `batches/${batchId}/${filename}`;
}
