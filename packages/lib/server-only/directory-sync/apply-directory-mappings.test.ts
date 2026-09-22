// ABOUTME: Unit tests for the additive-only directory mapping apply engine.
// ABOUTME: Covers the feature gate, idempotency, audit rows, missing member row, and the additive-only invariant.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUserFindUnique = vi.fn();
const mockMappingFindMany = vi.fn();
const mockMemberFindFirst = vi.fn();
const mockGroupMemberFindMany = vi.fn();
const mockCreateManyAndReturn = vi.fn();
const mockAuditLogCreateMany = vi.fn();
const mockGroupMemberUpdate = vi.fn();
const mockGroupMemberDelete = vi.fn();
const mockTransaction = vi.fn();
const mockEnv = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    directoryGroupMapping: { findMany: mockMappingFindMany },
    organisationMember: { findFirst: mockMemberFindFirst },
    organisationGroupMember: {
      findMany: mockGroupMemberFindMany,
      update: mockGroupMemberUpdate,
      delete: mockGroupMemberDelete,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../utils/env', () => ({
  env: mockEnv,
}));

describe('applyDirectoryMappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockEnv.mockReturnValue('true');

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        organisationGroupMember: {
          createManyAndReturn: mockCreateManyAndReturn,
          update: mockGroupMemberUpdate,
          delete: mockGroupMemberDelete,
        },
        directorySyncAuditLog: { createMany: mockAuditLogCreateMany },
      }),
    );
  });

  it('returns { granted: 0 } and does no work when the feature gate is disabled', async () => {
    mockEnv.mockReturnValue(undefined);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('returns { granted: 0 } and logs when the user has no PSD401 member row', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue(null);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('returns { granted: 0 } and does no further work when no mapping matches the user', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Facilities', organisationGroupId: 'org_group_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('inserts only missing groups and writes one audit row per inserted row', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
      { id: 'directory_mapping_2', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_2' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([{ groupId: 'org_group_1' }]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_2', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 1 });
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

  it('is idempotent: a second run with no new matches inserts nothing and writes no audit rows', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([{ groupId: 'org_group_1' }]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('writes zero audit rows when createManyAndReturn returns zero rows (raced out by skipDuplicates)', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
  });

  it('uses a system actor (userId null, name "directory-sync") for source "sweep"', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_1', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    await applyDirectoryMappings(1, 'sweep');

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

  it('never calls update or delete on organisationGroupMember', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_1', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    await applyDirectoryMappings(1, 'login');

    expect(mockGroupMemberUpdate).not.toHaveBeenCalled();
    expect(mockGroupMemberDelete).not.toHaveBeenCalled();
  });
});
