// ABOUTME: Unit tests for the directory sync sweep handler.
// ABOUTME: Covers the disabled exit, user scope, error isolation, counters, and failed-sync-still-applies.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.fn();
const mockSyncGoogleDirectory = vi.fn();
const mockApplyDirectoryMappings = vi.fn();
const mockEnv = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findMany: mockFindMany },
  },
}));

vi.mock('../../../server-only/user/sync-google-directory', () => ({
  syncGoogleDirectory: mockSyncGoogleDirectory,
}));

vi.mock('../../../server-only/directory-sync/apply-directory-mappings', () => ({
  applyDirectoryMappings: mockApplyDirectoryMappings,
}));

vi.mock('../../../utils/env', () => ({
  env: mockEnv,
}));

const io = { logger: { info: mockLoggerInfo } } as unknown as Parameters<
  typeof import('./directory-sync-sweep.handler').run
>[0]['io'];

describe('directory-sync-sweep handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockEnv.mockReturnValue('true');
  });

  it('exits immediately without querying users when the feature gate is disabled', async () => {
    mockEnv.mockReturnValue(undefined);

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('scopes the query to non-disabled users with a linked Google account', async () => {
    mockFindMany.mockResolvedValue([]);

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        disabled: false,
        accounts: { some: { provider: 'google' } },
      },
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
    });
  });

  it('calls sync then apply for every scoped user and sums granted counts', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, email: 'a@psd401.net' },
      { id: 2, email: 'b@psd401.net' },
    ]);
    mockSyncGoogleDirectory.mockResolvedValue('synced');
    mockApplyDirectoryMappings.mockResolvedValueOnce({ granted: 2 }).mockResolvedValueOnce({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(1, 'a@psd401.net');
    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(2, 'b@psd401.net');
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep');
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(2, 'sweep');
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=2'));
  });

  it('still calls applyDirectoryMappings for a user whose sync failed', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep');
  });

  it('isolates a per-user error: one failing user does not abort the batch', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, email: 'a@psd401.net' },
      { id: 2, email: 'b@psd401.net' },
    ]);
    mockSyncGoogleDirectory.mockResolvedValue('synced');
    mockApplyDirectoryMappings
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ granted: 1 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledTimes(2);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=1'));
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=1'));
  });

  it('counts sync failures separately from apply failures', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('syncFailures=1'),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=0'));
  });
});
