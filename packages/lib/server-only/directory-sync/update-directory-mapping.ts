// ABOUTME: Updates a directory mapping rule and writes a field-level MAPPING_UPDATED audit row,
// ABOUTME: in one transaction. Normalizes sourceValue against the effective post-update sourceField.
import type { DirectoryMappingSourceField } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { normalizeMappingSourceValue } from './mapping-matching';

export type UpdateDirectoryMappingData = Partial<{
  sourceField: DirectoryMappingSourceField;
  sourceValue: string;
  organisationGroupId: string;
  active: boolean;
}>;

export type UpdateDirectoryMappingOptions = {
  id: string;
  data: UpdateDirectoryMappingData;
  actor: { userId: number; name: string | null; email: string };
};

export const updateDirectoryMapping = async (options: UpdateDirectoryMappingOptions) => {
  const { id, data, actor } = options;

  const existing = await prisma.directoryGroupMapping.findFirst({ where: { id } });

  if (!existing) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Directory mapping not found' });
  }

  const effectiveSourceField = data.sourceField ?? existing.sourceField;

  const nextSourceValue =
    data.sourceValue !== undefined
      ? normalizeMappingSourceValue(effectiveSourceField, data.sourceValue)
      : existing.sourceValue;

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (data.sourceField !== undefined && data.sourceField !== existing.sourceField) {
    changes.sourceField = { from: existing.sourceField, to: data.sourceField };
  }

  if (nextSourceValue !== existing.sourceValue) {
    changes.sourceValue = { from: existing.sourceValue, to: nextSourceValue };
  }

  if (
    data.organisationGroupId !== undefined &&
    data.organisationGroupId !== existing.organisationGroupId
  ) {
    changes.organisationGroupId = {
      from: existing.organisationGroupId,
      to: data.organisationGroupId,
    };
  }

  if (data.active !== undefined && data.active !== existing.active) {
    changes.active = { from: existing.active, to: data.active };
  }

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.update({
      where: { id },
      data: {
        sourceField: effectiveSourceField,
        sourceValue: nextSourceValue,
        organisationGroupId: data.organisationGroupId ?? existing.organisationGroupId,
        active: data.active ?? existing.active,
      },
    });

    if (Object.keys(changes).length > 0) {
      await tx.directorySyncAuditLog.create({
        data: {
          type: 'MAPPING_UPDATED',
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          data: { mappingId: mapping.id, changes },
        },
      });
    }

    return mapping;
  });
};
