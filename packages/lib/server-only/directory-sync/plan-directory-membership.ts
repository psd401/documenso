// ABOUTME: Pure membership planning for directory sync: which mapped groups to grant and which managed rows to revoke,
// ABOUTME: plus the sweep's revocation circuit-breaker threshold. No I/O, no Prisma.
import type { DirectoryMappingSourceField } from '@prisma/client';

import { PSD401_BASELINE_GROUP_IDS } from '../../constants/psd401';
import { matchDirectoryMapping } from './mapping-matching';

export const REVOKE_CIRCUIT_BREAKER_PERCENT = 5;
export const REVOKE_CIRCUIT_BREAKER_MINIMUM = 10;

export type PlannableDirectoryMapping = {
  id: string;
  sourceField: DirectoryMappingSourceField;
  sourceValue: string;
  organisationGroupId: string;
  active: boolean;
};

export type DirectoryProfile = {
  department: string | null;
  orgUnitPath: string | null;
  googleGroups: unknown;
};

export type HeldGroupMembership = {
  id: string;
  organisationMemberId: string;
  groupId: string;
};

export type PlannedGrant = {
  organisationGroupId: string;
  mappingIds: string[];
};

export type PlannedRevocation = {
  organisationGroupMemberId: string;
  organisationMemberId: string;
  organisationGroupId: string;
};

export type DirectoryMembershipPlan = {
  grants: PlannedGrant[];
  revocations: PlannedRevocation[];
};

/**
 * True when the profile field this mapping reads has never been fetched from Google, so a non-match
 * means "unknown" rather than "not a member". googleGroups is only ever written as an array, and
 * Google always returns an orgUnitPath, so null orgUnitPath means the user lookup never succeeded.
 */
const dependsOnUnfetchedData = (mapping: PlannableDirectoryMapping, profile: DirectoryProfile): boolean =>
  mapping.sourceField === 'GROUP' ? !Array.isArray(profile.googleGroups) : profile.orgUnitPath === null;

/**
 * A group is managed when at least one active mapping targets it. Grants are matched groups the
 * user holds on none of their member rows. Revocations are rows in managed, non-baseline groups
 * that no active mapping matches. Inactive mappings neither grant nor make a group managed.
 * A group is never revoked while any of its active mappings depends on unfetched directory data.
 */
export const planDirectoryMembership = ({
  mappings,
  profile,
  heldMemberships,
}: {
  mappings: PlannableDirectoryMapping[];
  profile: DirectoryProfile;
  heldMemberships: HeldGroupMembership[];
}): DirectoryMembershipPlan => {
  const managedGroupIds = new Set<string>();
  const undecidableGroupIds = new Set<string>();
  const matchedMappingIdsByGroup = new Map<string, string[]>();

  for (const mapping of mappings) {
    if (!mapping.active) {
      continue;
    }

    managedGroupIds.add(mapping.organisationGroupId);

    if (dependsOnUnfetchedData(mapping, profile)) {
      undecidableGroupIds.add(mapping.organisationGroupId);
    }

    if (!matchDirectoryMapping(mapping, profile)) {
      continue;
    }

    const matchedIds = matchedMappingIdsByGroup.get(mapping.organisationGroupId) ?? [];
    matchedIds.push(mapping.id);
    matchedMappingIdsByGroup.set(mapping.organisationGroupId, matchedIds);
  }

  const heldGroupIds = new Set(heldMemberships.map((membership) => membership.groupId));

  const grants = [...matchedMappingIdsByGroup.entries()]
    .filter(([groupId]) => !heldGroupIds.has(groupId))
    .map(([organisationGroupId, mappingIds]) => ({ organisationGroupId, mappingIds }));

  const revocations = heldMemberships
    .filter(
      (membership) =>
        managedGroupIds.has(membership.groupId) &&
        !undecidableGroupIds.has(membership.groupId) &&
        !matchedMappingIdsByGroup.has(membership.groupId) &&
        !PSD401_BASELINE_GROUP_IDS.includes(membership.groupId),
    )
    .map((membership) => ({
      organisationGroupMemberId: membership.id,
      organisationMemberId: membership.organisationMemberId,
      organisationGroupId: membership.groupId,
    }));

  return { grants, revocations };
};

/**
 * True when the planned revocations exceed both REVOKE_CIRCUIT_BREAKER_MINIMUM and
 * REVOKE_CIRCUIT_BREAKER_PERCENT of all rows in managed groups. The minimum keeps a single
 * legitimate revocation in a small managed population from tripping the breaker.
 */
export const exceedsRevokeCircuitBreaker = (plannedRevocationCount: number, managedMembershipCount: number): boolean =>
  plannedRevocationCount > REVOKE_CIRCUIT_BREAKER_MINIMUM &&
  plannedRevocationCount * 100 > managedMembershipCount * REVOKE_CIRCUIT_BREAKER_PERCENT;

/**
 * Group ids whose planned revocations exceed the breaker thresholds relative to that group's own
 * membership, so one deactivated or mistyped mapping cannot empty a group inside a large org.
 */
export const findGroupsExceedingRevokeCircuitBreaker = (
  plannedRevocationsByGroup: Map<string, number>,
  membershipCountByGroup: Map<string, number>,
): string[] =>
  [...plannedRevocationsByGroup.entries()]
    .filter(([groupId, planned]) => exceedsRevokeCircuitBreaker(planned, membershipCountByGroup.get(groupId) ?? 0))
    .map(([groupId]) => groupId);
