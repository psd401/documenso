---
type: Reference
title: Google SSO, Auto-Join, and Directory Sync
description: >
  Google OAuth auto-join to the PSD401 organisation, the Google Directory
  Sync sweep with revocation and circuit breaker, and the admin-managed
  directory-to-group mapping system.
tags: [identity, sso, google, directory-sync]
---

# Google SSO, auto-join, and directory sync

## Auto-join on sign-up

Baseline group IDs are centralized in
[`packages/lib/constants/psd401.ts`](../../packages/lib/constants/psd401.ts):
`PSD401_ORG_ID = 'org_psd401district'`,
`PSD401_MEMBER_GROUP_ID = 'org_group_psd401_member'`,
`PSD401_DEFAULT_TEAM_GROUP_ID = 'org_group_default_member'`, and
`PSD401_BASELINE_GROUP_IDS` (the two group IDs that are never revoked).

[`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts)
runs `onCreateUserHook(user)`, which delegates to
[`ensurePsd401BaselineMembership(user.id)`](../../packages/lib/server-only/directory-sync/psd401-membership.ts). That function:

- no-ops if at least one `OrganisationMember` row for `org_psd401district`
  already holds both baseline groups;
- otherwise finds or creates the member row and inserts any missing baseline
  `OrganisationGroupMember` rows (org member group + Default team group).

Both baseline group memberships are always added together — this is what lets
a fresh Google sign-in both join the PSD401 org and get into the Default
team's document context in one step. The function handles the race where a
concurrent caller (second OAuth callback, sweep) creates the member row
between read and insert, retrying once on unique constraint violation.

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
  `directory-sync-sweep.handler.ts`.
- **Apply engine**: [`packages/lib/server-only/directory-sync/apply-directory-mappings.ts`](../../packages/lib/server-only/directory-sync/apply-directory-mappings.ts) —
  reads a user's synced `department`/`orgUnitPath`/`googleGroups` and all
  `active: true` `DirectoryGroupMapping` rows, matches via
  [`mapping-matching.ts`](../../packages/lib/server-only/directory-sync/mapping-matching.ts),
  and grants or revokes `OrganisationGroupMember` rows per the plan from
  [`plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts).
  Each change writes a `DirectorySyncAuditLog` row (`type: MEMBERSHIP_GRANTED`
  or `MEMBERSHIP_REVOKED`), tagged with `source: 'login' | 'sweep'`
  depending on whether it ran right after an OAuth login or from the sweep.
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

### Revocation and the circuit breaker

The planning function
[`plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts)
identifies both grants and revocations: grants are matched groups the user
doesn't hold; revocations are existing memberships in managed groups that
no longer match any active mapping. A group is "managed" when at least one
active `DirectoryGroupMapping` targets it; a non-match means the user's
profile no longer satisfies any of that group's active mappings.

Two protections prevent mass-revocation bugs:

1. **Baseline groups are never revoked** — `PSD401_BASELINE_GROUP_IDS`
   (`org_group_psd401_member`, `org_group_default_member`) are excluded
   from revocation planning entirely. A user always keeps org-level and
   Default-team membership regardless of directory matches. These constants
   are centralized in
   [`packages/lib/constants/psd401.ts`](../../packages/lib/constants/psd401.ts).
2. **Circuit breaker on sweep revocations** — the sweep handler
   (`directory-sync-sweep.handler.ts`) trips if planned revocations exceed
   both 10 users and 5% of all memberships in managed groups. The breaker
   logs a warning and skips all revocations for that run, continuing with
   grants only. This protects against a misconfigured mapping (e.g. an
   empty `sourceValue` matching everyone) from stripping access across the
   district. The thresholds are constants
   `REVOKE_CIRCUIT_BREAKER_MINIMUM` and
   `REVOKE_CIRCUIT_BREAKER_PERCENT` in
   [`plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts).

