// ABOUTME: Unit tests for the directory sync sweep handler.
// ABOUTME: Covers baseline-only runs when disabled, user scope, error isolation, counters, and the revocation circuit breaker.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.fn();
const mockGroupMemberCount = vi.fn();
const mockGroupMemberGroupBy = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockSyncGoogleDirectory = vi.fn();
const mockApplyDirectoryMappings = vi.fn();
const mockApplyDirectoryRevocations = vi.fn();
const mockEnv = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findMany: mockFindMany },
    organisationGroupMember: { count: mockGroupMemberCount, groupBy: mockGroupMemberGroupBy },
    directorySyncAuditLog: { create: mockAuditLogCreate },
  },
}));

vi.mock('../../../server-only/user/sync-google-directory', () => ({
  syncGoogleDirectory: mockSyncGoogleDirectory,
}));

vi.mock('../../../server-only/directory-sync/apply-directory-mappings', () => ({
  applyDirectoryMappings: mockApplyDirectoryMappings,
  applyDirectoryRevocations: mockApplyDirectoryRevocations,
  getDirectorySyncRevokeMode: () => 'enforce',
  DIRECTORY_SYNC_SYSTEM_ACTOR: { userId: null, name: 'directory-sync', email: null },
}));

vi.mock('../../../utils/env', () => ({
  env: mockEnv,
}));

const io = { logger: { info: mockLoggerInfo, error: mockLoggerError } } as unknown as Parameters<
  typeof import('./directory-sync-sweep.handler').run
>[0]['io'];

const revocations = (userId: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    organisationGroupMemberId: `gm_${userId}_${i}`,
    organisationMemberId: `member_${userId}`,
    organisationGroupId: `org_group_${i}`,
  }));

const DEFER = { deferRevocations: true };

describe('directory-sync-sweep handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockEnv.mockReturnValue('true');
    mockApplyDirectoryRevocations.mockResolvedValue({ revoked: 0, dryRun: 0 });
  });

  it('still walks every scoped user so baseline membership is ensured when directory sync is disabled', async () => {
    mockEnv.mockReturnValue(undefined);
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('disabled');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0, deferredRevocations: [] });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep', 'disabled', DEFER);
    expect(mockApplyDirectoryRevocations).not.toHaveBeenCalled();
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
    mockApplyDirectoryMappings
      .mockResolvedValueOnce({ granted: 2, deferredRevocations: [] })
      .mockResolvedValueOnce({ granted: 0, deferredRevocations: [] });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(1, 'a@psd401.net');
    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(2, 'b@psd401.net');
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep', 'synced', DEFER);
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(2, 'sweep', 'synced', DEFER);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=2'));
  });

  it('still calls applyDirectoryMappings for a user whose sync failed, passing the failed status', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0, deferredRevocations: [] });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep', 'failed', DEFER);
  });

  it('isolates a per-user error: one failing user does not abort the batch', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, email: 'a@psd401.net' },
      { id: 2, email: 'b@psd401.net' },
    ]);
    mockSyncGoogleDirectory.mockResolvedValue('synced');
    mockApplyDirectoryMappings
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ granted: 1, deferredRevocations: [] });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledTimes(2);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=1'));
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=1'));
  });

  it('counts sync failures separately from apply failures', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0, deferredRevocations: [] });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('syncFailures=1'));
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=0'));
  });

  describe('revocation circuit breaker', () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([
        { id: 1, email: 'a@psd401.net' },
        { id: 2, email: 'b@psd401.net' },
      ]);
      mockSyncGoogleDirectory.mockResolvedValue('synced');
      mockGroupMemberCount.mockResolvedValue(100);
      mockGroupMemberGroupBy.mockResolvedValue([]);
    });

    it('applies deferred revocations per user when they are at most 5% of managed-group memberships', async () => {
      mockApplyDirectoryMappings
        .mockResolvedValueOnce({ granted: 0, deferredRevocations: revocations(1, 3) })
        .mockResolvedValueOnce({ granted: 0, deferredRevocations: revocations(2, 2) });
      mockApplyDirectoryRevocations
        .mockResolvedValueOnce({ revoked: 3, dryRun: 0 })
        .mockResolvedValueOnce({ revoked: 2, dryRun: 0 });

      const { run } = await import('./directory-sync-sweep.handler');
      await run({ payload: {}, io });

      expect(mockGroupMemberCount).toHaveBeenCalledWith({
        where: { group: { directoryGroupMappings: { some: { active: true } } } },
      });
      expect(mockApplyDirectoryRevocations).toHaveBeenCalledWith({
        targetUserId: 1,
        revocations: revocations(1, 3),
        actor: { userId: null, name: 'directory-sync', email: null },
      });
      expect(mockApplyDirectoryRevocations).toHaveBeenCalledWith({
        targetUserId: 2,
        revocations: revocations(2, 2),
        actor: { userId: null, name: 'directory-sync', email: null },
      });
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
      expect(mockLoggerError).not.toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('revoked=5'));
    });

    it('applies no revocations, logs an error, and writes one audit row when planned revocations exceed 5% and 10', async () => {
      mockApplyDirectoryMappings
        .mockResolvedValueOnce({ granted: 1, deferredRevocations: revocations(1, 7) })
        .mockResolvedValueOnce({ granted: 0, deferredRevocations: revocations(2, 4) });

      const { run } = await import('./directory-sync-sweep.handler');
      await run({ payload: {}, io });

      expect(mockApplyDirectoryRevocations).not.toHaveBeenCalled();
      expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('circuit breaker'));
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          type: 'REVOKE_CIRCUIT_BREAKER',
          userId: null,
          name: 'directory-sync',
          email: null,
          data: {
            plannedRevocations: 11,
            affectedUsers: 2,
            managedMembershipCount: 100,
            thresholdPercent: 5,
            thresholdMinimum: 10,
            trippedGroupIds: [],
            revokeMode: 'enforce',
          },
        },
      });
      expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=1'));
    });

    it('applies no revocations when one group would lose more than the breaker allows, even under the org-wide share', async () => {
      const userIds = Array.from({ length: 11 }, (_, i) => i + 1);
      mockFindMany.mockResolvedValue(userIds.map((id) => ({ id, email: `u${id}@psd401.net` })));
      mockGroupMemberCount.mockResolvedValue(10000);
      mockGroupMemberGroupBy.mockResolvedValue([{ groupId: 'org_group_building', _count: { _all: 60 } }]);

      for (const id of userIds) {
        mockApplyDirectoryMappings.mockResolvedValueOnce({
          granted: 0,
          deferredRevocations: [
            {
              organisationGroupMemberId: `gm_${id}`,
              organisationMemberId: `member_${id}`,
              organisationGroupId: 'org_group_building',
            },
          ],
        });
      }

      const { run } = await import('./directory-sync-sweep.handler');
      await run({ payload: {}, io });

      expect(mockGroupMemberGroupBy).toHaveBeenCalledWith({
        by: ['groupId'],
        where: { groupId: { in: ['org_group_building'] } },
        _count: { _all: true },
      });
      expect(mockApplyDirectoryRevocations).not.toHaveBeenCalled();
      expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('org_group_building'));
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REVOKE_CIRCUIT_BREAKER',
          data: expect.objectContaining({ trippedGroupIds: ['org_group_building'] }),
        }),
      });
    });
  });
});
