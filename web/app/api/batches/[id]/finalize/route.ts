import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { validateAndExtractZip } from '@/lib/zip-validator';
import { parseYoloLabel, parseClassesTxt } from '@/lib/yolo';
import { putImage, blobKey } from '@/lib/blob';

const FinalizeBody = z.object({
  zipUrl: z.url(),
});

const UNKNOWN_DIM = 0;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'batch.upload');
  const { id: batchId } = await params;
  const { zipUrl } = FinalizeBody.parse(await req.json());

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: true },
  });
  if (!batch) {
    throw Object.assign(new Error('Batch not found'), { status: 404 });
  }
  if (batch.state !== 'pending_upload') {
    throw Object.assign(new Error('Batch already finalized'), { status: 409 });
  }

  const zipResp = await fetch(zipUrl);
  if (!zipResp.ok) {
    throw Object.assign(new Error('Cannot fetch zip'), { status: 502 });
  }
  const zipBuf = new Uint8Array(await zipResp.arrayBuffer());

  const entries = validateAndExtractZip(zipBuf, {
    maxEntries: 1200,
    maxTotalBytes: 500 * 1024 * 1024,
    maxFileBytes: 20 * 1024 * 1024,
  });

  const classesTxt = entries['classes.txt'];
  if (!classesTxt) {
    throw Object.assign(new Error('classes.txt missing'), { status: 400 });
  }
  const classNames = parseClassesTxt(new TextDecoder().decode(classesTxt));
  const projectClasses = batch.project.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;
  if (
    classNames.length !== projectClasses.length ||
    !classNames.every((n, i) => n === projectClasses[i].name)
  ) {
    throw Object.assign(
      new Error('classes.txt does not match project classes'),
      { status: 400 },
    );
  }

  const imageEntries = Object.entries(entries).filter(
    ([p]) => p.startsWith('images/') && /\.(jpe?g|png|bmp)$/i.test(p),
  );
  if (imageEntries.length === 0) {
    throw Object.assign(new Error('No images found'), { status: 400 });
  }
  if (imageEntries.length > 500) {
    throw Object.assign(new Error('Too many images'), { status: 400 });
  }

  await prisma.$transaction(
    async (tx) => {
      for (const [imgPath, imgData] of imageEntries) {
        const filename = imgPath.replace(/^images\//, '');
        const stem = filename.replace(/\.[^.]+$/, '');
        const labelPath = `labels/${stem}.txt`;
        const labelData = entries[labelPath];
        const labelText = labelData
          ? new TextDecoder().decode(labelData)
          : '';
        const boxes = labelText ? parseYoloLabel(labelText) : [];

        const blob = await putImage(
          blobKey(batchId, filename),
          imgData,
          filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        );

        const image = await tx.image.create({
          data: {
            batchId,
            blobPath: blob.url,
            width: UNKNOWN_DIM,
            height: UNKNOWN_DIM,
            state: 'unassigned',
          },
        });

        if (boxes.length > 0) {
          await tx.annotation.createMany({
            data: boxes.map((b) => ({
              imageId: image.id,
              classIdx: b.classIdx,
              x: b.x,
              y: b.y,
              w: b.w,
              h: b.h,
              source: 'gemini' as const,
            })),
          });
        }
      }
      await tx.batch.update({
        where: { id: batchId },
        data: { state: 'ready' },
      });
    },
    { timeout: 120_000 },
  );

  return NextResponse.json({ ok: true });
}
