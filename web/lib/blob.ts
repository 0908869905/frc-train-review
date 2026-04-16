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
    allowOverwrite: false,
  });
}

export async function deleteBlob(url: string) {
  return del(url);
}

export function blobKey(batchId: string, filename: string): string {
  return `batches/${batchId}/${filename}`;
}
