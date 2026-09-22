// ABOUTME: Unit tests for deleteDirectoryMapping: NOT_FOUND and the audit row it writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppErrorCode } from '../../errors/app-error';

const mockFindFirst = vi.fn();
const mockDelete = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    directoryGroupMapping: { findFirst: mockFindFirst },
    $transaction: mockTransaction,
  },
}));

describe('deleteDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { delete: mockDelete },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('throws NOT_FOUND when the mapping does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { deleteDirectoryMapping } = await import('./delete-directory-mapping');

    await expect(
      deleteDirectoryMapping({
        id: 'directory_mapping_missing',
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });
  });

  it('deletes the mapping and writes a MAPPING_DELETED audit row', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockDelete.mockResolvedValue({ id: 'directory_mapping_1' });

    const { deleteDirectoryMapping } = await import('./delete-directory-mapping');
    await deleteDirectoryMapping({
      id: 'directory_mapping_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'directory_mapping_1' } });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_DELETED',
        userId: 1,
        data: {
          mappingId: 'directory_mapping_1',
          changes: {
            sourceField: { from: 'DEPARTMENT', to: null },
            sourceValue: { from: 'Technology', to: null },
            organisationGroupId: { from: 'org_group_1', to: null },
            active: { from: true, to: null },
          },
        },
      }),
    });
  });
});
