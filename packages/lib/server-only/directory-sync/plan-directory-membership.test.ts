// ABOUTME: Unit tests for the pure directory membership planner, focused on never revoking
// ABOUTME: a group when its directory field has never been fetched, plus the revocation circuit breaker.
import { describe, expect, it } from 'vitest';

import {
  exceedsRevokeCircuitBreaker,
  findGroupsExceedingRevokeCircuitBreaker,
  groupGrantsAdmin,
  type PlannableDirectoryMapping,
  planDirectoryMembership,
} from './plan-directory-membership';

const GROUP_MAPPING: PlannableDirectoryMapping = {
  id: 'map_group',
  sourceField: 'GROUP',
  sourceValue: 'tsd-staff@psd401.net',
  organisationGroupId: 'org_group_tsd',
  active: true,
  targetGrantsAdmin: false,
};

const ORG_UNIT_MAPPING: PlannableDirectoryMapping = {
  id: 'map_ou',
  sourceField: 'ORG_UNIT',
  sourceValue: '/Staff/TSD',
  organisationGroupId: 'org_group_ou',
  active: true,
  targetGrantsAdmin: false,
};

const DEPARTMENT_MAPPING: PlannableDirectoryMapping = {
  id: 'map_dept',
  sourceField: 'DEPARTMENT',
  sourceValue: 'TSD',
  organisationGroupId: 'org_group_dept',
  active: true,
  targetGrantsAdmin: false,
};

const held = (groupId: string) => ({
  id: `ogm_${groupId}`,
  organisationMemberId: 'member_1',
  groupId,
});

describe('planDirectoryMembership revocation safety', () => {
  it('revokes a GROUP-mapped group when fetched groups no longer include it', () => {
    const plan = planDirectoryMembership({
      mappings: [GROUP_MAPPING],
      profile: { department: null, orgUnitPath: '/Staff', googleGroups: [] },
      heldMemberships: [held('org_group_tsd')],
    });

    expect(plan.revocations.map((r) => r.organisationGroupId)).toEqual(['org_group_tsd']);
  });

  it('does not revoke a GROUP-mapped group when googleGroups has never been fetched', () => {
    const plan = planDirectoryMembership({
      mappings: [GROUP_MAPPING],
      profile: { department: null, orgUnitPath: '/Staff', googleGroups: null },
      heldMemberships: [held('org_group_tsd')],
    });

    expect(plan.revocations).toEqual([]);
  });

  it('does not revoke ORG_UNIT or DEPARTMENT groups when the user profile has never been fetched', () => {
    const plan = planDirectoryMembership({
      mappings: [ORG_UNIT_MAPPING, DEPARTMENT_MAPPING],
      profile: { department: null, orgUnitPath: null, googleGroups: [] },
      heldMemberships: [held('org_group_ou'), held('org_group_dept')],
    });

    expect(plan.revocations).toEqual([]);
  });

  it('keeps a group when one of its mappings depends on unknown data, even if another mapping is decidable', () => {
    const plan = planDirectoryMembership({
      mappings: [GROUP_MAPPING, { ...ORG_UNIT_MAPPING, organisationGroupId: 'org_group_tsd' }],
      profile: { department: null, orgUnitPath: '/Staff/Other', googleGroups: null },
      heldMemberships: [held('org_group_tsd')],
    });

    expect(plan.revocations).toEqual([]);
  });
});

describe('exceedsRevokeCircuitBreaker', () => {
  it('does not trip on a single revocation in a small managed population', () => {
    expect(exceedsRevokeCircuitBreaker(1, 11)).toBe(false);
  });

  it('does not trip at or below the absolute floor even when the percentage is high', () => {
    expect(exceedsRevokeCircuitBreaker(10, 20)).toBe(false);
  });

  it('trips when planned revocations exceed both the floor and the percentage', () => {
    expect(exceedsRevokeCircuitBreaker(11, 100)).toBe(true);
  });

  it('does not trip when planned revocations exceed the floor but stay under the percentage', () => {
    expect(exceedsRevokeCircuitBreaker(11, 1000)).toBe(false);
  });
});

describe('findGroupsExceedingRevokeCircuitBreaker', () => {
  it('flags a single group losing most of its members even when the org-wide share is small', () => {
    const tripped = findGroupsExceedingRevokeCircuitBreaker(
      new Map([
        ['org_group_building', 60],
        ['org_group_other', 1],
      ]),
      new Map([
        ['org_group_building', 60],
        ['org_group_other', 400],
      ]),
    );

    expect(tripped).toEqual(['org_group_building']);
  });

  it('flags nothing when every group stays at or under the floor', () => {
    const tripped = findGroupsExceedingRevokeCircuitBreaker(
      new Map([['org_group_small', 10]]),
      new Map([['org_group_small', 12]]),
    );

    expect(tripped).toEqual([]);
  });
});

describe('planDirectoryMembership admin-target guard', () => {
  const ADMIN_MAPPING: PlannableDirectoryMapping = {
    ...GROUP_MAPPING,
    id: 'map_admin',
    organisationGroupId: 'org_group_admin',
    targetGrantsAdmin: true,
  };

  it('never grants a group that grants admin, even when the mapping matches', () => {
    const plan = planDirectoryMembership({
      mappings: [GROUP_MAPPING, ADMIN_MAPPING],
      profile: { department: null, orgUnitPath: '/Staff', googleGroups: ['tsd-staff@psd401.net'] },
      heldMemberships: [],
    });

    expect(plan.grants.map((grant) => grant.organisationGroupId)).toEqual(['org_group_tsd']);
  });

  it('never revokes from a group that grants admin, because the mapping does not make it managed', () => {
    const plan = planDirectoryMembership({
      mappings: [ADMIN_MAPPING],
      profile: { department: null, orgUnitPath: '/Staff', googleGroups: [] },
      heldMemberships: [held('org_group_admin')],
    });

    expect(plan.revocations).toEqual([]);
  });
});

describe('groupGrantsAdmin', () => {
  it('is true for an organisation ADMIN group or a group linked to any team as ADMIN', () => {
    expect(groupGrantsAdmin({ organisationRole: 'ADMIN', teamGroups: [] })).toBe(true);
    expect(
      groupGrantsAdmin({ organisationRole: 'MEMBER', teamGroups: [{ teamRole: 'MEMBER' }, { teamRole: 'ADMIN' }] }),
    ).toBe(true);
  });

  it('is false for MEMBER and MANAGER groups with no ADMIN team link', () => {
    expect(groupGrantsAdmin({ organisationRole: 'MEMBER', teamGroups: [{ teamRole: 'MEMBER' }] })).toBe(false);
    expect(groupGrantsAdmin({ organisationRole: 'MANAGER', teamGroups: [{ teamRole: 'MANAGER' }] })).toBe(false);
  });
});
