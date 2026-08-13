// ABOUTME: Nightly sweep handler. Re-syncs directory data and re-applies group mapping rules
// ABOUTME: for every user with a linked Google account, walked in small concurrent batches.
import { prisma } from '@documenso/prisma';

import { applyDirectoryMappings } from '../../../server-only/directory-sync/apply-directory-mappings';
import { syncGoogleDirectory } from '../../../server-only/user/sync-google-directory';
import { env } from '../../../utils/env';
import type { JobRunIO } from '../../client/_internal/job';
import type { TDirectorySyncSweepJobDefinition } from './directory-sync-sweep';

const CHUNK_SIZE = 5;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

export const run = async ({ io }: { payload: TDirectorySyncSweepJobDefinition; io: JobRunIO }) => {
  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    io.logger.info('[directory-sync-sweep] Feature disabled, exiting');
    return;
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
  };

  for (const batch of chunk(users, CHUNK_SIZE)) {
    await Promise.all(
      batch.map(async (user) => {
        counters.processed += 1;

        let syncStatus: string;

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
          const result = await applyDirectoryMappings(user.id, 'sweep');
          counters.granted += result.granted;
        } catch (err) {
          counters.applyFailures += 1;
          io.logger.info(
            `[directory-sync-sweep] apply failed for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }),
    );
  }

  io.logger.info(
    `[directory-sync-sweep] processed=${counters.processed} synced=${counters.synced} throttled=${counters.throttled} syncFailures=${counters.syncFailures} applyFailures=${counters.applyFailures} granted=${counters.granted}`,
  );
};
