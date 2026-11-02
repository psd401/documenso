// ABOUTME: Guards that keep directory data from ever conferring ADMIN: a mapping cannot target a group that grants
// ABOUTME: org or team ADMIN, and a group an active mapping targets cannot be given ADMIN.
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { groupGrantsAdmin } from './plan-directory-membership';

/** Prisma filter for an OrganisationGroup that grants ADMIN; the query form of groupGrantsAdmin. */
export const ADMIN_GRANTING_GROUP_WHERE = {
  OR: [{ organisationRole: 'ADMIN' as const }, { teamGroups: { some: { teamRole: 'ADMIN' as const } } }],
};

export const assertMappingTargetAllowed = async (organisationGroupId: string) => {
  const group = await prisma.organisationGroup.findUnique({
    where: { id: organisationGroupId },
    select: { organisationRole: true, teamGroups: { select: { teamRole: true } } },
  });

  if (!group) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Organisation group not found' });
  }

  if (groupGrantsAdmin(group)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'A directory mapping cannot target a group that grants admin access',
    });
  }
};

/**
 * Call before a change that gives these groups ADMIN (org role or a team link). Rejects it when an active
 * directory mapping targets any of them, since their members were added from directory data.
 */
export const assertGroupsNotDirectoryMapped = async (organisationGroupIds: string[]) => {
  if (organisationGroupIds.length === 0) {
    return;
  }

  const mapping = await prisma.directoryGroupMapping.findFirst({
    where: { organisationGroupId: { in: organisationGroupIds }, active: true },
    select: { id: true, organisationGroupId: true },
  });

  if (mapping) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Directory sync manages this group, so it cannot be given admin access. Deactivate its mapping first.',
    });
  }
};
