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

[`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts)
hardcodes three PSD401 constants: `PSD401_ORG_ID = 'org_psd401district'`,
`PSD401_MEMBER_GROUP_ID = 'org_group_psd401_member'`,
`PSD401_DEFAULT_TEAM_GROUP_ID = 'org_group_default_member'`.
`onCreateUserHook(user)` calls `addUserToPsd401Org(user.id)`, which:

- no-ops if the user already has an `OrganisationMember` row for
  `org_psd401district`;
- otherwise creates one `OrganisationMember` row with two nested
  `OrganisationGroupMember` creates: one for `org_group_psd401_member`
  (the org-wide member group) and one for `org_group_default_member` (the
  Default team's member group).

Both membership rows land on the *same* new user in the same hook call —
this is what lets a fresh Google sign-in both join the PSD401 org and get
into the Default team's document context in one step.

### Baseline membership enforcement (post-trigger migration)

The DB-level auto-join trigger (`trg_auto_add_psd401` on `Account`) was
**dropped** in migration
[`20260923000000_drop_psd401_auto_add_trigger`](../../packages/prisma/migrations/20260923000000_drop_psd401_auto_add_trigger).
That trigger created `OrganisationMember` rows holding *only* the org-wide
member group — never the Default team group — leading to the historical gap
where users could log in but had no team context.

Now baseline membership (org member + Default team) is ensured in application
code **every time**:

1. **On Google login** — `handleOAuthCallbackUrl()` calls
   `ensurePsd401BaselineMembership(userId)` after creating/finding the user
2. **On directory-sync sweep** — the nightly sweep calls it for every
   Google-linked user before applying mapping rules

[`packages/lib/server-only/directory-sync/psd401-membership.ts`](../../packages/lib/server-only/directory-sync/psd401-membership.ts)
contains `ensurePsd401BaselineMembership(userId)`, which:
- Finds all of a user's PSD401 member rows
- Picks the "primary" row (the one holding the Default team group, or the
  oldest row if none do)
- Creates any missing baseline group memberships on that primary row
- Handles concurrent creation races (e.g., two OAuth callbacks for the same
  user) by catching unique violations and re-running once

If a directory-sync or manual-provisioning path creates only the org-level
membership without the team-level one, the next sweep will correct it.

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
  and grants missing `OrganisationGroupMember` rows.
  Each grant writes a `DirectorySyncAuditLog` row (`type: MEMBERSHIP_GRANTED`),
  tagged with `source: 'login' | 'sweep'` depending on whether it ran
  right after an OAuth login or from the nightly sweep.

### Revocation mode

The apply engine can also *revoke* managed group memberships the user no
longer matches, controlled by `DIRECTORY_SYNC_REVOKE_MODE`:
- `enforce` — revocations are applied when they pass the circuit breaker
- `log` — revocations are logged (`MEMBERSHIP_REVOKE_DRY_RUN`) but not applied
- `off` — revocation logic is disabled entirely

Revocations only run when the user's directory sync status is `synced`
or `throttled` — any other status (including `error`) means the Google data
is stale, and revocations would be unsafe.

### Circuit breaker

Revocations are gated by a **circuit breaker** that trips when:
- Planned revocations exceed **10 total**, AND
- Planned revocations exceed **5%** of the managed-group population

When the breaker trips, that user's revocations are held (`deferred`) and
logged with `type: REVOKE_CIRCUIT_BREAKER`. The thresholds are defined in
[`plan-directory-membership.ts`](../../packages/lib/server-only/directory-sync/plan-directory-membership.ts)
(`REVOKE_CIRCUIT_BREAKER_MINIMUM`, `REVOKE_CIRCUIT_BREAKER_PERCENT`).

The breaker is also evaluated **per-group**: if revocations for a single
group would exceed the thresholds relative to that group's own membership,
that group's revocations are blocked even if the org-wide total is safe.
This prevents one deactivated or mistyped mapping from emptying an entire
group in a large org.

### Matching rules

`DirectoryMappingSourceField` enum: `GROUP | DEPARTMENT | ORG_UNIT`
- `GROUP` does a case-insensitive match against the user's Google group list
- `DEPARTMENT` is an exact string match
- `ORG_UNIT` is a prefix/path match on the normalized `orgUnitPath` (`/` matches everyone)

## What a mapping actually grants — correcting a common shorthand

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

## Admin UI

`admin.directoryMappings` tRPC namespace:
[`packages/trpc/server/admin-router/{create,update,delete,find}-directory-mapping*.ts`](../../packages/trpc/server/admin-router)
and `list-directory-mapping-groups.ts` (group picker). UI route:
[`apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`](../../apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx).

## Schema

Migration
[`packages/prisma/migrations/20260812000000_add_directory_group_mapping/migration.sql`](../../packages/prisma/migrations/20260812000000_add_directory_group_mapping)
added: enum `DirectoryMappingSourceField` (`GROUP`, `DEPARTMENT`,
`ORG_UNIT`); table `DirectoryGroupMapping` (`sourceField`, `sourceValue`,
`organisationGroupId`, `active`, unique on
`(sourceField, sourceValue, organisationGroupId)`); table
`DirectorySyncAuditLog` (`type`, `data` JSON, optional `userId`/`name`/
`email`, indexed on `createdAt`/`type`).

Migration
[`20260923000000_drop_psd401_auto_add_trigger`](../../packages/prisma/migrations/20260923000000_drop_psd401_auto_add_trigger)
dropped the legacy `trg_auto_add_psd401` trigger on `Account` and the
`auto_add_to_psd401_org()` function.

Design docs: [`docs/superpowers/plans/2026-05-19-google-directory-sync.md`](../../docs/superpowers/plans/2026-05-19-google-directory-sync.md)
(Phase 1: sync), [`docs/superpowers/plans/2026-08-12-directory-sync-phase2.md`](../../docs/superpowers/plans/2026-08-12-directory-sync-phase2.md)
(Phase 2: mapping + apply engine, initially additive-only; revocation added later).

## Source references

- [`packages/lib/server-only/user/create-user.ts`](../../packages/lib/server-only/user/create-user.ts)
- [`packages/lib/server-only/directory-sync/`](../../packages/lib/server-only/directory-sync) (apply, matching, plan, psd401-membership, CRUD)
- [`packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`](../../packages/lib/jobs/definitions/internal/directory-sync-sweep.ts)
- [`packages/trpc/server/admin-router/`](../../packages/trpc/server/admin-router) (`*directory-mapping*.ts`)
