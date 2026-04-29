// ABOUTME: Server-side logic for the team merge feature.
// ABOUTME: Provides getMergeImpact (shared count helper) and mergeTeamsPreview (org-validated preview).
import { EnvelopeType, OrganisationGroupType } from '@prisma/client';

import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { prisma } from '@documenso/prisma';
import type { TMergeTeamsPreviewResponse } from '@documenso/trpc/server/team-router/merge-teams.types';

import { ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP } from '../../constants/organisations';
import { buildOrganisationWhereQuery } from '../../utils/organisations';

export type MergeTeamsPreviewOptions = {
  userId: number;
  organisationId: string;
  sourceTeamIds: number[];
  destinationTeamId?: number;
};

/**
 * Computes the impact counts for a merge of one or more source teams.
 *
 * Accepts either the base prisma client or a transaction client so it can be
 * reused inside a $transaction callback by Task 3.
 */
export const getMergeImpact = async (
  tx: typeof prisma,
  sourceTeamIds: number[],
  destinationTeamId?: number,
): Promise<TMergeTeamsPreviewResponse> => {
  if (sourceTeamIds.length === 0) {
    return {
      moving: { documents: 0, templates: 0, folders: 0, members: 0 },
      discarding: { webhooks: 0, apiTokens: 0, teamEmails: 0, teamSettings: 0 },
    };
  }

  const [
    documents,
    templates,
    folders,
    sourceGroups,
    webhooks,
    apiTokens,
    teamEmails,
    teamSettings,
  ] = await Promise.all([
    tx.envelope.count({
      where: { teamId: { in: sourceTeamIds }, type: EnvelopeType.DOCUMENT },
    }),
    tx.envelope.count({
      where: { teamId: { in: sourceTeamIds }, type: EnvelopeType.TEMPLATE },
    }),
    tx.folder.count({
      where: { teamId: { in: sourceTeamIds } },
    }),
    tx.teamGroup.findMany({
      where: { teamId: { in: sourceTeamIds } },
      include: { organisationGroup: true },
    }),
    tx.webhook.count({
      where: { teamId: { in: sourceTeamIds } },
    }),
    tx.apiToken.count({
      where: { teamId: { in: sourceTeamIds } },
    }),
    tx.teamEmail.count({
      where: { teamId: { in: sourceTeamIds } },
    }),
    tx.teamGlobalSettings.count({
      where: { team: { id: { in: sourceTeamIds } } },
    }),
  ]);

  // Determine which unique non-INTERNAL_TEAM groups from source teams would be
  // new additions on the destination team (i.e. not already attached there).
  const nonInternalGroups = sourceGroups.filter(
    (g) => g.organisationGroup.type !== OrganisationGroupType.INTERNAL_TEAM,
  );

  // Deduplicate by organisationGroupId across all source teams.
  const uniqueOrgGroupIds = [...new Set(nonInternalGroups.map((g) => g.organisationGroupId))];

  let members = uniqueOrgGroupIds.length;

  if (destinationTeamId !== undefined && uniqueOrgGroupIds.length > 0) {
    // Subtract groups that are already on the destination team.
    const alreadyOnDestination = await tx.teamGroup.count({
      where: {
        teamId: destinationTeamId,
        organisationGroupId: { in: uniqueOrgGroupIds },
      },
    });
    members -= alreadyOnDestination;
  }

  return {
    moving: { documents, templates, folders, members },
    discarding: { webhooks, apiTokens, teamEmails, teamSettings },
  };
};

/**
 * Returns a preview of what would be moved or discarded if the given source
 * teams were merged into the destination team (or a new team).
 */
export const mergeTeamsPreview = async ({
  userId,
  organisationId,
  sourceTeamIds,
  destinationTeamId,
}: MergeTeamsPreviewOptions): Promise<TMergeTeamsPreviewResponse> => {
  const organisation = await prisma.organisation.findFirst({
    where: buildOrganisationWhereQuery({
      organisationId,
      userId,
      roles: ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'],
    }),
  });

  if (!organisation) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Organisation not found.',
    });
  }

  // Validate all source team IDs belong to this organisation.
  if (sourceTeamIds.length > 0) {
    const validSourceCount = await prisma.team.count({
      where: { id: { in: sourceTeamIds }, organisationId },
    });

    if (validSourceCount !== sourceTeamIds.length) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: 'One or more source teams were not found in this organisation.',
      });
    }
  }

  // Validate destination team belongs to the organisation (if provided).
  if (destinationTeamId !== undefined) {
    const destinationTeam = await prisma.team.findFirst({
      where: { id: destinationTeamId, organisationId },
    });

    if (!destinationTeam) {
      throw new AppError(AppErrorCode.NOT_FOUND, {
        message: 'Destination team was not found in this organisation.',
      });
    }
  }

  // Filter out the destination team from sources (it can't merge into itself).
  const effectiveSourceIds =
    destinationTeamId !== undefined
      ? sourceTeamIds.filter((id) => id !== destinationTeamId)
      : sourceTeamIds;

  if (effectiveSourceIds.length === 0) {
    return {
      moving: { documents: 0, templates: 0, folders: 0, members: 0 },
      discarding: { webhooks: 0, apiTokens: 0, teamEmails: 0, teamSettings: 0 },
    };
  }

  return getMergeImpact(prisma, effectiveSourceIds, destinationTeamId);
};
