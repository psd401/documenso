// ABOUTME: Unit tests for the getMergeImpact helper in the team merge feature.
// ABOUTME: Mocks @documenso/prisma to verify count aggregation and member dedup logic.
import { OrganisationGroupType, TeamMemberRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  envelope: { count: vi.fn() },
  folder: { count: vi.fn() },
  teamGroup: { findMany: vi.fn(), count: vi.fn() },
  webhook: { count: vi.fn() },
  apiToken: { count: vi.fn() },
  teamEmail: { count: vi.fn() },
  teamGlobalSettings: { count: vi.fn() },
  organisation: { findFirst: vi.fn() },
  team: { count: vi.fn(), findFirst: vi.fn() },
};

vi.mock('@documenso/prisma', () => ({
  prisma: mockPrisma,
}));

const { getMergeImpact } = await import('./merge-teams');

describe('getMergeImpact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts when sourceTeamIds is empty', async () => {
    const result = await getMergeImpact(mockPrisma as unknown as typeof import('@documenso/prisma').prisma, []);

    expect(result).toEqual({
      moving: { documents: 0, templates: 0, folders: 0, members: 0 },
      discarding: { webhooks: 0, apiTokens: 0, teamEmails: 0, teamSettings: 0 },
    });

    // No DB calls should have been made.
    expect(mockPrisma.envelope.count).not.toHaveBeenCalled();
  });

  it('returns correct counts for source teams without a destination', async () => {
    mockPrisma.envelope.count
      .mockResolvedValueOnce(5) // DOCUMENT
      .mockResolvedValueOnce(3); // TEMPLATE
    mockPrisma.folder.count.mockResolvedValueOnce(2);
    mockPrisma.teamGroup.findMany.mockResolvedValueOnce([
      {
        organisationGroupId: 'grp-1',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
      {
        organisationGroupId: 'grp-2',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.INTERNAL_ORGANISATION },
        teamRole: TeamMemberRole.ADMIN,
      },
    ]);
    mockPrisma.webhook.count.mockResolvedValueOnce(1);
    mockPrisma.apiToken.count.mockResolvedValueOnce(4);
    mockPrisma.teamEmail.count.mockResolvedValueOnce(1);
    mockPrisma.teamGlobalSettings.count.mockResolvedValueOnce(1);

    const result = await getMergeImpact(mockPrisma as unknown as typeof import('@documenso/prisma').prisma, [10]);

    expect(result).toEqual({
      moving: { documents: 5, templates: 3, folders: 2, members: 2 },
      discarding: { webhooks: 1, apiTokens: 4, teamEmails: 1, teamSettings: 1 },
    });

    // No destination → no teamGroup.count call for dedup.
    expect(mockPrisma.teamGroup.count).not.toHaveBeenCalled();
  });

  it('excludes INTERNAL_TEAM groups from member count', async () => {
    mockPrisma.envelope.count.mockResolvedValue(0);
    mockPrisma.folder.count.mockResolvedValue(0);
    mockPrisma.teamGroup.findMany.mockResolvedValueOnce([
      {
        organisationGroupId: 'grp-internal',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.INTERNAL_TEAM },
        teamRole: TeamMemberRole.ADMIN,
      },
      {
        organisationGroupId: 'grp-custom',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
    ]);
    mockPrisma.webhook.count.mockResolvedValue(0);
    mockPrisma.apiToken.count.mockResolvedValue(0);
    mockPrisma.teamEmail.count.mockResolvedValue(0);
    mockPrisma.teamGlobalSettings.count.mockResolvedValue(0);

    const result = await getMergeImpact(mockPrisma as unknown as typeof import('@documenso/prisma').prisma, [10]);

    // INTERNAL_TEAM group should be excluded; only grp-custom counts.
    expect(result.moving.members).toBe(1);
  });

  it('deduplicates groups shared across multiple source teams', async () => {
    mockPrisma.envelope.count.mockResolvedValue(0);
    mockPrisma.folder.count.mockResolvedValue(0);
    // Two source teams both have the same group.
    mockPrisma.teamGroup.findMany.mockResolvedValueOnce([
      {
        organisationGroupId: 'grp-shared',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
      {
        organisationGroupId: 'grp-shared',
        teamId: 11,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
    ]);
    mockPrisma.webhook.count.mockResolvedValue(0);
    mockPrisma.apiToken.count.mockResolvedValue(0);
    mockPrisma.teamEmail.count.mockResolvedValue(0);
    mockPrisma.teamGlobalSettings.count.mockResolvedValue(0);

    const result = await getMergeImpact(mockPrisma as unknown as typeof import('@documenso/prisma').prisma, [10, 11]);

    // Deduplication means only 1 unique group.
    expect(result.moving.members).toBe(1);
  });

  it('subtracts groups already on the destination team', async () => {
    mockPrisma.envelope.count.mockResolvedValue(0);
    mockPrisma.folder.count.mockResolvedValue(0);
    mockPrisma.teamGroup.findMany.mockResolvedValueOnce([
      {
        organisationGroupId: 'grp-1',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
      {
        organisationGroupId: 'grp-2',
        teamId: 10,
        organisationGroup: { type: OrganisationGroupType.CUSTOM },
        teamRole: TeamMemberRole.MEMBER,
      },
    ]);
    mockPrisma.webhook.count.mockResolvedValue(0);
    mockPrisma.apiToken.count.mockResolvedValue(0);
    mockPrisma.teamEmail.count.mockResolvedValue(0);
    mockPrisma.teamGlobalSettings.count.mockResolvedValue(0);
    // grp-1 is already on the destination.
    mockPrisma.teamGroup.count.mockResolvedValueOnce(1);

    const result = await getMergeImpact(mockPrisma as unknown as typeof import('@documenso/prisma').prisma, [10], 20);

    // 2 unique groups minus 1 already on destination = 1 net new member group.
    expect(result.moving.members).toBe(1);
    expect(mockPrisma.teamGroup.count).toHaveBeenCalledWith({
      where: {
        teamId: 20,
        organisationGroupId: { in: expect.arrayContaining(['grp-1', 'grp-2']) },
      },
    });
  });
});
