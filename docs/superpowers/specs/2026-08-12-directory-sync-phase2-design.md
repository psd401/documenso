# Directory Sync Phase 2: Group Mapping + Prod Enablement

- **Date**: 2026-08-12
- **Status**: Approved by Reese (design sections approved in session dde2028c)
- **Depends on**: Phase 1 directory data sync (built 2026-05-19, merged to main, live on dev)

## Problem

Google Workspace already knows every staff member's department, title, org unit, and group
memberships. Documenso does not. Team membership is managed by hand (or by support scripts),
which does not scale across 40+ teams and 285+ users. Phase 1 syncs the raw directory data
onto `User` rows at login, but only on dev, and nothing consumes it.

## Goal

1. Enable Phase 1 data sync on prod for all users.
2. Map synced directory data to Documenso group memberships automatically, via admin-managed
   rules, applied at login and by a nightly sweep.

## Hard constraint: non-destructive

The system only adds. It inserts missing `OrganisationGroupMember` rows and never deletes,
never updates, and never removes any membership. Deactivating or deleting a mapping rule
stops future grants and removes nothing. There is no delete path in the apply code at all.
This deliberately rejects the PRR pattern's authoritative removal and fail-closed
revalidation.

## Current state (verified 2026-08-12)

- Phase 1 orchestrator: `packages/lib/server-only/user/sync-google-directory.ts`. Feature
  gate `GOOGLE_DIRECTORY_SYNC_ENABLED`, 1-hour throttle, null-safe partial writes.
- Called fire-and-forget from all three OAuth callback paths in
  `packages/auth/server/lib/utils/handle-oauth-callback-url.ts` (lines 81, 150, 211).
- Dev: enabled and verified (3/194 users synced, data quality confirmed via psql).
- Prod: disabled. No `GOOGLE_*` env vars and no service account key on the EC2 host.
  0/285 users synced.
- Phase 2 (mapping to memberships) does not exist. No backfill or sweep exists.

## Design

### 1. Schema (one migration, all additive)

New Prisma enum and two new models. No existing table changes.

```prisma
enum DirectoryMappingSourceField {
  GROUP
  DEPARTMENT
  ORG_UNIT
}

model DirectoryGroupMapping {
  id                  String                      @id
  sourceField         DirectoryMappingSourceField
  sourceValue         String
  organisationGroupId String
  organisationGroup   OrganisationGroup           @relation(fields: [organisationGroupId], references: [id], onDelete: Cascade)
  active              Boolean                     @default(true)
  createdAt           DateTime                    @default(now())
  updatedAt           DateTime                    @updatedAt

  @@unique([sourceField, sourceValue, organisationGroupId])
}

model DirectorySyncAuditLog {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  type      String
  data      Json
  userId    Int?
  name      String?
  email     String?

  @@index([createdAt])
  @@index([type])
}
```

- `DirectoryGroupMapping.id` uses `generateDatabaseId` with a new `directory_mapping`
  prefix added to the prefix union in `packages/lib/universal/id.ts`.
- `DirectorySyncAuditLog` mirrors the `DocumentAuditLog` convention
  (`packages/prisma/schema.prisma:484-501`): `type` is a plain String validated by a Zod
  enum, `data` is a Json payload, actor fields are denormalized with no FK. Recon confirmed
  no admin-config audit mechanism exists today, so this table is new.
- Audit types: `MAPPING_CREATED`, `MAPPING_UPDATED`, `MAPPING_DELETED`,
  `MEMBERSHIP_GRANTED`. Rule-change entries store a `{ from, to }` diff in `data` plus the
  mapping id. Grant entries store the target user, group, and the mapping id that matched.
  System-initiated grants (the sweep) use `userId: null` and `name: "directory-sync"`.

### 2. Apply engine (additive-only)

New module `packages/lib/server-only/directory-sync/apply-directory-mappings.ts` exporting
`applyDirectoryMappings(userId)`.

Matching semantics per source field, against the user's synced columns:

- `GROUP`: case-insensitive membership test of `sourceValue` in the `googleGroups` array.
- `DEPARTMENT`: exact match on `department`.
- `ORG_UNIT`: path-segment prefix match on `orgUnitPath`. `/Staff/GHH` matches
  `/Staff/GHH` and `/Staff/GHH/Teachers`, and does not match `/Staff/GHHS`.

Algorithm:

1. Load the user's directory columns and all `active` mappings.
2. Compute the set of target `organisationGroupId`s whose rules match.
3. Load the user's `OrganisationMember` row for the PSD401 org. Users can have multiple
   member rows (the `org_member_auto_` gotcha), so pin to the row that already holds
   `org_group_default_member`, else the oldest row. If the user has no member row, skip
   and log (the SSO hook owns org join, not this engine).
4. Diff target groups against the member row's existing `OrganisationGroupMember` rows.
5. Insert only the missing rows via `createMany` with `skipDuplicates: true`
   (`id: generateDatabaseId('group_member')`). The `@@unique([organisationMemberId, groupId])`
   constraint is the backstop, and `skipDuplicates` makes concurrent login + sweep runs
   race-safe.
