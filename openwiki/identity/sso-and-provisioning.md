---
type: Reference
title: Google SSO, Auto-Join, and Directory Sync
description: >
  Google OAuth auto-join to the PSD401 organisation, the Google Directory
  Sync sweep, and the admin-managed directory-to-group mapping system.
tags: [identity, sso, google, directory-sync]
---

# Google SSO, auto-join, and directory sync

## Auto-join on sign-up

The PSD401 identifiers live in
[`packages/lib/constants/psd401.ts`](../../packages/lib/constants/psd401.ts):
`PSD401_ORG_ID = 'org_psd401district'`, `PSD401_MEMBER_GROUP_ID =
'org_group_psd401_member'`, and `PSD401_DEFAULT_TEAM_GROUP_ID =
'org_group_default_member'`. `PSD401_BASELINE_GROUP_IDS` is the pair of
member and Default team groups.

[`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts)
`onCreateUserHook(user)` is meant to run after user creation (its doc comment
cites email/password signup and Google sign-in) and calls `ensurePsd401BaselineMembership(user.id)`
in [`packages/lib/server-only/directory-sync/psd401-membership.ts`](../../packages/lib/server-only/directory-sync/psd401-membership.ts), which:

- when the user has no PSD401 `OrganisationMember` row, creates one with both
  baseline `OrganisationGroupMember` rows; a unique-violation from a concurrent
  caller (second OAuth callback, sweep) is retried once and tops up the row
  that caller created;
- when rows already exist, adds only the missing baseline groups to the
  primary row (`pickPrimaryMemberRow`: the row already holding the Default
  team group, otherwise the oldest).

Both baseline memberships land on the same user in one hook call — this is
what lets a fresh Google sign-in both join the PSD401 org and get into the
Default team's document context in one step. If a directory-sync
or manual-provisioning path creates only the org-level membership without
the team-level one, the user can log in but has no team context to send
documents from.

Sign-up is restricted by allowed email domain:
`getAllowedSignupDomains()` in
[`packages/lib/constants/auth.ts`](../../packages/lib/constants/auth.ts)
reads `NEXT_PRIVATE_ALLOWED_SIGNUP_DOMAINS` (comma-separated, lowercased,
trimmed); an empty value allows all domains. Production sets this to
`psd401.net`.

## Google Directory Sync

A nightly job re-syncs each user's Google Workspace attributes (`department`,
`orgUnitPath`, `googleGroups`) and, separately from the sync itself, an
apply engine grants org-group membership based on admin-managed mapping
rules — both gated behind `GOOGLE_DIRECTORY_SYNC_ENABLED=true`.

- **Sweep job**: [`packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`](../../packages/lib/jobs/definitions/internal/directory-sync-sweep.ts),
  cron `0 9 * * *` (09:00 UTC, ~1am Pacific), handler in
  `directory-sync-sweep.handler.ts`. The sweep defers revocations and applies
  none when a circuit breaker trips: more than 10 planned revocations and more
  than 5% of memberships in managed groups, or the same limit within a single
  group (`REVOKE_CIRCUIT_BREAKER_MINIMUM`/`_PERCENT`). The trip is logged as an
  error and written as a `REVOKE_CIRCUIT_BREAKER` audit entry.
- **Apply engine**: [`packages/lib/server-only/directory-sync/apply-directory-mappings.ts`](../../packages/lib/server-only/directory-sync/apply-directory-mappings.ts) —
  reads a user's synced `department`/`orgUnitPath`/`googleGroups` and all
  `active: true` `DirectoryGroupMapping` rows, matches via
  [`mapping-matching.ts`](../../packages/lib/server-only/directory-sync/mapping-matching.ts),
  and inserts any missing `OrganisationGroupMember` rows (grants). It also
  revokes directory-managed group memberships the user no longer matches
  (`applyDirectoryRevocations`, `packages/lib/server-only/directory-sync/plan-directory-membership.ts`
  decides which rows). The behaviour is set by `DIRECTORY_SYNC_REVOKE_MODE`
  (`enforce` deletes and writes `MEMBERSHIP_REVOKED`; `log`, the default when unset
  or unrecognised, deletes nothing and writes `MEMBERSHIP_REVOKE_DRY_RUN`;
  `off` skips revocations). Revocations are planned only when the user's
  directory sync status is `synced` or `throttled`, and PSD401 baseline groups
  (`PSD401_BASELINE_GROUP_IDS`) are never revoked. Each grant writes a
  `DirectorySyncAuditLog` row (`type: MEMBERSHIP_GRANTED`), tagged with
  `source: 'login' | 'sweep'` depending on whether it ran right after an
  OAuth login or from the nightly sweep.
- **Matching rules** (`DirectoryMappingSourceField` enum:
  `GROUP | DEPARTMENT | ORG_UNIT`): `GROUP` does a case-insensitive match
  against the user's Google group list; `DEPARTMENT` is an exact string
  match; `ORG_UNIT` is a prefix/path match on the normalized
  `orgUnitPath` (`/` matches everyone).

### What a mapping actually grants — correcting a common shorthand

A `DirectoryGroupMapping` row (schema.prisma, `DirectoryGroupMapping`
model) has FK `organisationGroupId → OrganisationGroup`, **not** a direct
FK to `Team`. A mapping grants membership in an `OrganisationGroup`; that
group only translates into team access if it's separately linked to a
team via a `TeamGroup` row (`organisationGroupId` + `teamId` +
`teamRole`). So "map a Google attribute to a team" is a two-step
relationship in the schema: attribute → `OrganisationGroup` (via the
mapping) → `Team` (via a pre-existing `TeamGroup` link) — not a mapping
directly onto a team. This matters when troubleshooting: creating a
mapping to a group that isn't linked to any team via `TeamGroup` grants
org membership but no team/document access.

### Admin UI

`admin.directoryMappings` tRPC namespace:
[`packages/trpc/server/admin-router/create-directory-mapping.ts`](../../packages/trpc/server/admin-router/create-directory-mapping.ts)
and its `update-`, `delete-`, `find-directory-mapping*.ts` siblings, plus `list-directory-mapping-groups.ts` (group picker). UI route:
[`apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`](../../apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx).

### Schema

Migration
[`packages/prisma/migrations/20260812000000_add_directory_group_mapping/migration.sql`](../../packages/prisma/migrations/20260812000000_add_directory_group_mapping/migration.sql)
added: enum `DirectoryMappingSourceField` (`GROUP`, `DEPARTMENT`,
`ORG_UNIT`); table `DirectoryGroupMapping` (`sourceField`, `sourceValue`,
`organisationGroupId`, `active`, unique on
`(sourceField, sourceValue, organisationGroupId)`); table
`DirectorySyncAuditLog` (`type`, `data` JSON, optional `userId`/`name`/
`email`, indexed on `createdAt`/`type`).

Design docs: [`docs/superpowers/plans/2026-05-19-google-directory-sync.md`](../../docs/superpowers/plans/2026-05-19-google-directory-sync.md)
(Phase 1: sync), [`docs/superpowers/plans/2026-08-12-directory-sync-phase2.md`](../../docs/superpowers/plans/2026-08-12-directory-sync-phase2.md)
(Phase 2: mapping + apply engine; it states an additive-only invariant that the later revocation feature in `e01b7f664` extends).

## Source references

- [`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts)
- [`packages/lib/server-only/directory-sync/apply-directory-mappings.ts`](../../packages/lib/server-only/directory-sync/apply-directory-mappings.ts) (apply, matching, CRUD)
- [`packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`](../../packages/lib/jobs/definitions/internal/directory-sync-sweep.ts)
- [`packages/trpc/server/admin-router/create-directory-mapping.ts`](../../packages/trpc/server/admin-router/create-directory-mapping.ts) (`*directory-mapping*.ts`)
