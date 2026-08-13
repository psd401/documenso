// ABOUTME: Creates a directory mapping rule and writes a MAPPING_CREATED audit row, in one transaction.
import type { DirectoryMappingSourceField } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { generateDatabaseId } from '../../universal/id';
import { normalizeMappingSourceValue } from './mapping-matching';

export type CreateDirectoryMappingOptions = {
  sourceField: DirectoryMappingSourceField;
  sourceValue: string;
  organisationGroupId: string;
  active?: boolean;
  actor: { userId: number; name: string | null; email: string };
};

export const createDirectoryMapping = async (options: CreateDirectoryMappingOptions) => {
  const { sourceField, sourceValue, organisationGroupId, active = true, actor } = options;

  const normalizedValue = normalizeMappingSourceValue(sourceField, sourceValue);

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.create({
      data: {
        id: generateDatabaseId('directory_mapping'),
        sourceField,
        sourceValue: normalizedValue,
        organisationGroupId,
        active,
      },
    });

    await tx.directorySyncAuditLog.create({
      data: {
        type: 'MAPPING_CREATED',
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        data: {
          mappingId: mapping.id,
          changes: {
            sourceField: { from: null, to: mapping.sourceField },
            sourceValue: { from: null, to: mapping.sourceValue },
            organisationGroupId: { from: null, to: mapping.organisationGroupId },
            active: { from: null, to: mapping.active },
          },
        },
      },
    });

    return mapping;
  });
};
