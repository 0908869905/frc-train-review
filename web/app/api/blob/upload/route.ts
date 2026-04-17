import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';
import { prisma } from '@/lib/db';

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  const session = await getSession();
  const denial = authzOr401(session, 'batch.upload', req);
  if (denial) return denial;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const PREFIX = 'frc-annotation/batches/';
        if (!pathname.startsWith(PREFIX)) {
          throw new Error('Invalid upload path');
        }
        const rest = pathname.slice(PREFIX.length);
        const batchId = rest.split('/')[0];
        if (!batchId) throw new Error('Invalid upload path');
        const batch = await prisma.batch.findUnique({
          where: { id: batchId },
          select: { state: true, uploaderId: true },
        });
        if (!batch || batch.state !== 'pending_upload') {
          throw new Error('Batch not accepting uploads');
        }
        if (batch.uploaderId !== session!.user.id) {
          throw new Error('Not your batch');
        }
        return {
          allowedContentTypes: [
            'application/zip',
            'application/x-zip-compressed',
          ],
          maximumSizeInBytes: 500 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: session!.user.id }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('upload completed', blob.url, tokenPayload);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
