// ABOUTME: Unit tests for updateDirectoryMapping: NOT_FOUND, field-level diffing, and
// ABOUTME: normalization against the effective post-update sourceField.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, AppErrorCode } from '../../errors/app-error';

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    directoryGroupMapping: { findFirst: mockFindFirst },
    $transaction: mockTransaction,
  },
}));

describe('updateDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { update: mockUpdate },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('throws NOT_FOUND when the mapping does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { updateDirectoryMapping } = await import('./update-directory-mapping');

    await expect(
      updateDirectoryMapping({
        id: 'directory_mapping_missing',
        data: { active: false },
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toThrow(AppError);

    await expect(
      updateDirectoryMapping({
        id: 'directory_mapping_missing',
        data: { active: false },
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });
  });

  it('normalizes sourceValue against a newly-provided sourceField', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'GROUP',
      sourceValue: 'tech-staff@psd401.net',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { sourceField: 'GROUP', sourceValue: 'Tech-Staff@PSD401.net' },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'directory_mapping_1' },
      data: expect.objectContaining({
        sourceField: 'GROUP',
        sourceValue: 'tech-staff@psd401.net',
      }),
    });
  });

  it('writes a diff containing only the changed fields', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: false,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { active: false },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_UPDATED',
        data: {
          mappingId: 'directory_mapping_1',
          changes: { active: { from: true, to: false } },
        },
      }),
    });
  });

  it('writes no audit row when nothing actually changed', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { active: true },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});
