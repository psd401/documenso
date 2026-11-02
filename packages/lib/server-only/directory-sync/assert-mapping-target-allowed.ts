// ABOUTME: Rejects a directory mapping whose target group grants organisation or team ADMIN, so directory
// ABOUTME: data can never confer admin access. Shared by createDirectoryMapping and updateDirectoryMapping.
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { groupGrantsAdmin } from './plan-directory-membership';

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
