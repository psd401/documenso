// ABOUTME: Sync orchestrator that updates a user's directory fields from Google Workspace on every SSO login.
// ABOUTME: Throttled to once per hour; partial results are preserved — only fields from successful API calls are written.
import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';
import { getDirectoryGroups, getDirectoryUser } from '../google/directory-client';

const ONE_HOUR_MS = 60 * 60 * 1000;

export type SyncGoogleDirectoryStatus = 'synced' | 'throttled' | 'failed' | 'disabled';

export const syncGoogleDirectory = async (
  userId: number,
  email: string,
): Promise<SyncGoogleDirectoryStatus> => {
  try {
    if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
      return 'disabled';
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { directoryLastSyncedAt: true },
    });

    if (user?.directoryLastSyncedAt != null) {
      const elapsed = Date.now() - user.directoryLastSyncedAt.getTime();
      if (elapsed < ONE_HOUR_MS) {
        return 'throttled';
      }
    }

    const [directoryUser, directoryGroups] = await Promise.all([
      getDirectoryUser(email),
      getDirectoryGroups(email),
    ]);

    if (directoryUser === null && directoryGroups === null) {
      console.warn(`[directory-sync] Both API calls returned null for ${email}; skipping update`);
      return 'failed';
    }

    const data: Record<string, unknown> = {
      directoryLastSyncedAt: new Date(),
    };

    if (directoryUser !== null) {
      data.department = directoryUser.department;
      data.title = directoryUser.title;
      data.orgUnitPath = directoryUser.orgUnitPath;
    }

    if (directoryGroups !== null) {
      data.googleGroups = directoryGroups;
    }

    await prisma.user.update({
      where: { id: userId },
      data,
    });

    return 'synced';
  } catch (err) {
    console.warn(`[directory-sync] ${err instanceof Error ? err.message : 'Unknown error'}`);
    return 'failed';
  }
};
