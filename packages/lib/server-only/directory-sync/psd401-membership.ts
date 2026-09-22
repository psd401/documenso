// ABOUTME: PSD401 org membership helpers: loads all of a user's PSD401 member rows, picks the row new groups go on,
// ABOUTME: and ensures the baseline groups (org member + Default team) are held on at least one row.
import { prisma } from '@documenso/prisma';

import {
  PSD401_BASELINE_GROUP_IDS,
  PSD401_DEFAULT_TEAM_GROUP_ID,
  PSD401_ORG_ID,
} from '../../constants/psd401';
import { generateDatabaseId } from '../../universal/id';

export type Psd401MemberRow = {
  id: string;
  createdAt: Date;
  organisationGroupMembers: { id: string; organisationMemberId: string; groupId: string }[];
};

export const findPsd401MemberRows = async (userId: number): Promise<Psd401MemberRow[]> => {
  return await prisma.organisationMember.findMany({
    where: { userId, organisationId: PSD401_ORG_ID },
    select: {
      id: true,
      createdAt: true,
      organisationGroupMembers: {
        select: { id: true, organisationMemberId: true, groupId: true },
      },
    },
  });
};

/**
 * Picks the member row that newly granted groups are attached to: the row that already holds
 * the Default team group, otherwise the oldest row (ties broken by id).
 */
export const pickPrimaryMemberRow = <T extends Psd401MemberRow>(rows: T[]): T | undefined => {
  const oldestFirst = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  return (
    oldestFirst.find((row) =>
      row.organisationGroupMembers.some(
        (groupMember) => groupMember.groupId === PSD401_DEFAULT_TEAM_GROUP_ID,
      ),
    ) ?? oldestFirst[0]
  );
};

export const ensurePsd401BaselineMembership = async (userId: number) => {
  const memberRows = await findPsd401MemberRows(userId);
  const primaryRow = pickPrimaryMemberRow(memberRows);

  if (!primaryRow) {
    await prisma.organisationMember.create({
      data: {
        id: generateDatabaseId('member'),
        userId,
        organisationId: PSD401_ORG_ID,
        organisationGroupMembers: {
          create: PSD401_BASELINE_GROUP_IDS.map((groupId) => ({
            id: generateDatabaseId('group_member'),
            groupId,
          })),
        },
      },
    });

    return;
  }

  const heldGroupIds = new Set(
    memberRows.flatMap((row) =>
      row.organisationGroupMembers.map((groupMember) => groupMember.groupId),
    ),
  );

  const missingGroupIds = PSD401_BASELINE_GROUP_IDS.filter((groupId) => !heldGroupIds.has(groupId));

  if (missingGroupIds.length === 0) {
    return;
  }

  await prisma.organisationGroupMember.createMany({
    data: missingGroupIds.map((groupId) => ({
      id: generateDatabaseId('group_member'),
      groupId,
      organisationMemberId: primaryRow.id,
    })),
    skipDuplicates: true,
  });
};
