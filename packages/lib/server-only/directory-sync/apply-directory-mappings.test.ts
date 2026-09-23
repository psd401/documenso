// ABOUTME: Unit tests for the directory mapping apply engine: baseline groups, grants from matched rules,
// ABOUTME: and revocation of managed groups the user no longer matches, gated by sync status and DIRECTORY_SYNC_REVOKE_MODE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUserFindUnique = vi.fn();
const mockMappingFindMany = vi.fn();
const mockMemberFindMany = vi.fn();
const mockMemberCreate = vi.fn();
const mockBaselineCreateMany = vi.fn();
const mockCreateManyAndReturn = vi.fn();
const mockDeleteMany = vi.fn();
const mockAuditLogCreateMany = vi.fn();
const mockTransaction = vi.fn();
const mockEnv = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    directoryGroupMapping: { findMany: mockMappingFindMany },
    organisationMember: { findMany: mockMemberFindMany, create: mockMemberCreate },
    organisationGroupMember: { createMany: mockBaselineCreateMany },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../utils/env', () => ({
  env: mockEnv,
}));

const BASELINE_GROUP_IDS = ['org_group_psd401_member', 'org_group_default_member'];

const jane = {
  name: 'Jane Staff',
  email: 'jane@psd401.net',
  department: 'Technology',
  orgUnitPath: '/Staff',
  googleGroups: [],
};

const mapping = (id: string, sourceValue: string, organisationGroupId: string, active = true) => ({
  id,
  sourceField: 'DEPARTMENT',
  sourceValue,
  organisationGroupId,
  active,
});

const memberRow = (id: string, createdAt: string, groupIds: string[]) => ({
  id,
  createdAt: new Date(createdAt),
  organisationGroupMembers: groupIds.map((groupId) => ({
    id: `gm_${id}_${groupId}`,
    organisationMemberId: id,
    groupId,
  })),
});

const setEnv = (values: Record<string, string | undefined>) => {
  mockEnv.mockImplementation((key: string) => values[key]);
};

const auditRowsOfType = (type: string) =>
  mockAuditLogCreateMany.mock.calls
    .flatMap((call) => call[0].data)
    .filter((row: { type: string }) => row.type === type);

