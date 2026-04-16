import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export async function writeAudit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  payload: Prisma.JsonValue,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType,
      targetId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}
