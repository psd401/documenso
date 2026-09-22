// ABOUTME: Deletes a directory mapping rule and writes a MAPPING_DELETED audit row, in one
// ABOUTME: transaction. Existing OrganisationGroupMember rows already inserted by earlier
// ABOUTME: syncs are untouched, matching the additive-only invariant.
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';

export type DeleteDirectoryMappingOptions = {
  id: string;
  actor: { userId: number; name: string | null; email: string };
};

export const deleteDirectoryMapping = async (options: DeleteDirectoryMappingOptions) => {
  const { id, actor } = options;

  const existing = await prisma.directoryGroupMapping.findFirst({ where: { id } });

  if (!existing) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Directory mapping not found' });
  }

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.delete({ where: { id } });

    await tx.directorySyncAuditLog.create({
      data: {
        type: 'MAPPING_DELETED',
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        data: {
          mappingId: existing.id,
          changes: {
            sourceField: { from: existing.sourceField, to: null },
            sourceValue: { from: existing.sourceValue, to: null },
            organisationGroupId: { from: existing.organisationGroupId, to: null },
            active: { from: existing.active, to: null },
          },
        },
      },
    });

    return mapping;
  });
};
