// ABOUTME: Directory sync apply engine. Ensures PSD401 baseline groups, grants groups from matched mapping rules, and
// ABOUTME: revokes managed groups the user no longer matches per DIRECTORY_SYNC_REVOKE_MODE. Throws on real errors.
import { prisma } from '@documenso/prisma';

import type { TDirectorySyncAuditLogType } from '../../types/directory-sync-audit-logs';
import { generateDatabaseId } from '../../universal/id';
import { env } from '../../utils/env';
import type { SyncGoogleDirectoryStatus } from '../user/sync-google-directory';
import { type PlannedRevocation, planDirectoryMembership } from './plan-directory-membership';
import { ensurePsd401BaselineMembership, findPsd401MemberRows, pickPrimaryMemberRow } from './psd401-membership';

const MEMBERSHIP_GRANTED: TDirectorySyncAuditLogType = 'MEMBERSHIP_GRANTED';
const MEMBERSHIP_REVOKED: TDirectorySyncAuditLogType = 'MEMBERSHIP_REVOKED';
const MEMBERSHIP_REVOKE_DRY_RUN: TDirectorySyncAuditLogType = 'MEMBERSHIP_REVOKE_DRY_RUN';

const REVOKE_REASON_NO_MATCHING_MAPPING = 'no_matching_mapping';

/**
 * Only these statuses mean the user's directory fields reflect Google as of this run.
 */
const REVOCATION_TRUSTED_SYNC_STATUSES: readonly SyncGoogleDirectoryStatus[] = ['synced', 'throttled'];

export type DirectorySyncRevokeMode = 'enforce' | 'log' | 'off';

export const getDirectorySyncRevokeMode = (): DirectorySyncRevokeMode => {
  const mode = env('DIRECTORY_SYNC_REVOKE_MODE');

  return mode === 'enforce' || mode === 'off' ? mode : 'log';
};

export type DirectorySyncActor = {
  userId: number | null;
  name: string | null;
  email: string | null;
};

export const DIRECTORY_SYNC_SYSTEM_ACTOR: DirectorySyncActor = {
  userId: null,
  name: 'directory-sync',
  email: null,
};

export type ApplyDirectoryMappingsSource = 'login' | 'sweep';

export type ApplyDirectoryMappingsOptions = {
  /** Return planned revocations instead of applying them, so the caller can gate them (sweep circuit breaker). */
  deferRevocations?: boolean;
};

export type ApplyDirectoryMappingsResult = {
  granted: number;
  deferredRevocations: PlannedRevocation[];
};

export const applyDirectoryMappings = async (
  userId: number,
  source: ApplyDirectoryMappingsSource,
  syncStatus: SyncGoogleDirectoryStatus,
  { deferRevocations = false }: ApplyDirectoryMappingsOptions = {},
): Promise<ApplyDirectoryMappingsResult> => {
  const noChanges: ApplyDirectoryMappingsResult = { granted: 0, deferredRevocations: [] };

  await ensurePsd401BaselineMembership(userId);

  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    return noChanges;
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
    return noChanges;
  }

  const mappings = await prisma.directoryGroupMapping.findMany({
    select: {
      id: true,
      sourceField: true,
      sourceValue: true,
      organisationGroupId: true,
      active: true,
    },
  });

  const memberRows = await findPsd401MemberRows(userId);
  const primaryMemberRow = pickPrimaryMemberRow(memberRows);

  if (!primaryMemberRow) {
    console.warn(`[directory-sync] applyDirectoryMappings: user ${userId} has no PSD401 member row`);
    return noChanges;
  }

  const plan = planDirectoryMembership({
    mappings,
    profile: {
      department: user.department,
      orgUnitPath: user.orgUnitPath,
      googleGroups: user.googleGroups,
    },
    heldMemberships: memberRows.flatMap((row) => row.organisationGroupMembers),
  });

  const actor: DirectorySyncActor =
    source === 'login' ? { userId, name: user.name, email: user.email } : DIRECTORY_SYNC_SYSTEM_ACTOR;

  let granted = 0;

  if (plan.grants.length > 0) {
    const mappingIdsByGroup = new Map(plan.grants.map((grant) => [grant.organisationGroupId, grant.mappingIds]));

    granted = await prisma.$transaction(async (tx) => {
      const inserted = await tx.organisationGroupMember.createManyAndReturn({
        data: plan.grants.map((grant) => ({
          id: generateDatabaseId('group_member'),
          groupId: grant.organisationGroupId,
          organisationMemberId: primaryMemberRow.id,
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
              organisationMemberId: primaryMemberRow.id,
              organisationGroupId: row.groupId,
              mappingIds: mappingIdsByGroup.get(row.groupId) ?? [],
            },
          })),
        });
      }

      return inserted.length;
    });
  }

  const revocations =
    REVOCATION_TRUSTED_SYNC_STATUSES.includes(syncStatus) && getDirectorySyncRevokeMode() !== 'off'
      ? plan.revocations
      : [];

  if (deferRevocations) {
    return { granted, deferredRevocations: revocations };
  }

  await applyDirectoryRevocations({ targetUserId: userId, revocations, actor });

  return { granted, deferredRevocations: [] };
};

export type ApplyDirectoryRevocationsResult = {
  revoked: number;
  dryRun: number;
};

/**
 * Applies one user's planned revocations in a single transaction: 'enforce' deletes the rows and
 * writes MEMBERSHIP_REVOKED for each row actually deleted; 'log' deletes nothing and writes
 * MEMBERSHIP_REVOKE_DRY_RUN rows; 'off' does nothing.
 */
export const applyDirectoryRevocations = async ({
  targetUserId,
  revocations,
  actor,
}: {
  targetUserId: number;
  revocations: PlannedRevocation[];
  actor: DirectorySyncActor;
}): Promise<ApplyDirectoryRevocationsResult> => {
  const mode = getDirectorySyncRevokeMode();

  if (mode === 'off' || revocations.length === 0) {
    return { revoked: 0, dryRun: 0 };
  }

  return await prisma.$transaction(async (tx) => {
    const actioned: PlannedRevocation[] = [];

    if (mode === 'enforce') {
      for (const revocation of revocations) {
        const { count } = await tx.organisationGroupMember.deleteMany({
          where: { id: revocation.organisationGroupMemberId },
        });

        if (count > 0) {
          actioned.push(revocation);
        }
      }
    } else {
      actioned.push(...revocations);
    }

    if (actioned.length > 0) {
      await tx.directorySyncAuditLog.createMany({
        data: actioned.map((revocation) => ({
          type: mode === 'enforce' ? MEMBERSHIP_REVOKED : MEMBERSHIP_REVOKE_DRY_RUN,
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          data: {
            targetUserId,
            organisationMemberId: revocation.organisationMemberId,
            organisationGroupId: revocation.organisationGroupId,
            reason: REVOKE_REASON_NO_MATCHING_MAPPING,
          },
        })),
      });
    }

    return mode === 'enforce' ? { revoked: actioned.length, dryRun: 0 } : { revoked: 0, dryRun: actioned.length };
  });
};
