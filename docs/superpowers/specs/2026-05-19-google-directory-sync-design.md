# Google Directory Sync — Phase 1 Design Spec

## Summary

Pull Google Workspace directory data (department, title, org unit, group memberships) on every SSO login and store it on the User record. Phase 1 is data collection only — no mapping rules or auto-team-assignment.

## Motivation

PSD401 needs department, title, and group membership data from Google Workspace to drive permission assignment in Documenso. Google SSO currently captures only email, name, and subject ID. This phase gets the data flowing so phase 2 can build config-based mapping rules on top.

## Prerequisites

- GCP service account with domain-wide delegation enabled
- Scopes granted in Google Admin console: `https://www.googleapis.com/auth/admin.directory.user.readonly`, `https://www.googleapis.com/auth/admin.directory.group.readonly`
- Service account impersonates a limited admin account (not super admin), per [Google's DWD best practices](https://support.google.com/a/answer/14437356)
- PSD401 Google Workspace has department, title, and orgUnitPath populated for users

## Schema Changes

Five new nullable columns on the `User` model:

| Field | Type | Example |
|---|---|---|
| `department` | `String?` | `"Technology"` |
| `title` | `String?` | `"Network Administrator"` |
| `orgUnitPath` | `String?` | `"/Staff/Technology"` |
| `googleGroups` | `Json?` | `["tech-staff@psd401.net", "all-staff@psd401.net"]` |
| `directoryLastSyncedAt` | `DateTime?` | `2026-05-19T14:30:00Z` |

All nullable — existing users unaffected. `googleGroups` validated at read time with `z.array(z.string())`.

Prisma migration adds these columns with no default values and no `NOT NULL` constraints.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Yes* | Service account JSON key as a string |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Yes* | Alternative: path to JSON key file |
| `GOOGLE_DIRECTORY_ADMIN_EMAIL` | Yes | Admin email to impersonate for Directory API calls |
| `GOOGLE_DIRECTORY_SYNC_ENABLED` | No | `true`/`false`, defaults to `false` |

*One of the two key variables required. Feature does nothing when `GOOGLE_DIRECTORY_SYNC_ENABLED` is not `true`.

## Architecture

### New module: `packages/lib/server-only/google/directory-client.ts`

Authenticates using the service account JSON key and impersonates the admin email. Uses the `googleapis` npm package (`google.admin('directory_v1')`).

Exports:

- `getDirectoryUser(email: string)` — calls `admin.users.get({ userKey: email })`, returns `{ department: string | null, title: string | null, orgUnitPath: string | null }` or null on failure.
- `getDirectoryGroups(email: string)` — calls `admin.groups.list({ userKey: email })`, returns `string[]` of group email addresses or empty array on failure.

Both functions catch errors internally and return null/empty rather than throwing. The caller logs and proceeds.

### New function: `packages/lib/server-only/user/sync-google-directory.ts`

`syncGoogleDirectory(userId: number, email: string): Promise<void>`

1. Queries `directoryLastSyncedAt` for the user. If synced within the last hour, returns early.
2. Calls `getDirectoryUser(email)` and `getDirectoryGroups(email)`.
3. If either call succeeds, updates the User record with the fetched fields and sets `directoryLastSyncedAt` to now.
4. If both calls fail, logs a warning and returns without updating. Login proceeds normally.

### Hook location: `packages/auth/server/lib/utils/handle-oauth-callback-url.ts`

The OAuth callback has three paths:

- **Path A** (existing OAuth account, line ~42): existing user logs in directly
- **Path B** (existing email user links OAuth, line ~63): OAuth account created, existing user logs in
- **Path C** (new user, line ~139): user + account created, `onCreateUserHook` called

`syncGoogleDirectory(userId, email)` is called in all three paths, before `onAuthorize()`. This runs on every Google SSO login regardless of whether the user is new.

The call is awaited but wrapped in a try/catch at the call site. A failed directory sync logs a warning and proceeds to `onAuthorize()` without interrupting authentication.

### Feature gate

The sync function checks `GOOGLE_DIRECTORY_SYNC_ENABLED === 'true'` before doing anything. When disabled (the default), the function returns immediately. Safe to deploy without configuring the service account.

## Testing

- **Unit tests** for `syncGoogleDirectory`: mock the Google API client. Verify correct fields written to User. Verify skip when `directoryLastSyncedAt` is within one hour. Verify no throw on API failure.
- **Unit tests** for `directory-client.ts`: mock `googleapis`. Verify auth setup. Verify null/empty returns on errors.
- **Integration tests**: `describe.skipIf` when service account env vars aren't set (same pattern as LibreOffice/qpdf binary tests).
- **Manual verification**: deploy to dev (10.0.70.60), sign in with a PSD401 Google account, query the DB to confirm populated fields.

## Not in Scope (Phase 1)

- Mapping rules or auto-team-assignment (phase 2)
- Admin UI for viewing or managing directory data
- Periodic background sync
- SCIM or Google push notifications
- Changes to the existing `onCreateUserHook`

## Phase 2 Preview

Phase 2 adds a `DirectoryMapping` DB table with config-based rules (e.g., `department = "Technology"` maps to Team X). An admin UI under org settings manages the mappings. The sync function is extended to evaluate mapping rules after updating directory fields. Initially additive only (adds memberships, never removes), with authoritative sync as a later option.
