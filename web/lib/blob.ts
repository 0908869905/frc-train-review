// Blob URL policy:
// - All blobs are uploaded with randomSuffix=false and predictable paths keyed
//   by batchId. The public URL is served behind the /api/images/[id]/signed-url
//   endpoint, which requires an authenticated session. This keeps unauth users
//   from guessing URLs via the session gate rather than via URL opacity.
// - For higher security (external disclosure risk), migrate to presigned URLs
//   by tracking blob pathnames and generating short-lived tokens — not done
//   in this milestone because it adds complexity unjustified by internal use.
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
    // Allow overwrite so that a finalize retry after a partial failure
    // doesn't throw on blobs that already uploaded on the previous attempt.
    allowOverwrite: true,
  });
}

export function sniffImageMime(data: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export async function deleteBlob(url: string) {
  return del(url);
}

export function blobKey(batchId: string, filename: string): string {
  return `batches/${batchId}/${filename}`;
}
