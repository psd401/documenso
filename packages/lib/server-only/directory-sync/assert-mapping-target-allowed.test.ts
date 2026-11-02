// ABOUTME: Unit tests for the admin-access guards around directory mappings: a mapped group can never be
// ABOUTME: given ADMIN, and a mapping can never target a group that already grants ADMIN.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMappingFindFirst = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    directoryGroupMapping: { findFirst: mockMappingFindFirst },
  },
}));

describe('assertGroupsNotDirectoryMapped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('rejects granting ADMIN to a group an active mapping targets', async () => {
    mockMappingFindFirst.mockResolvedValue({ id: 'directory_mapping_1', organisationGroupId: 'org_group_sped' });

    const { assertGroupsNotDirectoryMapped } = await import('./assert-mapping-target-allowed');

    await expect(assertGroupsNotDirectoryMapped(['org_group_sped'])).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(mockMappingFindFirst).toHaveBeenCalledWith({
      where: { organisationGroupId: { in: ['org_group_sped'] }, active: true },
      select: { id: true, organisationGroupId: true },
    });
  });

  it('allows the change when no active mapping targets the groups', async () => {
    mockMappingFindFirst.mockResolvedValue(null);

    const { assertGroupsNotDirectoryMapped } = await import('./assert-mapping-target-allowed');

    await expect(assertGroupsNotDirectoryMapped(['org_group_unmapped'])).resolves.toBeUndefined();
  });

  it('does not query when no group is gaining ADMIN', async () => {
    const { assertGroupsNotDirectoryMapped } = await import('./assert-mapping-target-allowed');

    await expect(assertGroupsNotDirectoryMapped([])).resolves.toBeUndefined();
    expect(mockMappingFindFirst).not.toHaveBeenCalled();
  });
});
