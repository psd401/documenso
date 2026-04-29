# Team Merge Feature — Design Spec

## Overview

Org admins can merge multiple teams into one destination team (existing or new) from the Teams settings page. All documents, templates, folders, and members move to the destination. Source teams are permanently deleted. Webhooks, API tokens, and team settings from source teams are discarded.

## UI Flow

### Teams Settings Page (`/o/{orgUrl}/settings/teams`)

Add a checkbox column to `OrganisationTeamsTable`. When 2+ teams are selected, a "Merge Teams" button appears above the table.

### TeamMergeDialog

Opens when the merge button is clicked.

**Destination picker:** Dropdown listing all org teams NOT in the source selection, plus a "Create new team" option. Selecting "Create new team" shows inline name and URL inputs.

**Impact summary:** Fetched from server via `team.mergePreview` after sources are selected. Two sections:

Moving:
- X documents
- Y templates
- Z members (added as Member role)
- W folders

Discarding:
- A webhooks
- B API tokens
- C team email configurations
- D team settings profiles

**Warning banner** (destructive variant): "This action cannot be undone. All documents, templates, and folders from the selected teams will be moved to the destination team. Source team webhooks, API tokens, email configurations, and settings will be permanently deleted. Source teams will be removed."

**Confirmation input:** User must type the destination team name to confirm.

**Action button:** "Merge Teams" (destructive variant), disabled until confirmation text matches.

## Backend

### TRPC Routes

Two new procedures on the existing team router (`packages/trpc/server/team-router/router.ts`):

**`team.mergePreview`** (GET)
- Input: `{ organisationId, sourceTeamIds, destinationTeamId? }`
- Output: counts of documents, templates, folders, members, webhooks, API tokens, team emails, team settings that will be moved or discarded
- Permission: `MANAGE_ORGANISATION`
- Read-only — no mutations

**`team.merge`** (POST)
- Input: `{ organisationId, sourceTeamIds, destinationTeamId?, newTeamName?, newTeamUrl? }`
- `destinationTeamId` is required when merging into an existing team
- `newTeamName` and `newTeamUrl` are required when creating a new destination
- Permission: `MANAGE_ORGANISATION`
- Returns: summary of what was moved and discarded

### Server Function

New file: `packages/lib/server-only/team/merge-teams.ts`

Single Prisma `$transaction`:

1. Validate all source teams and destination belong to the same org
2. If destination is among the source teams, exclude it from deletion (merge the others into it)
3. If creating a new team, create it first within the transaction
4. Fetch pre-merge counts for the return value
5. `UPDATE "Envelope" SET "teamId" = dest WHERE "teamId" IN (sources)`
6. `UPDATE "Folder" SET "teamId" = dest WHERE "teamId" IN (sources)`
7. Consolidate members: team membership is via `TeamGroup` records (linking `OrganisationGroup` to `Team` with a `TeamMemberRole`). For each source team's `TeamGroup`, if the linked `OrganisationGroup` is not already on the destination team, create a new `TeamGroup` with role MEMBER (least privilege). Skip groups already linked to the destination team (preserving their existing role).
8. Delete source teams — Prisma cascade handles: TeamProfile, Webhook, ApiToken, TeamGroup, TeamEmail, TeamEmailVerification, TeamGlobalSettings
9. Return counts of moved and discarded items

### Preview Function

New file or co-located: `packages/lib/server-only/team/merge-teams-preview.ts`

Runs the same count queries without mutating. Returns the impact summary object.

## Data Model

Tables affected during merge (8 tables reference `teamId`):

| Table | Merge behavior |
|---|---|
| Envelope | Reparent to destination |
| Folder | Reparent to destination |
| TeamGroup | Consolidate into destination — new TeamGroup records with MEMBER role for groups not already linked |
| TeamProfile | Discarded (cascade delete with source team) |
| Webhook | Discarded (cascade delete) |
| ApiToken | Discarded (cascade delete) |
| TeamEmail | Discarded (cascade delete) |
| TeamEmailVerification | Discarded (cascade delete) |
| TeamGlobalSettings | Discarded (source team's settings deleted, destination keeps its own) |

## Permissions

- Requires `MANAGE_ORGANISATION` role on the organisation
- Uses `buildOrganisationWhereQuery` pattern consistent with `createTeam` and `deleteTeam`

## Edge Cases

- **Destination is one of the selected teams:** Valid. That team absorbs the others and is excluded from deletion.
- **Active signing sessions (PENDING envelopes):** Unaffected. Signing tokens resolve by recipient ID, not team ID.
- **Folder name collisions:** Both folders keep their names. Folders are identified by ID, not name uniqueness.
- **Empty source teams:** Allowed. Impact summary shows 0 counts. Source team is deleted.
- **Transaction failure:** Full rollback. No partial merges.
- **Concurrent merges on same teams:** Transaction row locks prevent conflicts. Second merge fails cleanly.
- **Member role conflicts:** All merged members get MEMBER role regardless of their role on the source team (least privilege). If user is already on destination team, their existing role is preserved — no downgrade.

## Files to Create/Modify

| File | Action |
|---|---|
| `packages/lib/server-only/team/merge-teams.ts` | New — merge transaction logic |
| `packages/lib/server-only/team/merge-teams-preview.ts` | New — count queries for preview |
| `packages/trpc/server/team-router/merge-teams.ts` | New — TRPC route |
| `packages/trpc/server/team-router/merge-teams.types.ts` | New — request/response schemas |
| `packages/trpc/server/team-router/merge-teams-preview.ts` | New — TRPC preview route |
| `packages/trpc/server/team-router/merge-teams-preview.types.ts` | New — preview schemas |
| `packages/trpc/server/team-router/router.ts` | Modify — register merge and mergePreview procedures |
| `apps/remix/app/components/dialogs/team-merge-dialog.tsx` | New — merge dialog component |
| `apps/remix/app/routes/_authenticated+/o.$orgUrl.settings.teams.tsx` | Modify — add checkboxes and merge button |
