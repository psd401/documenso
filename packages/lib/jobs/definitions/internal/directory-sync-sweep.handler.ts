// ABOUTME: Nightly sweep handler. Re-syncs directory data, ensures baseline groups, and re-applies group mapping rules
// ABOUTME: for every user with a linked Google account; revocations are applied only if they pass a circuit breaker.
import { prisma } from '@documenso/prisma';

import {
  applyDirectoryMappings,
  applyDirectoryRevocations,
  DIRECTORY_SYNC_SYSTEM_ACTOR,
  getDirectorySyncRevokeMode,
} from '../../../server-only/directory-sync/apply-directory-mappings';
import {
  exceedsRevokeCircuitBreaker,
  type PlannedRevocation,
  REVOKE_CIRCUIT_BREAKER_MINIMUM,
  REVOKE_CIRCUIT_BREAKER_PERCENT,
} from '../../../server-only/directory-sync/plan-directory-membership';
import type { SyncGoogleDirectoryStatus } from '../../../server-only/user/sync-google-directory';
import { syncGoogleDirectory } from '../../../server-only/user/sync-google-directory';
import type { TDirectorySyncAuditLogType } from '../../../types/directory-sync-audit-logs';
import { env } from '../../../utils/env';
import type { JobRunIO } from '../../client/_internal/job';
import type { TDirectorySyncSweepJobDefinition } from './directory-sync-sweep';

const CHUNK_SIZE = 5;

const REVOKE_CIRCUIT_BREAKER: TDirectorySyncAuditLogType = 'REVOKE_CIRCUIT_BREAKER';

type UserRevocations = {
  userId: number;
  revocations: PlannedRevocation[];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

export const run = async ({ io }: { payload: TDirectorySyncSweepJobDefinition; io: JobRunIO }) => {
  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    io.logger.info('[directory-sync-sweep] Directory sync disabled; ensuring baseline membership only');
  }

  const users = await prisma.user.findMany({
    where: {
      disabled: false,
      accounts: { some: { provider: 'google' } },
    },
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
  });

  const counters = {
    processed: 0,
    synced: 0,
    throttled: 0,
    syncFailures: 0,
    applyFailures: 0,
    granted: 0,
    plannedRevocations: 0,
    revoked: 0,
    revokeDryRun: 0,
    revokeFailures: 0,
  };

  const deferredRevocations: UserRevocations[] = [];

  for (const batch of chunk(users, CHUNK_SIZE)) {
    await Promise.all(
      batch.map(async (user) => {
        counters.processed += 1;

        let syncStatus: SyncGoogleDirectoryStatus;

        try {
          syncStatus = await syncGoogleDirectory(user.id, user.email);
        } catch (err) {
          io.logger.info(
            `[directory-sync-sweep] sync threw for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
          syncStatus = 'failed';
        }

        if (syncStatus === 'synced') {
          counters.synced += 1;
        } else if (syncStatus === 'throttled') {
          counters.throttled += 1;
        } else {
          counters.syncFailures += 1;
        }

        try {
          const result = await applyDirectoryMappings(user.id, 'sweep', syncStatus, {
            deferRevocations: true,
          });
          counters.granted += result.granted;

          if (result.deferredRevocations.length > 0) {
            deferredRevocations.push({ userId: user.id, revocations: result.deferredRevocations });
          }
        } catch (err) {
          counters.applyFailures += 1;
          io.logger.info(
            `[directory-sync-sweep] apply failed for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }),
    );
  }

  counters.plannedRevocations = deferredRevocations.reduce((sum, entry) => sum + entry.revocations.length, 0);

  if (counters.plannedRevocations > 0) {
    const managedMembershipCount = await prisma.organisationGroupMember.count({
      where: { group: { directoryGroupMappings: { some: { active: true } } } },
    });

    if (exceedsRevokeCircuitBreaker(counters.plannedRevocations, managedMembershipCount)) {
      io.logger.error(
        `[directory-sync-sweep] Revocation circuit breaker tripped: ${counters.plannedRevocations} planned revocations exceed ${REVOKE_CIRCUIT_BREAKER_MINIMUM} and ${REVOKE_CIRCUIT_BREAKER_PERCENT}% of ${managedMembershipCount} memberships in managed groups; no revocations applied`,
      );

      await prisma.directorySyncAuditLog.create({
        data: {
          type: REVOKE_CIRCUIT_BREAKER,
          userId: DIRECTORY_SYNC_SYSTEM_ACTOR.userId,
          name: DIRECTORY_SYNC_SYSTEM_ACTOR.name,
          email: DIRECTORY_SYNC_SYSTEM_ACTOR.email,
          data: {
            plannedRevocations: counters.plannedRevocations,
            affectedUsers: deferredRevocations.length,
            managedMembershipCount,
            thresholdPercent: REVOKE_CIRCUIT_BREAKER_PERCENT,
            thresholdMinimum: REVOKE_CIRCUIT_BREAKER_MINIMUM,
            revokeMode: getDirectorySyncRevokeMode(),
          },
        },
      });
    } else {
      for (const { userId, revocations } of deferredRevocations) {
        try {
          const result = await applyDirectoryRevocations({
            targetUserId: userId,
            revocations,
            actor: DIRECTORY_SYNC_SYSTEM_ACTOR,
          });
          counters.revoked += result.revoked;
          counters.revokeDryRun += result.dryRun;
        } catch (err) {
          counters.revokeFailures += 1;
          io.logger.info(
            `[directory-sync-sweep] revoke failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }
    }
  }

  io.logger.info(
    `[directory-sync-sweep] processed=${counters.processed} synced=${counters.synced} throttled=${counters.throttled} syncFailures=${counters.syncFailures} applyFailures=${counters.applyFailures} granted=${counters.granted} plannedRevocations=${counters.plannedRevocations} revoked=${counters.revoked} revokeDryRun=${counters.revokeDryRun} revokeFailures=${counters.revokeFailures}`,
  );
};
