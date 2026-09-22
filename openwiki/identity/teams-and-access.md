---
type: Reference
title: Teams, Groups, and Document/Folder Access Control
description: >
  Organisation/team/group model, document visibility semantics, folder
  access control, and the isAdmin vs. org-role distinction.
tags: [identity, teams, groups, visibility, access-control]
---

# Teams, groups, and access control

## Organisation / team / group model

Schema: [`packages/prisma/schema.prisma`](../../packages/prisma/schema.prisma).

- `Organisation` — top-level tenant (PSD401 has one: `org_psd401district`).
  Has many `Team`s, `OrganisationMember`s, `OrganisationGroup`s.
- `OrganisationMember` — join of `User` + `Organisation`, unique per pair.
- `OrganisationGroup` — a named group scoped to an org, typed by
  `OrganisationGroupType`: `INTERNAL_ORGANISATION`, `INTERNAL_TEAM`
  (auto-created default groups — e.g. a team's built-in member/admin
  groups), or `CUSTOM` (admin-created, e.g. per-building groups). Has an
  `organisationRole: OrganisationMemberRole`.
- `OrganisationGroupMember` — join of `OrganisationGroup` +
  `OrganisationMember`, unique per pair. This is the row Google Directory
  Sync's apply engine inserts (see
  [sso-and-provisioning.md](sso-and-provisioning.md)).
- `TeamGroup` — links an `OrganisationGroup` to a `Team` with a
  `teamRole: TeamMemberRole`, unique per `(teamId, organisationGroupId)`.
  This is the only path from org-group membership to team access — see
  the directory-mapping note in
  [sso-and-provisioning.md](sso-and-provisioning.md#what-a-mapping-actually-grants--correcting-a-common-shorthand).

Not every team has just the standard three `INTERNAL_TEAM` groups. A
multi-site team can have one `CUSTOM` group per building instead (e.g.
Special Education, team 117, has ~19 per-building `CUSTOM` groups plus an
admin group) — "add a user to team X" is often really "pick the right
building/site group for that team."

## Document visibility

`DocumentVisibility` enum (`EVERYONE | MANAGER_AND_ABOVE | ADMIN`) is set
per-team (`TeamGlobalSettings.documentVisibility`) and per-envelope
(`Envelope.visibility`, default `EVERYONE`). The role → visible-tiers
mapping,
[`TEAM_DOCUMENT_VISIBILITY_MAP`](../../packages/lib/constants/teams.ts)
(`packages/lib/constants/teams.ts`):

```
ADMIN:   [ADMIN, MANAGER_AND_ABOVE, EVERYONE]
MANAGER: [MANAGER_AND_ABOVE, EVERYONE]
MEMBER:  [EVERYONE]
```

**Whether a recipient always sees their own document depends on which
query path is used — this is not a blanket guarantee.** The lower-level
[`packages/lib/server-only/envelope/find-envelopes.ts`](../../packages/lib/server-only/envelope/find-envelopes.ts)
(used by the API and other internal callers) says so directly in its own
docstring: unlike the UI query, being a recipient does **not** override
visibility there — a user only sees an envelope if its visibility is
within their role's threshold *or they are the owner* (`userId` match).
The UI-facing [`packages/lib/server-only/document/find-documents.ts`](../../packages/lib/server-only/document/find-documents.ts)
does add a separate recipient-email-match branch, which is where "you
always see documents you're a recipient on" actually holds. When
reasoning about a visibility bug, check which of these two functions the
code path in question actually calls.

## Folder access control

`Folder` (schema.prisma) carries `visibility: DocumentVisibility`,
`allowedUserIds Int[]`, `allowedGroupIds String[]`, all in addition to the
team-role visibility above. [`packages/lib/utils/folder-access.ts`](../../packages/lib/utils/folder-access.ts)'s
`buildFolderAccessFilter(userId, teamRole, userGroupIds)`:

- **Team `ADMIN`s bypass the allow-lists entirely** — they get a plain
  visibility-tier filter with no allow-list check.
- Everyone else sees a folder if: it has no allow-lists set and its
  visibility is within their role's tier, **or** they're on
  `allowedUserIds`, **or** they own the folder, **or** they're in a group
  on `allowedGroupIds`.

This filter is wired into `find-folders`, `find-folders-internal`,
`get-folder-by-id`, `get-folder-breadcrumbs`, `update-folder`, and
`delete-folder` under
[`packages/lib/server-only/folder/`](../../packages/lib/server-only/folder) —
i.e. it governs **folder** listing and lookup.

**Confirmed gap: folder ACLs are not enforced on the documents inside a
folder.** `find-envelopes.ts` filters strictly by
`Envelope.folderId = <id>` plus `Envelope.visibility` — it never checks
`Folder.allowedUserIds`/`allowedGroupIds`. `find-documents.ts` (the UI
path) shows the same absence. In practice: a user with team-level
visibility access can see envelopes filed into a folder they are not on
the allow-list for, as long as the `folderId` is known/matched — the
allow-list only gates browsing to the folder itself, not the documents
it contains once you know (or guess) the folder ID or otherwise reach an
envelope's folderId. This matches the `reference_known_issues` memory
note and is unresolved as of this writing.

## `isAdmin` vs. organisation role

Two structurally different checks — don't confuse them:

- [`packages/lib/utils/is-admin.ts`](../../packages/lib/utils/is-admin.ts):
  `isAdmin(user) = user.roles.includes(Role.ADMIN)` — checks the
  **system-level** `User.roles` array (the global `Role` Prisma enum).
  This is the Documenso-wide "is this a platform admin" check, unrelated
  to any organisation.
- [`packages/lib/utils/organisations.ts`](../../packages/lib/utils/organisations.ts):
  `canExecuteOrganisationAction(action, role)` takes an **org-scoped**
  `OrganisationMemberRole` and checks it against a permissions map — this
  is "does this org role allow this org-level action" (e.g.
  `MANAGE_ORGANISATION`), independent of system-level admin status.

## Organisation creation guard

Restricted at the tRPC route layer, not the underlying library function:
[`packages/trpc/server/organisation-router/create-organisation.ts`](../../packages/trpc/server/organisation-router/create-organisation.ts)
throws `UNAUTHORIZED` unless the caller has system-level `Role.ADMIN`,
when billing is disabled (the active path in this fork — see
[fork/changes.md](../fork/changes.md)). The underlying
`createOrganisation()`/`createPersonalOrganisation()` functions in
[`packages/lib/server-only/organisation/create-organisation.ts`](../../packages/lib/server-only/organisation/create-organisation.ts)
have no guard of their own — any other server-only code calling them
directly would bypass the restriction. Don't remove the route-level guard,
and don't assume it protects a new call site added at the lib layer.
