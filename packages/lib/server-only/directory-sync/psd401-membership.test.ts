// ABOUTME: Unit tests for PSD401 baseline membership (org member group + Default team group),
// ABOUTME: covering no-op when present, deterministic row choice across several member rows, and a concurrent-create race.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMemberFindMany = vi.fn();
const mockMemberCreate = vi.fn();
const mockGroupMemberCreateMany = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    organisationMember: {
      findMany: mockMemberFindMany,
      create: mockMemberCreate,
    },
    organisationGroupMember: {
      createMany: mockGroupMemberCreateMany,
    },
  },
}));

const memberRow = (id: string, createdAt: string, groupIds: string[]) => ({
  id,
  createdAt: new Date(createdAt),
  organisationGroupMembers: groupIds.map((groupId) => ({
    id: `group_member_${id}_${groupId}`,
    organisationMemberId: id,
    groupId,
  })),
});

describe('ensurePsd401BaselineMembership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('tops up the row a concurrent caller created when its own create hits the unique constraint', async () => {
    mockMemberFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([memberRow('member_racer', '2026-01-01', ['org_group_psd401_member'])]);
    mockMemberCreate.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const { ensurePsd401BaselineMembership } = await import('./psd401-membership');
    await ensurePsd401BaselineMembership(42);

    expect(mockGroupMemberCreateMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = mockGroupMemberCreateMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([
      expect.objectContaining({ groupId: 'org_group_default_member', organisationMemberId: 'member_racer' }),
    ]);
  });

  it('rethrows create errors other than the unique constraint', async () => {
    mockMemberFindMany.mockResolvedValue([]);
    mockMemberCreate.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P1001' }));

    const { ensurePsd401BaselineMembership } = await import('./psd401-membership');

    await expect(ensurePsd401BaselineMembership(42)).rejects.toThrow('connection lost');
    expect(mockGroupMemberCreateMany).not.toHaveBeenCalled();
  });

  it('writes nothing when the user already holds both baseline groups', async () => {
    mockMemberFindMany.mockResolvedValue([
      memberRow('member_1', '2026-01-01', ['org_group_psd401_member', 'org_group_default_member']),
    ]);

    const { ensurePsd401BaselineMembership } = await import('./psd401-membership');
    await ensurePsd401BaselineMembership(42);

    expect(mockMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42, organisationId: 'org_psd401district' } }),
    );
    expect(mockMemberCreate).not.toHaveBeenCalled();
    expect(mockGroupMemberCreateMany).not.toHaveBeenCalled();
  });

  it('counts a baseline group held on any member row and adds the rest to the row holding Default', async () => {
    mockMemberFindMany.mockResolvedValue([
      memberRow('member_old', '2026-01-01', []),
      memberRow('member_default', '2026-02-01', ['org_group_default_member']),
      memberRow('member_stray', '2026-03-01', ['org_group_sped_purdy']),
    ]);

    const { ensurePsd401BaselineMembership } = await import('./psd401-membership');
    await ensurePsd401BaselineMembership(42);

    expect(mockGroupMemberCreateMany).toHaveBeenCalledWith({
      data: [
        {
          id: expect.any(String),
          groupId: 'org_group_psd401_member',
          organisationMemberId: 'member_default',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('adds missing baseline groups to the oldest member row when none holds Default', async () => {
    mockMemberFindMany.mockResolvedValue([
      memberRow('member_new', '2026-03-01', []),
      memberRow('member_old', '2026-01-01', ['org_group_psd401_member']),
    ]);

    const { ensurePsd401BaselineMembership } = await import('./psd401-membership');
    await ensurePsd401BaselineMembership(42);

    expect(mockGroupMemberCreateMany).toHaveBeenCalledWith({
      data: [
        {
          id: expect.any(String),
          groupId: 'org_group_default_member',
          organisationMemberId: 'member_old',
        },
      ],
      skipDuplicates: true,
    });
  });
});
