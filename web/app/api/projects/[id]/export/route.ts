import { NextResponse } from 'next/server';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { put } from '@vercel/blob';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { authzOr401 } from '@/lib/rbac';
import { serializeYoloLabel } from '@/lib/yolo';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  const denial = authzOr401(session, 'export.download', req);
  if (denial) return denial;
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const classes = project.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;

  const images = await prisma.image.findMany({
    where: { batch: { projectId: id }, state: 'approved' },
    include: { annotations: true },
  });
  if (images.length === 0) {
    return NextResponse.json(
      { error: 'No approved images to export' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, data, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        if (data.length > 0) controller.enqueue(data);
        if (final) controller.close();
      });

      const addText = (name: string, text: string) => {
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(strToU8(text), true);
      };

      (async () => {
        try {
          addText(
            'classes.txt',
            classes.map((c) => c.name).join('\n') + '\n',
          );
          addText(
            'data.yaml',
            [
              'train: ./images',
              'val: ./images',
              `nc: ${classes.length}`,
              `names: [${classes.map((c) => `'${c.name}'`).join(', ')}]`,
              '',
            ].join('\n'),
          );

          for (let i = 0; i < images.length; i++) {
            const img = images[i];
            let bytes: Uint8Array | null = null;
            try {
              const u = new URL(img.blobPath);
              if (
                u.protocol !== 'https:' ||
                !(
                  u.hostname.endsWith('.public.blob.vercel-storage.com') ||
                  u.hostname.endsWith('.blob.vercel-storage.com')
                )
              ) {
                continue;
              }
              const resp = await fetch(img.blobPath);
              if (!resp.ok) continue;
              bytes = new Uint8Array(await resp.arrayBuffer());
            } catch {
              continue;
            }

            const filename = `img_${String(i).padStart(6, '0')}.jpg`;
            const imgEntry = new ZipPassThrough(`images/${filename}`);
            zip.add(imgEntry);
            imgEntry.push(bytes, true);

            const labelText = serializeYoloLabel(
              img.annotations.map((a) => ({
                classIdx: a.classIdx,
                x: a.x,
                y: a.y,
                w: a.w,
                h: a.h,
              })),
            );
            const labelEntry = new ZipPassThrough(
              `labels/${filename.replace(/\.jpg$/, '.txt')}`,
            );
            zip.add(labelEntry);
            labelEntry.push(strToU8(labelText), true);
          }
          zip.end();
        } catch (err) {
          controller.error(err);
        }
      })();
    },
  });

  const safeName =
    project.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'project';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${safeName}-yolo-${stamp}.zip`;
  const key = `frc-annotation/exports/${id}/${filename}`;

  try {
    const result = await put(key, stream, {
      access: 'public',
      contentType: 'application/zip',
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: true,
    });
    return NextResponse.json({
      url: result.url,
      filename,
      imageCount: images.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'export failed';
    console.error('[export]', id, message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
