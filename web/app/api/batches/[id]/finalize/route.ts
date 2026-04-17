import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';
import { validateAndExtractZip } from '@/lib/zip-validator';
import { parseYoloLabel, parseClassesTxt } from '@/lib/yolo';
import { putImage, blobKey, sniffImageMime } from '@/lib/blob';

const FinalizeBody = z.object({
  zipUrl: z
    .url()
    .refine((u) => {
      try {
        const parsed = new URL(u);
        return (
          parsed.protocol === 'https:' &&
          (parsed.hostname.endsWith('.public.blob.vercel-storage.com') ||
            parsed.hostname.endsWith('.blob.vercel-storage.com'))
        );
      } catch {
        return false;
      }
    }, 'zipUrl must be a Vercel Blob https URL'),
});

const UNKNOWN_DIM = 0;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const denial = authzOr401(session, 'batch.upload', req);
  if (denial) return denial;
  const { id: batchId } = await params;

  try {
    const { zipUrl } = FinalizeBody.parse(await req.json());

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { project: true },
    });
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    if (batch.state !== 'pending_upload') {
      return NextResponse.json(
        { error: `Batch already finalized (state=${batch.state})` },
        { status: 409 },
      );
    }

    const zipResp = await fetch(zipUrl);
    if (!zipResp.ok) {
      return NextResponse.json(
        { error: `Cannot fetch zip from blob (${zipResp.status})` },
        { status: 502 },
      );
    }
    const zipBuf = new Uint8Array(await zipResp.arrayBuffer());

    const entries = validateAndExtractZip(zipBuf, {
      maxEntries: 1200,
      maxTotalBytes: 500 * 1024 * 1024,
      maxFileBytes: 20 * 1024 * 1024,
      maxCompressedBytes: 200 * 1024 * 1024,
    });

    const classesTxt = entries['classes.txt'];
    if (!classesTxt) {
      return NextResponse.json(
        { error: 'classes.txt missing from zip root' },
        { status: 400 },
      );
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
      const expected = projectClasses.map((c) => c.name).join(', ');
      const got = classNames.join(', ');
      return NextResponse.json(
        {
          error: `classes.txt does not match project classes. expected=[${expected}] got=[${got}]`,
        },
        { status: 400 },
      );
    }

    const imageEntries = Object.entries(entries).filter(
      ([p]) => p.startsWith('images/') && /\.(jpe?g|png|bmp)$/i.test(p),
    );
    if (imageEntries.length === 0) {
      return NextResponse.json(
        { error: 'No images found under images/' },
        { status: 400 },
      );
    }
    if (imageEntries.length > 500) {
      return NextResponse.json(
        { error: `Too many images (${imageEntries.length} > 500)` },
        { status: 400 },
      );
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

          const sniffed = sniffImageMime(imgData);
          if (!sniffed) {
            throw Object.assign(
              new Error(`Unsupported or spoofed image: ${imgPath}`),
              { status: 400 },
            );
          }
          const blob = await putImage(
            blobKey(batchId, filename),
            imgData,
            sniffed,
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
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const status = typeof e.status === 'number' ? e.status : 500;
    const message = e.message ?? 'finalize failed';
    console.error('[finalize]', batchId, status, message, err);
    return NextResponse.json({ error: message }, { status });
  }
}
