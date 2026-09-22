// ABOUTME: Additive-only apply engine. Inserts missing OrganisationGroupMember rows for a
// ABOUTME: user's matched directory mapping rules. Throws on real errors; callers handle them.
import { prisma } from '@documenso/prisma';

import { PSD401_ORG_ID } from '../../constants/psd401';
import type { TDirectorySyncAuditLogType } from '../../types/directory-sync-audit-logs';
import { generateDatabaseId } from '../../universal/id';
import { env } from '../../utils/env';
import { matchDirectoryMapping } from './mapping-matching';

const MEMBERSHIP_GRANTED: TDirectorySyncAuditLogType = 'MEMBERSHIP_GRANTED';

export type ApplyDirectoryMappingsSource = 'login' | 'sweep';

export type ApplyDirectoryMappingsResult = {
  granted: number;
};

export const applyDirectoryMappings = async (
  userId: number,
  source: ApplyDirectoryMappingsSource,
): Promise<ApplyDirectoryMappingsResult> => {
  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    return { granted: 0 };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      department: true,
      orgUnitPath: true,
      googleGroups: true,
    },
  });

  if (!user) {
    console.warn(`[directory-sync] applyDirectoryMappings: user ${userId} not found`);
    return { granted: 0 };
  }

  const mappings = await prisma.directoryGroupMapping.findMany({
    where: { active: true },
  });

  const matchedMappingIdsByGroup = new Map<string, string[]>();

  for (const mapping of mappings) {
    const isMatch = matchDirectoryMapping(mapping, {
      department: user.department,
      orgUnitPath: user.orgUnitPath,
      googleGroups: user.googleGroups,
    });

    if (!isMatch) {
      continue;
    }

    const matchedIds = matchedMappingIdsByGroup.get(mapping.organisationGroupId) ?? [];
    matchedIds.push(mapping.id);
    matchedMappingIdsByGroup.set(mapping.organisationGroupId, matchedIds);
  }

  if (matchedMappingIdsByGroup.size === 0) {
    return { granted: 0 };
  }

  const member = await prisma.organisationMember.findFirst({
    where: { userId, organisationId: PSD401_ORG_ID },
    select: { id: true },
  });

  if (!member) {
    console.warn(
      `[directory-sync] applyDirectoryMappings: user ${userId} has no PSD401 member row`,
    );
    return { granted: 0 };
  }

  const existingGroupMembers = await prisma.organisationGroupMember.findMany({
    where: { organisationMemberId: member.id },
    select: { groupId: true },
  });

  const existingGroupIds = new Set(existingGroupMembers.map((row) => row.groupId));

  const missingGroupIds = [...matchedMappingIdsByGroup.keys()].filter(
    (groupId) => !existingGroupIds.has(groupId),
  );

  if (missingGroupIds.length === 0) {
    return { granted: 0 };
  }

  const actor =
    source === 'login'
      ? { userId, name: user.name, email: user.email }
      : { userId: null, name: 'directory-sync', email: null };

  const granted = await prisma.$transaction(async (tx) => {
    const inserted = await tx.organisationGroupMember.createManyAndReturn({
      data: missingGroupIds.map((groupId) => ({
        id: generateDatabaseId('group_member'),
        groupId,
        organisationMemberId: member.id,
      })),
      skipDuplicates: true,
    });

    if (inserted.length > 0) {
      await tx.directorySyncAuditLog.createMany({
        data: inserted.map((row) => ({
          type: MEMBERSHIP_GRANTED,
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          data: {
            targetUserId: userId,
            organisationMemberId: member.id,
            organisationGroupId: row.groupId,
            mappingIds: matchedMappingIdsByGroup.get(row.groupId) ?? [],
          },
        })),
      });
    }

    return inserted.length;
  });

  return { granted };
};
