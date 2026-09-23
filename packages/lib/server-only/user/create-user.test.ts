// ABOUTME: Unit tests for onCreateUserHook covering PSD401 org auto-join, including the case
// ABOUTME: where the trg_auto_add_psd401 DB trigger already created a member without the Default team group.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMemberFindFirst = vi.fn();
const mockMemberCreate = vi.fn();
const mockGroupMemberCreateMany = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    organisationMember: {
      findFirst: mockMemberFindFirst,
      create: mockMemberCreate,
    },
    organisationGroupMember: {
      createMany: mockGroupMemberCreateMany,
    },
  },
}));

const user = { id: 42, email: 'new@psd401.net' } as Parameters<
  typeof import('./create-user').onCreateUserHook
>[0];

describe('onCreateUserHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the org member with the member and Default team groups when none exists', async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    const { onCreateUserHook } = await import('./create-user');
    await onCreateUserHook(user);

    expect(mockMemberCreate).toHaveBeenCalledTimes(1);
    const groupIds = mockMemberCreate.mock.calls[0][0].data.organisationGroupMembers.create.map(
      (g: { groupId: string }) => g.groupId,
    );
    expect(groupIds).toEqual(['org_group_psd401_member', 'org_group_default_member']);
  });

  it('adds missing groups to a member already created by the DB trigger', async () => {
    mockMemberFindFirst.mockResolvedValue({ id: 'org_member_auto_abc' });

    const { onCreateUserHook } = await import('./create-user');
    await onCreateUserHook(user);

    expect(mockMemberCreate).not.toHaveBeenCalled();
    expect(mockGroupMemberCreateMany).toHaveBeenCalledTimes(1);

    const { data, skipDuplicates } = mockGroupMemberCreateMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data.map((g: { groupId: string }) => g.groupId)).toEqual([
      'org_group_psd401_member',
      'org_group_default_member',
    ]);
    expect(data.every((g: { organisationMemberId: string }) => g.organisationMemberId === 'org_member_auto_abc')).toBe(
      true,
    );
  });
});
