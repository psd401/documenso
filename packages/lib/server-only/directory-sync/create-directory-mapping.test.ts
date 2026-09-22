// ABOUTME: Unit tests for createDirectoryMapping: normalization and the audit row it writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

describe('createDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { create: mockCreate },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('lowercases a GROUP sourceValue before writing', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'GROUP',
      sourceValue: 'tech-staff@psd401.net',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'GROUP',
      sourceValue: '  Tech-Staff@PSD401.net  ',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceValue: 'tech-staff@psd401.net' }),
    });
  });

  it('trims but preserves case for a DEPARTMENT sourceValue', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'DEPARTMENT',
      sourceValue: '  Technology  ',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceValue: 'Technology' }),
    });
  });

  it('writes one MAPPING_CREATED audit row diffing from null', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_CREATED',
        userId: 1,
        name: 'Admin',
        email: 'admin@psd401.net',
        data: expect.objectContaining({
          mappingId: 'directory_mapping_1',
          changes: expect.objectContaining({
            sourceField: { from: null, to: 'DEPARTMENT' },
            sourceValue: { from: null, to: 'Technology' },
          }),
        }),
      }),
    });
  });
});
