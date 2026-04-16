import { NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { serializeYoloLabel } from '@/lib/yolo';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  requireRole(session?.user.role, 'export.download');
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw Object.assign(new Error('Not found'), { status: 404 });
  const classes = project.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;

  const images = await prisma.image.findMany({
    where: { batch: { projectId: id }, state: 'approved' },
    include: { annotations: true },
  });

  const zipEntries: Record<string, Uint8Array> = {};

  zipEntries['classes.txt'] = strToU8(
    classes.map((c) => c.name).join('\n') + '\n',
  );

  const dataYaml =
    [
      `train: ./images`,
      `val: ./images`,
      `nc: ${classes.length}`,
      `names: [${classes.map((c) => `'${c.name}'`).join(', ')}]`,
      '',
    ].join('\n');
  zipEntries['data.yaml'] = strToU8(dataYaml);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const resp = await fetch(img.blobPath);
    if (!resp.ok) continue;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const filename = `img_${String(i).padStart(6, '0')}.jpg`;
    zipEntries[`images/${filename}`] = bytes;
    zipEntries[`labels/${filename.replace(/\.jpg$/, '.txt')}`] = strToU8(
      serializeYoloLabel(
        img.annotations.map((a) => ({
          classIdx: a.classIdx,
          x: a.x,
          y: a.y,
          w: a.w,
          h: a.h,
        })),
      ),
    );
  }

  const zipBuf = zipSync(zipEntries);
  return new NextResponse(zipBuf as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${project.name}-yolo.zip"`,
    },
  });
}