A group is never revoked when any of its active mappings depends on
directory data that was never fetched: `googleGroups` (null/undefined
rather than an array) or `orgUnitPath` (null). In that state, a non-match
means "unknown" rather than "not a member," so the planner treats it as
undecidable and skips the revocation.

### Baseline membership ensuring

[`packages/lib/server-only/directory-sync/psd401-membership.ts`](../../packages/lib/server-only/directory-sync/psd401-membership.ts)
centralizes baseline group handling: `ensurePsd401BaselineMembership()`
guarantees that a user holds both `PSD401_MEMBER_GROUP_ID` and
`PSD401_DEFAULT_TEAM_GROUP_ID` on at least one `OrganisationMember` row.
It's called both by the OAuth login path (immediately after profile sync)
and by the nightly sweep, with a retry path handling the race where a
concurrent caller creates the member row between the read and insert.

The old `trg_auto_add_psd401` database trigger — which only added the org
member group, never the Default team group — was dropped in migration
[`20260923000000_drop_psd401_auto_add_trigger`](../../packages/prisma/migrations/20260923000000_drop_psd401_auto_add_trigger/migration.sql).
Baseline membership is now entirely application-layer, ensuring both groups
are always added together.

### Admin UI

`admin.directoryMappings` tRPC namespace:
[`packages/trpc/server/admin-router/{create,update,delete,find}-directory-mapping*.ts`](../../packages/trpc/server/admin-router)
and `list-directory-mapping-groups.ts` (group picker). UI route:
[`apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`](../../apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx).

### Schema

Migration
[`packages/prisma/migrations/20260812000000_add_directory_group_mapping/migration.sql`](../../packages/prisma/migrations/20260812000000_add_directory_group_mapping)
added: enum `DirectoryMappingSourceField` (`GROUP`, `DEPARTMENT`,
`ORG_UNIT`); table `DirectoryGroupMapping` (`sourceField`, `sourceValue`,
`organisationGroupId`, `active`, unique on
`(sourceField, sourceValue, organisationGroupId)`); table
`DirectorySyncAuditLog` (`type`, `data` JSON, optional `userId`/`name`/
`email`, indexed on `createdAt`/`type`).

Design docs: [`docs/superpowers/plans/2026-05-19-google-directory-sync.md`](../../docs/superpowers/plans/2026-05-19-google-directory-sync.md)
(Phase 1: sync), [`docs/superpowers/plans/2026-08-12-directory-sync-phase2.md`](../../docs/superpowers/plans/2026-08-12-directory-sync-phase2.md)
(Phase 2: mapping + apply engine). The revocation + circuit breaker logic
(Phase 3) is documented inline in
[`plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts).

## Source references

- [`packages/lib/constants/psd401.ts`](../../packages/lib/constants/psd401.ts) — baseline group IDs
- [`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts) — auto-join hook
- [`packages/lib/server-only/directory-sync/psd401-membership.ts`](../../packages/lib/server-only/directory-sync/psd401-membership.ts) — baseline ensuring
- [`packages/lib/server-only/directory-sync/plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts) — grant/revocation planning + circuit breaker thresholds
- [`packages/lib/server-only/directory-sync/apply-directory-mappings.ts`](../../packages/lib/server-only/directory-sync/apply-directory-mappings.ts) — applies the plan
- [`packages/lib/server-only/directory-sync/mapping-matching.ts`](../../packages/lib/server-only/directory-sync/mapping-matching.ts) — match logic
- [`packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`](../../packages/lib/jobs/definitions/internal/directory-sync-sweep.ts) — nightly sweep
- [`packages/trpc/server/admin-router/`](../../packages/trpc/server/admin-router) (`*directory-mapping*.ts`) — admin CRUD
- [`packages/prisma/migrations/20260923000000_drop_psd401_auto_add_trigger/`](../../packages/prisma/migrations/20260923000000_drop_psd401_auto_add_trigger) — removed DB trigger
