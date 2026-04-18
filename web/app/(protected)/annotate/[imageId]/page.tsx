import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import { Editor } from './editor';

export default async function AnnotatePage({
  params,
}: {
  params: Promise<{ imageId: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  const { imageId } = await params;

  const image = await prisma.image.findUnique({
    where: { id: imageId },
    include: {
      annotations: true,
      batch: { include: { project: true } },
    },
  });
  if (!image) notFound();
  if (image.assignedToId !== session.user.id) {
    return <main className="p-8">Not your image.</main>;
  }

  const queue = await prisma.image.findMany({
    where: {
      assignedToId: session.user.id,
      state: { in: ['assigned', 'needs_rework', 'annotated'] },
    },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });

  const classes = image.batch.project.classes as Array<{
    idx: number;
    name: string;
    color: string;
  }>;

  return (
    <Editor
      imageId={image.id}
      imageUrl={image.blobPath}
      imageState={image.state}
      classes={classes}
      initialBoxes={image.annotations.map((a) => ({
        id: a.id,
        classIdx: a.classIdx,
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
        source: a.source as 'gemini' | 'human',
      }))}
      initialUpdatedAt={image.updatedAt.toISOString()}
      queueIds={queue.map((q) => q.id)}
      batchName={image.batch.name}
      projectName={image.batch.project.name}
    />
  );
}
