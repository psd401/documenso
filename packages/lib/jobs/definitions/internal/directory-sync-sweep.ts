// ABOUTME: Job definition for the nightly directory sync sweep.
// ABOUTME: Cron-triggered; the handler re-syncs directory data and re-applies mapping rules for every Google SSO user.
import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID = 'internal.directory-sync-sweep';

const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA = z.object({});

export type TDirectorySyncSweepJobDefinition = z.infer<
  typeof DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA
>;

export const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION = {
  id: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
  name: 'Directory Sync Sweep',
  version: '1.0.0',
  trigger: {
    name: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
    schema: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA,
    cron: '0 9 * * *', // 09:00 UTC daily, roughly 1am Pacific.
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./directory-sync-sweep.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
  TDirectorySyncSweepJobDefinition
>;