describe('applyDirectoryMappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setEnv({ GOOGLE_DIRECTORY_SYNC_ENABLED: 'true', DIRECTORY_SYNC_REVOKE_MODE: 'enforce' });

    mockUserFindUnique.mockResolvedValue(jane);
    mockDeleteMany.mockResolvedValue({ count: 1 });
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        organisationGroupMember: {
          createManyAndReturn: mockCreateManyAndReturn,
          deleteMany: mockDeleteMany,
        },
        directorySyncAuditLog: { createMany: mockAuditLogCreateMany },
      }),
    );
  });

  describe('baseline and grants', () => {
    it('ensures baseline groups but does no mapping work when the feature gate is disabled', async () => {
      setEnv({ DIRECTORY_SYNC_REVOKE_MODE: 'enforce' });
      mockMemberFindMany.mockResolvedValue([memberRow('member_1', '2026-01-01', ['org_group_psd401_member'])]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', 'disabled');

      expect(result).toEqual({ granted: 0, deferredRevocations: [] });
      expect(mockBaselineCreateMany).toHaveBeenCalledWith({
        data: [
          {
            id: expect.any(String),
            groupId: 'org_group_default_member',
            organisationMemberId: 'member_1',
          },
        ],
        skipDuplicates: true,
      });
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockMappingFindMany).not.toHaveBeenCalled();
    });

    it('creates the baseline member row, then warns and stops when no PSD401 member row is readable', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Technology', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', 'synced');

      expect(result).toEqual({ granted: 0, deferredRevocations: [] });
      expect(mockMemberCreate).toHaveBeenCalledTimes(1);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('inserts only groups missing from every member row and writes one audit row per inserted row', async () => {
      mockMappingFindMany.mockResolvedValue([
        mapping('directory_mapping_1', 'Technology', 'org_group_1'),
        mapping('directory_mapping_2', 'Technology', 'org_group_2'),
      ]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);
      mockCreateManyAndReturn.mockResolvedValue([
        { id: 'group_member_1', groupId: 'org_group_2', organisationMemberId: 'member_1' },
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', 'synced');

      expect(result).toEqual({ granted: 1, deferredRevocations: [] });
      expect(mockCreateManyAndReturn).toHaveBeenCalledWith({
        data: [{ id: expect.any(String), groupId: 'org_group_2', organisationMemberId: 'member_1' }],
        skipDuplicates: true,
      });
      expect(mockAuditLogCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            type: 'MEMBERSHIP_GRANTED',
            userId: 1,
            name: 'Jane Staff',
            email: 'jane@psd401.net',
            data: expect.objectContaining({
              targetUserId: 1,
              organisationMemberId: 'member_1',
              organisationGroupId: 'org_group_2',
              mappingIds: ['directory_mapping_2'],
            }),
          }),
        ],
      });
    });

    it('is idempotent: nothing to grant or revoke opens no transaction', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Technology', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', 'synced');

      expect(result).toEqual({ granted: 0, deferredRevocations: [] });
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockBaselineCreateMany).not.toHaveBeenCalled();
    });

    it('writes zero audit rows when createManyAndReturn returns zero rows (raced out by skipDuplicates)', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Technology', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([memberRow('member_1', '2026-01-01', BASELINE_GROUP_IDS)]);
      mockCreateManyAndReturn.mockResolvedValue([]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', 'synced');

      expect(result).toEqual({ granted: 0, deferredRevocations: [] });
      expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
    });

    it('uses a system actor (userId null, name "directory-sync") for source "sweep"', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Technology', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([memberRow('member_1', '2026-01-01', BASELINE_GROUP_IDS)]);
      mockCreateManyAndReturn.mockResolvedValue([
        { id: 'group_member_1', groupId: 'org_group_1', organisationMemberId: 'member_1' },
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'sweep', 'synced');

      expect(mockAuditLogCreateMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: null,
            name: 'directory-sync',
            email: null,
          }),
        ],
      });
    });
  });

  describe('revocations', () => {
    it.each([
      'synced',
      'throttled',
    ] as const)('enforce mode deletes a managed group the user no longer matches and audits it (status %s)', async (syncStatus) => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', syncStatus);

      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
      expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 'gm_member_1_org_group_1' } });
      expect(auditRowsOfType('MEMBERSHIP_REVOKED')).toEqual([
        expect.objectContaining({
          userId: 1,
          data: {
            targetUserId: 1,
            organisationMemberId: 'member_1',
            organisationGroupId: 'org_group_1',
            reason: 'no_matching_mapping',
          },
        }),
      ]);
    });

    it('keeps a managed group when another active mapping for the same group still matches', async () => {
      mockMappingFindMany.mockResolvedValue([
        mapping('directory_mapping_1', 'Facilities', 'org_group_1'),
        mapping('directory_mapping_2', 'Technology', 'org_group_1'),
      ]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
    });

    it('never touches a group that no active mapping targets', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Technology', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1', 'org_group_hand_added']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('never revokes a baseline group, even when an unmatched mapping targets it', async () => {
      mockMappingFindMany.mockResolvedValue([
        mapping('directory_mapping_1', 'Facilities', 'org_group_default_member'),
        mapping('directory_mapping_2', 'Facilities', 'org_group_psd401_member'),
      ]);
      mockMemberFindMany.mockResolvedValue([memberRow('member_1', '2026-01-01', BASELINE_GROUP_IDS)]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('does not revoke a group whose only mapping is deactivated', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1', false)]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
    });

    it.each([
      'failed',
      'disabled',
    ] as const)('does not revoke when the directory sync status is %s, but still grants', async (syncStatus) => {
      mockMappingFindMany.mockResolvedValue([
        mapping('directory_mapping_1', 'Facilities', 'org_group_1'),
        mapping('directory_mapping_2', 'Technology', 'org_group_2'),
      ]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);
      mockCreateManyAndReturn.mockResolvedValue([
        { id: 'group_member_2', groupId: 'org_group_2', organisationMemberId: 'member_1' },
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'login', syncStatus);

      expect(result.granted).toBe(1);
      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(auditRowsOfType('MEMBERSHIP_REVOKED')).toEqual([]);
      expect(auditRowsOfType('MEMBERSHIP_REVOKE_DRY_RUN')).toEqual([]);
    });

    it('log mode writes a dry-run audit row and deletes nothing', async () => {
      setEnv({ GOOGLE_DIRECTORY_SYNC_ENABLED: 'true', DIRECTORY_SYNC_REVOKE_MODE: 'log' });
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(auditRowsOfType('MEMBERSHIP_REVOKED')).toEqual([]);
      expect(auditRowsOfType('MEMBERSHIP_REVOKE_DRY_RUN')).toEqual([
        expect.objectContaining({
          data: {
            targetUserId: 1,
            organisationMemberId: 'member_1',
            organisationGroupId: 'org_group_1',
            reason: 'no_matching_mapping',
          },
        }),
      ]);
    });

    it.each([undefined, 'bogus'])('defaults to log mode when DIRECTORY_SYNC_REVOKE_MODE is %s', async (revokeMode) => {
      setEnv({ GOOGLE_DIRECTORY_SYNC_ENABLED: 'true', DIRECTORY_SYNC_REVOKE_MODE: revokeMode });
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(auditRowsOfType('MEMBERSHIP_REVOKE_DRY_RUN')).toHaveLength(1);
    });

    it('off mode skips revocation entirely: no delete and no audit row', async () => {
      setEnv({ GOOGLE_DIRECTORY_SYNC_ENABLED: 'true', DIRECTORY_SYNC_REVOKE_MODE: 'off' });
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'sweep', 'synced', { deferRevocations: true });

      expect(result.deferredRevocations).toEqual([]);
      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
    });

    it('reconciles every member row: revokes the group on each row and grants onto the row holding Default', async () => {
      mockMappingFindMany.mockResolvedValue([
        mapping('directory_mapping_1', 'Facilities', 'org_group_1'),
        mapping('directory_mapping_2', 'Technology', 'org_group_2'),
      ]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_old', '2026-01-01', ['org_group_psd401_member', 'org_group_1']),
        memberRow('member_default', '2026-02-01', ['org_group_default_member', 'org_group_1']),
      ]);
      mockCreateManyAndReturn.mockResolvedValue([
        { id: 'group_member_2', groupId: 'org_group_2', organisationMemberId: 'member_default' },
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      await applyDirectoryMappings(1, 'login', 'synced');

      expect(mockBaselineCreateMany).not.toHaveBeenCalled();
      expect(mockCreateManyAndReturn).toHaveBeenCalledWith({
        data: [{ id: expect.any(String), groupId: 'org_group_2', organisationMemberId: 'member_default' }],
        skipDuplicates: true,
      });
      expect(mockDeleteMany.mock.calls.map((call) => call[0].where.id).sort()).toEqual([
        'gm_member_default_org_group_1',
        'gm_member_old_org_group_1',
      ]);
      expect(
        auditRowsOfType('MEMBERSHIP_REVOKED').map(
          (row: { data: { organisationMemberId: string } }) => row.data.organisationMemberId,
        ),
      ).toEqual(['member_old', 'member_default']);
    });

    it('returns planned revocations without writing them when deferRevocations is set', async () => {
      mockMappingFindMany.mockResolvedValue([mapping('directory_mapping_1', 'Facilities', 'org_group_1')]);
      mockMemberFindMany.mockResolvedValue([
        memberRow('member_1', '2026-01-01', [...BASELINE_GROUP_IDS, 'org_group_1']),
      ]);

      const { applyDirectoryMappings } = await import('./apply-directory-mappings');
      const result = await applyDirectoryMappings(1, 'sweep', 'synced', { deferRevocations: true });

      expect(result.deferredRevocations).toEqual([
        {
          organisationGroupMemberId: 'gm_member_1_org_group_1',
          organisationMemberId: 'member_1',
          organisationGroupId: 'org_group_1',
        },
      ]);
      expect(mockDeleteMany).not.toHaveBeenCalled();
      expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
    });
  });
});
