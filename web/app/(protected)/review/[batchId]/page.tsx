import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole } from '@/lib/rbac';
import { ReviewTray } from './review-tray';
import { notFound } from 'next/navigation';

export default async function ReviewBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await getSession();
  requireRole(session?.user.role, 'image.approve');
  const { batchId } = await params;

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { project: true },
  });
  if (!batch) notFound();

  const images = await prisma.image.findMany({
    where: { batchId, state: 'under_review' },
    include: { annotations: true },
    orderBy: { id: 'asc' },
  });

  const classes = batch.project.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;

  return (
    <ReviewTray
      batchName={batch.name}
      projectName={batch.project.name}
      classes={classes}
      images={images.map((img) => ({
        id: img.id,
        imageUrl: img.blobPath,
        boxes: img.annotations.map((a) => ({
          id: a.id,
          classIdx: a.classIdx,
          x: a.x,
          y: a.y,
          w: a.w,
          h: a.h,
          source: a.source as 'gemini' | 'human',
        })),
      }))}
    />
  );
}