6. Write one `MEMBERSHIP_GRANTED` audit row per inserted membership.

Re-running is idempotent: no matches missing means no inserts and no audit rows.

Deliberate divergence from upstream: mappings may target INTERNAL groups as well as CUSTOM
groups. Upstream's group-members API rejects INTERNAL groups
(`add-organisation-group-members.ts:49-56`), but this fork already manages INTERNAL
membership directly (`create-user.ts`, `provision-user.sh`), and standard teams' member
groups are the natural mapping targets.

### 3. Nightly sweep job

New job `internal.directory-sync-sweep` copying the seal-sweep pattern
(`packages/lib/jobs/definitions/internal/seal-document-sweep.ts`): definition file with
`trigger.cron`, `trigger.schema: z.object({})`, and a thin handler lazy-importing
`.handler.ts`. Registered in the `jobsClient` array (`packages/lib/jobs/client.ts`). The
Local provider picks it up automatically, with deterministic cron run ids deduplicating
across instances.

- Cron: `0 9 * * *` (09:00 UTC, roughly 1am Pacific).
- Handler guards on `GOOGLE_DIRECTORY_SYNC_ENABLED` and exits early when disabled.
- Walks all users in small batches (concurrency ~5). For each user: call
  `syncGoogleDirectory(userId, email)` (the existing 1-hour throttle is harmless here),
  then `applyDirectoryMappings(userId)`.
- Per-user errors are caught, logged, and skipped. One bad user never aborts the sweep.
- Ends with a summary log: users processed, memberships granted, errors.
- Scale check: 285 users at 2 Admin SDK calls each nightly is far below API quotas.

The login path also gains the apply step: `handle-oauth-callback-url.ts` chains
`applyDirectoryMappings` after `syncGoogleDirectory` in the existing fire-and-forget calls,
so a new user gets team access at first sign-in instead of the next night.

### 4. Admin page

`/admin/directory-mappings`, mirroring the Claims page file-for-file:

- Route: `apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`, plus a nav
  entry in `admin+/_layout.tsx`. The layout loader already enforces system `Role.ADMIN`.
- Components: table + create/update/delete dialogs under
  `apps/remix/app/components/tables/` and `.../dialogs/`, copied from the
  `admin-claims-table` and claim dialog patterns.
- TRPC: namespace `admin.directoryMappings.{find, create, update, delete}` in
  `packages/trpc/server/admin-router/`, one file per op plus `.types.ts`, all on
  `adminProcedure` (guard is centralized, no new auth code).
- Every mutation writes its `DirectorySyncAuditLog` row inside the same `$transaction`.
- The group picker lists the PSD401 org's `OrganisationGroup`s showing name, type, and the
  teams each grants via `TeamGroup`, so the admin sees exactly what access a rule grants.
- Rules have both an `active` toggle (pause without losing the rule) and delete (audited).
- The find view shows sourceField, sourceValue, target group with linked teams, active,
  and updatedAt.

An audit viewer is not in scope for this iteration. Audit rows are queryable via psql,
and a viewer route can be added later without schema changes.

### 5. Rollout

Dev first, then prod, per the standing deployment rule.

1. Dev (sync already enabled): run the migration, create a test rule via the admin page,
   trigger the sweep, verify grants and audit rows via psql, verify login-path apply with
   the Playwright test user.
2. Build and push the image to GHCR.
3. Prod enablement: scp the service account key file to the EC2 host (the key never passes
   through chat), add `GOOGLE_DIRECTORY_SYNC_ENABLED`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`,
   and `GOOGLE_DIRECTORY_ADMIN_EMAIL` to the compose env, update the pinned digest, pull
   and restart.
4. Verify on prod: first nightly sweep populates directory columns for all 285 users, then
   grants flow from whatever rules exist.
5. Seed real mapping rules via the admin page. Which rules to seed is an open data
   question (per-building CUSTOM groups exist for SpEd-style teams) and does not block
   shipping.

### 6. Testing (TDD)

Unit tests (vitest, existing unit project):

- Matching semantics per source field, including case-insensitivity for GROUP and prefix
  boundaries for ORG_UNIT.
- Additive-only invariant: no code path issues a delete or update against membership rows.
- Member-row pinning with multiple `OrganisationMember` rows.
- Idempotent re-run produces zero inserts and zero audit rows.
- Audit rows written per grant and per rule mutation, inside the mutation transaction.
- Sweep error isolation: one failing user does not abort the batch.
- Disabled feature flag short-circuits sweep and apply.

Route-level tests for TRPC validation. Existing 20 Phase 1 tests stay untouched. Playwright
E2E for the admin page is optional and not a ship gate.

## Non-goals

- Removing or reconciling memberships (authoritative sync). Rejected as destructive.
- Pre-creating accounts for staff who have never logged in.
- WIF/keyless service account auth. Hardening follow-up, JSON key file stays for now.
- Audit log viewer UI.

## Open questions

- Initial mapping rule set: which departments, org units, and Google groups map to which
  `OrganisationGroup`s. Data entry after ship, decided by Reese in the admin page.
