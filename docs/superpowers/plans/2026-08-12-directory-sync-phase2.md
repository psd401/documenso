# Directory Sync Phase 2: Group Mapping + Prod Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map synced Google directory data (department, org unit, groups) to Documenso group memberships through admin-managed rules, applied at login and by a nightly sweep, then enable the Phase 1 sync on prod.

**Architecture:** A pure matching module scores each active `DirectoryGroupMapping` rule against a user's synced columns. An additive-only apply engine inserts missing `OrganisationGroupMember` rows for matched rules and writes an audit trail. The apply engine runs after every Google OAuth login (chained onto the existing sync call) and from a new nightly cron sweep. An admin CRUD page manages the rules. TDD throughout.

**Tech Stack:** Prisma (schema migration), vitest (unit tests), TRPC (admin routes), React Hook Form + Zod (admin UI)

**Spec:** `docs/superpowers/specs/2026-08-12-directory-sync-phase2-design.md`

## Global Constraints

- **Additive-only invariant.** No code path in this feature issues a `delete` or `update` against `OrganisationGroupMember`, `OrganisationMember`, or `TeamGroup` rows. The apply engine only inserts. Verify this in code review for every task that touches those models.
- **Feature gate.** All new sync behavior (apply engine, sweep) is gated behind `env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true'`, matching the Phase 1 gate on `syncGoogleDirectory`.
- **PSD401 org id.** `'org_psd401district'`, exported once from `packages/lib/constants/psd401.ts`. `create-user.ts`'s local copy of this string is left unchanged.
- Use `bun` not `npm` for any local package installs.
- Do not run `npm run build` to verify changes. Use `npx -p typescript tsc --noEmit` for type checking.
- TDD is mandatory for every lib module in this plan: failing test first, minimal implementation, then verify green, then commit. The two exceptions (OAuth callback wiring, admin UI components) are called out explicitly in their tasks with the reason no unit test applies.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|-----------------|
| Modify | `packages/prisma/schema.prisma` | New enum, two new models, back-relation on `OrganisationGroup` |
| Create | `packages/prisma/migrations/<timestamp>_add_directory_group_mapping/migration.sql` | Migration SQL |
| Modify | `packages/lib/universal/id.ts` | Add `'directory_mapping'` id prefix |
| Create | `packages/lib/constants/psd401.ts` | Shared `PSD401_ORG_ID` constant |
| Create | `packages/lib/types/directory-sync-audit-logs.ts` | Audit log `type` enum + inferred type |
| Create | `packages/lib/server-only/directory-sync/mapping-matching.ts` | Pure matching helpers |
| Create | `packages/lib/server-only/directory-sync/apply-directory-mappings.ts` | Additive-only apply engine |
| Modify | `packages/lib/server-only/user/sync-google-directory.ts` | Return a status instead of `void` |
| Modify | `packages/auth/server/lib/utils/handle-oauth-callback-url.ts` | Chain `applyDirectoryMappings` after sync at all 3 OAuth sites |
| Create | `packages/lib/jobs/definitions/internal/directory-sync-sweep.ts` | Sweep job definition |
| Create | `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts` | Sweep handler |
| Modify | `packages/lib/jobs/client.ts` | Register the sweep job |
| Create | `packages/lib/server-only/directory-sync/{create,update,delete,find}-directory-mapping(s).ts` | Mapping CRUD + find business logic |
| Create | `packages/lib/server-only/directory-sync/find-directory-mapping-groups.ts` | Group picker data source |
| Create | `packages/trpc/server/admin-router/{find,create,update,delete}-directory-mapping(s).ts(.types.ts)` | TRPC admin routes |
| Create | `packages/trpc/server/admin-router/list-directory-mapping-groups.ts(.types.ts)` | TRPC group picker route |
| Modify | `packages/trpc/server/admin-router/router.ts` | Wire `admin.directoryMappings.*` namespace |
| Create | `apps/remix/app/components/forms/directory-mapping-form.tsx` | Shared create/update form |
| Create | `apps/remix/app/components/dialogs/directory-mapping-{create,update,delete}-dialog.tsx` | Admin dialogs |
| Create | `apps/remix/app/components/tables/admin-directory-mappings-table.tsx` | Admin table |
| Create | `apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx` | Admin route |
| Modify | `apps/remix/app/routes/_authenticated+/admin+/_layout.tsx` | Nav entry |

---

### Task 1: Schema, Migration, Id Prefix, Shared Constant, Audit Log Types

Small, foundational pieces bundled into one task: none of them has independent test coverage of its own, and every later task depends on at least one of them. Splitting them would create review checkpoints with nothing to review.

**Files:**
- Modify: `packages/prisma/schema.prisma`
- Create: `packages/prisma/migrations/<timestamp>_add_directory_group_mapping/migration.sql`
- Modify: `packages/lib/universal/id.ts:17-33`
- Create: `packages/lib/constants/psd401.ts`
- Create: `packages/lib/types/directory-sync-audit-logs.ts`

**Interfaces:**
- Produces: `DirectoryMappingSourceField` enum (`GROUP | DEPARTMENT | ORG_UNIT`), `DirectoryGroupMapping` and `DirectorySyncAuditLog` Prisma models, `generateDatabaseId('directory_mapping')`, `PSD401_ORG_ID` constant, `ZDirectorySyncAuditLogTypeSchema` / `TDirectorySyncAuditLogType`.

- [ ] **Step 1: Add the enum and models to schema.prisma**

Add this enum near the other enums (after `OrganisationGroupType` at line 832):

```prisma
enum DirectoryMappingSourceField {
  GROUP
  DEPARTMENT
  ORG_UNIT
}
```

Add these two models after `TeamGroup` (after line 826):

```prisma
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

- [ ] **Step 2: Add the back-relation on OrganisationGroup**

In the `OrganisationGroup` model (`packages/prisma/schema.prisma:781-796`), add a line after `teamGroups TeamGroup[]`:

```prisma
  directoryGroupMappings DirectoryGroupMapping[]
```

This is metadata-only. Prisma requires it for the FK on the other side; it generates no migration SQL.

- [ ] **Step 3: Generate the migration**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx prisma migrate dev --name add_directory_group_mapping --create-only
```

Expected: a new migration directory under `packages/prisma/migrations/`. If schema resolution fails, retry with `--schema packages/prisma/schema.prisma`.

- [ ] **Step 4: Verify the migration SQL**

Read the generated `migration.sql` and confirm it matches this shape (exact identifier order may differ slightly, that's fine):

```sql
-- CreateEnum
CREATE TYPE "DirectoryMappingSourceField" AS ENUM ('GROUP', 'DEPARTMENT', 'ORG_UNIT');

-- CreateTable
CREATE TABLE "DirectoryGroupMapping" (
    "id" TEXT NOT NULL,
    "sourceField" "DirectoryMappingSourceField" NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "organisationGroupId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryGroupMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorySyncAuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "userId" INTEGER,
    "name" TEXT,
    "email" TEXT,

    CONSTRAINT "DirectorySyncAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryGroupMapping_sourceField_sourceValue_organisationGroupId_key" ON "DirectoryGroupMapping"("sourceField", "sourceValue", "organisationGroupId");

-- CreateIndex
CREATE INDEX "DirectorySyncAuditLog_createdAt_idx" ON "DirectorySyncAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "DirectorySyncAuditLog_type_idx" ON "DirectorySyncAuditLog"("type");

-- AddForeignKey
ALTER TABLE "DirectoryGroupMapping" ADD CONSTRAINT "DirectoryGroupMapping_organisationGroupId_fkey" FOREIGN KEY ("organisationGroupId") REFERENCES "OrganisationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Confirm: no `ALTER TABLE` against any existing table, both new tables only add columns, `DirectoryGroupMapping.id` has no `DEFAULT` (app-generated), `DirectorySyncAuditLog.id` has no `DEFAULT` shown here because Prisma applies `cuid()` at the client layer, not in SQL.

- [ ] **Step 5: Add the id prefix**

In `packages/lib/universal/id.ts:17-33`, add `'directory_mapping'` to the `DatabaseIdPrefix` union, after `'team_setting'`:

```typescript
type DatabaseIdPrefix =
  | 'document'
  | 'template'
  | 'envelope'
  | 'envelope_item'
  | 'email_domain'
  | 'org'
  | 'org_email'
  | 'org_claim'
  | 'org_group'
  | 'org_sso'
  | 'org_setting'
  | 'member'
  | 'member_invite'
  | 'group_member'
  | 'team_group'
  | 'team_setting'
  | 'directory_mapping';
```

- [ ] **Step 6: Create the shared PSD401 org id constant**

Create `packages/lib/constants/psd401.ts`:

```typescript
// ABOUTME: Shared PSD401 organisation identifier used by directory sync code.
// ABOUTME: Mirrors the local constant in create-user.ts, which is left unchanged.

export const PSD401_ORG_ID = 'org_psd401district';
```

- [ ] **Step 7: Create the audit log type schema**

Create `packages/lib/types/directory-sync-audit-logs.ts`:

```typescript
// ABOUTME: Zod schema and inferred type for the `type` column of DirectorySyncAuditLog.
// ABOUTME: Rule mutations use the MAPPING_* values; the apply engine uses MEMBERSHIP_GRANTED.

import { z } from 'zod';

export const ZDirectorySyncAuditLogTypeSchema = z.enum([
  'MAPPING_CREATED',
  'MAPPING_UPDATED',
  'MAPPING_DELETED',
  'MEMBERSHIP_GRANTED',
]);

export type TDirectorySyncAuditLogType = z.infer<typeof ZDirectorySyncAuditLogTypeSchema>;
```

- [ ] **Step 8: Generate the Prisma client and type check**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx prisma generate --schema packages/prisma/schema.prisma
```

Expected: clean exit. `@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema` and `DirectorySyncAuditLogSchema` now exist.

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/prisma/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/prisma/schema.prisma packages/prisma/migrations/ packages/lib/universal/id.ts packages/lib/constants/psd401.ts packages/lib/types/directory-sync-audit-logs.ts
git commit -m "feat: add directory group mapping schema, id prefix, and audit log types

New DirectoryGroupMapping and DirectorySyncAuditLog models, additive
back-relation on OrganisationGroup, directory_mapping id prefix, the
shared PSD401_ORG_ID constant, and the audit log type enum."
```

---

### Task 2: Pure Matching Helpers

**Files:**
- Create: `packages/lib/server-only/directory-sync/mapping-matching.ts`
- Test: `packages/lib/server-only/directory-sync/mapping-matching.test.ts`

**Interfaces:**
- Consumes: `DirectoryMappingSourceField` from `@prisma/client` (Task 1).
- Produces: `normalizeOrgUnitPath(value: string): string`, `normalizeMappingSourceValue(sourceField: DirectoryMappingSourceField, value: string): string`, `matchDirectoryMapping(mapping: { sourceField: DirectoryMappingSourceField; sourceValue: string }, user: { department: string | null; orgUnitPath: string | null; googleGroups: unknown }): boolean`. Consumed by Task 3 (apply engine) and Task 7 (create/update mutations).

- [ ] **Step 1: Write the failing tests**

```typescript
// ABOUTME: Unit tests for directory mapping matching semantics.
// ABOUTME: Covers normalization, GROUP case-insensitivity, malformed googleGroups shapes, and ORG_UNIT segment boundaries.

import { describe, expect, it } from 'vitest';

import {
  matchDirectoryMapping,
  normalizeMappingSourceValue,
  normalizeOrgUnitPath,
} from './mapping-matching';

describe('normalizeOrgUnitPath', () => {
  it('strips a single trailing slash', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH/')).toBe('/Staff/GHH');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH///')).toBe('/Staff/GHH');
  });

  it('leaves a path with no trailing slash unchanged', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH')).toBe('/Staff/GHH');
  });

  it('maps root "/" to "/"', () => {
    expect(normalizeOrgUnitPath('/')).toBe('/');
  });

  it('maps an empty string to "/"', () => {
    expect(normalizeOrgUnitPath('')).toBe('/');
  });
});

describe('normalizeMappingSourceValue', () => {
  it('trims and lowercases GROUP values', () => {
    expect(normalizeMappingSourceValue('GROUP', '  Tech-Staff@PSD401.net  ')).toBe(
      'tech-staff@psd401.net',
    );
  });

  it('trims but preserves case for DEPARTMENT values', () => {
    expect(normalizeMappingSourceValue('DEPARTMENT', '  Technology  ')).toBe('Technology');
  });

  it('trims but preserves case for ORG_UNIT values', () => {
    expect(normalizeMappingSourceValue('ORG_UNIT', '  /Staff/GHH  ')).toBe('/Staff/GHH');
  });
});

describe('matchDirectoryMapping', () => {
  describe('GROUP', () => {
    it('matches case-insensitively', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = {
        department: null,
        orgUnitPath: null,
        googleGroups: ['Tech-Staff@PSD401.net'],
      };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match when the group is absent', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: ['all-staff@psd401.net'] };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('treats null googleGroups as no match, with no error', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('treats a non-array googleGroups as no match, with no error', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: { not: 'an array' } };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('filters out non-string entries in a mixed-type array', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = {
        department: null,
        orgUnitPath: null,
        googleGroups: [42, { email: 'tech-staff@psd401.net' }, 'tech-staff@psd401.net'],
      };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });
  });

  describe('DEPARTMENT', () => {
    it('matches on an exact, case-sensitive string', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: 'Technology', orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match a different case', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: 'technology', orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('does not match when the user has no department', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });
  });

  describe('ORG_UNIT', () => {
    it('matches an exact path', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('matches a child segment', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/Teachers', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match a sibling with a matching prefix string', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHHS', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('matches when the rule value has a trailing slash', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH/' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/Teachers', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('matches when the user path has a trailing slash', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('a root "/" rule matches every user with a non-null orgUnitPath', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/' };
      const user = { department: null, orgUnitPath: '/Staff/GHH', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match when the user has no orgUnitPath', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/mapping-matching.test.ts
```

Expected: FAIL (`./mapping-matching` module does not exist yet).

- [ ] **Step 3: Commit the test file**

```bash
git add packages/lib/server-only/directory-sync/mapping-matching.test.ts
git commit -m "test: add failing tests for directory mapping matching"
```

- [ ] **Step 4: Implement the matching helpers**

Create `packages/lib/server-only/directory-sync/mapping-matching.ts`:

```typescript
// ABOUTME: Pure matching helpers for directory mapping rules. No I/O, no Prisma.
// ABOUTME: normalizeMappingSourceValue is applied at write time; matchDirectoryMapping applies it again at match time.

import type { DirectoryMappingSourceField } from '@prisma/client';

export const normalizeOrgUnitPath = (value: string): string => {
  const trimmed = value.replace(/\/+$/, '');

  return trimmed === '' ? '/' : trimmed;
};

export const normalizeMappingSourceValue = (
  sourceField: DirectoryMappingSourceField,
  value: string,
): string => {
  const trimmed = value.trim();

  return sourceField === 'GROUP' ? trimmed.toLowerCase() : trimmed;
};

const getGoogleGroupEmails = (googleGroups: unknown): string[] => {
  if (!Array.isArray(googleGroups)) {
    return [];
  }

  return googleGroups.filter((entry): entry is string => typeof entry === 'string');
};

export const matchDirectoryMapping = (
  mapping: { sourceField: DirectoryMappingSourceField; sourceValue: string },
  user: { department: string | null; orgUnitPath: string | null; googleGroups: unknown },
): boolean => {
  if (mapping.sourceField === 'GROUP') {
    const ruleValue = normalizeMappingSourceValue('GROUP', mapping.sourceValue);

    return getGoogleGroupEmails(user.googleGroups).some(
      (email) => normalizeMappingSourceValue('GROUP', email) === ruleValue,
    );
  }

  if (mapping.sourceField === 'DEPARTMENT') {
    return user.department !== null && user.department === mapping.sourceValue;
  }

  if (user.orgUnitPath === null) {
    return false;
  }

  const ruleValue = normalizeOrgUnitPath(mapping.sourceValue);
  const userPath = normalizeOrgUnitPath(user.orgUnitPath);

  if (ruleValue === '/') {
    return true;
  }

  return userPath === ruleValue || userPath.startsWith(`${ruleValue}/`);
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/mapping-matching.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lib/server-only/directory-sync/mapping-matching.ts
git commit -m "feat: add directory mapping matching helpers"
```

---

### Task 3: Apply Engine

**Files:**
- Create: `packages/lib/server-only/directory-sync/apply-directory-mappings.ts`
- Test: `packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts`

**Interfaces:**
- Consumes: `matchDirectoryMapping` from Task 2. `PSD401_ORG_ID` from Task 1. `generateDatabaseId('group_member')` from `packages/lib/universal/id.ts` (existing prefix).
- Produces: `type ApplyDirectoryMappingsSource = 'login' | 'sweep'`, `type ApplyDirectoryMappingsResult = { granted: number }`, `applyDirectoryMappings(userId: number, source: ApplyDirectoryMappingsSource): Promise<ApplyDirectoryMappingsResult>`. Consumed by Task 5 (login chaining) and Task 6 (sweep handler).

- [ ] **Step 1: Write the failing tests**

```typescript
// ABOUTME: Unit tests for the additive-only directory mapping apply engine.
// ABOUTME: Covers the feature gate, idempotency, audit rows, missing member row, and the additive-only invariant.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUserFindUnique = vi.fn();
const mockMappingFindMany = vi.fn();
const mockMemberFindFirst = vi.fn();
const mockGroupMemberFindMany = vi.fn();
const mockCreateManyAndReturn = vi.fn();
const mockAuditLogCreateMany = vi.fn();
const mockGroupMemberUpdate = vi.fn();
const mockGroupMemberDelete = vi.fn();
const mockTransaction = vi.fn();
const mockEnv = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    directoryGroupMapping: { findMany: mockMappingFindMany },
    organisationMember: { findFirst: mockMemberFindFirst },
    organisationGroupMember: {
      findMany: mockGroupMemberFindMany,
      update: mockGroupMemberUpdate,
      delete: mockGroupMemberDelete,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../utils/env', () => ({
  env: mockEnv,
}));

describe('applyDirectoryMappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockEnv.mockReturnValue('true');

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        organisationGroupMember: {
          createManyAndReturn: mockCreateManyAndReturn,
          update: mockGroupMemberUpdate,
          delete: mockGroupMemberDelete,
        },
        directorySyncAuditLog: { createMany: mockAuditLogCreateMany },
      }),
    );
  });

  it('returns { granted: 0 } and does no work when the feature gate is disabled', async () => {
    mockEnv.mockReturnValue(undefined);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('returns { granted: 0 } and logs when the user has no PSD401 member row', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue(null);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('inserts only missing groups and writes one audit row per inserted row', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
      { id: 'directory_mapping_2', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_2' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([{ groupId: 'org_group_1' }]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_2', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 1 });
    expect(mockCreateManyAndReturn).toHaveBeenCalledWith({
      data: [{ id: expect.any(String), groupId: 'org_group_2', organisationMemberId: 'member_1' }],
      skipDuplicates: true,
    });
    expect(mockAuditLogCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          type: 'MEMBERSHIP_GRANTED',
          userId: 1,
          name: 'Jane Staff',
          email: 'jane@psd401.net',
          data: expect.objectContaining({
            targetUserId: 1,
            organisationMemberId: 'member_1',
            organisationGroupId: 'org_group_2',
            mappingIds: ['directory_mapping_2'],
          }),
        }),
      ],
    });
  });

  it('is idempotent: a second run with no new matches inserts nothing and writes no audit rows', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([{ groupId: 'org_group_1' }]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('writes zero audit rows when createManyAndReturn returns zero rows (raced out by skipDuplicates)', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    const result = await applyDirectoryMappings(1, 'login');

    expect(result).toEqual({ granted: 0 });
    expect(mockAuditLogCreateMany).not.toHaveBeenCalled();
  });

  it('uses a system actor (userId null, name "directory-sync") for source "sweep"', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_1', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    await applyDirectoryMappings(1, 'sweep');

    expect(mockAuditLogCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: null,
          name: 'directory-sync',
          email: null,
        }),
      ],
    });
  });

  it('never calls update or delete on organisationGroupMember', async () => {
    mockUserFindUnique.mockResolvedValue({
      name: 'Jane Staff',
      email: 'jane@psd401.net',
      department: 'Technology',
      orgUnitPath: '/Staff',
      googleGroups: [],
    });
    mockMappingFindMany.mockResolvedValue([
      { id: 'directory_mapping_1', sourceField: 'DEPARTMENT', sourceValue: 'Technology', organisationGroupId: 'org_group_1' },
    ]);
    mockMemberFindFirst.mockResolvedValue({ id: 'member_1' });
    mockGroupMemberFindMany.mockResolvedValue([]);
    mockCreateManyAndReturn.mockResolvedValue([
      { id: 'group_member_1', groupId: 'org_group_1', organisationMemberId: 'member_1' },
    ]);

    const { applyDirectoryMappings } = await import('./apply-directory-mappings');
    await applyDirectoryMappings(1, 'login');

    expect(mockGroupMemberUpdate).not.toHaveBeenCalled();
    expect(mockGroupMemberDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts
```

Expected: FAIL (`./apply-directory-mappings` module does not exist yet).

- [ ] **Step 3: Commit the test file**

```bash
git add packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts
git commit -m "test: add failing tests for the directory mapping apply engine"
```

- [ ] **Step 4: Implement the apply engine**

Create `packages/lib/server-only/directory-sync/apply-directory-mappings.ts`:

```typescript
// ABOUTME: Additive-only apply engine. Inserts missing OrganisationGroupMember rows for a
// ABOUTME: user's matched directory mapping rules. Throws on real errors; callers handle them.

import { prisma } from '@documenso/prisma';

import { PSD401_ORG_ID } from '../../constants/psd401';
import { generateDatabaseId } from '../../universal/id';
import { env } from '../../utils/env';
import { matchDirectoryMapping } from './mapping-matching';

export type ApplyDirectoryMappingsSource = 'login' | 'sweep';

export type ApplyDirectoryMappingsResult = {
  granted: number;
};

export const applyDirectoryMappings = async (
  userId: number,
  source: ApplyDirectoryMappingsSource,
): Promise<ApplyDirectoryMappingsResult> => {
  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    return { granted: 0 };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      department: true,
      orgUnitPath: true,
      googleGroups: true,
    },
  });

  if (!user) {
    console.warn(`[directory-sync] applyDirectoryMappings: user ${userId} not found`);
    return { granted: 0 };
  }

  const mappings = await prisma.directoryGroupMapping.findMany({
    where: { active: true },
  });

  const matchedMappingIdsByGroup = new Map<string, string[]>();

  for (const mapping of mappings) {
    const isMatch = matchDirectoryMapping(mapping, {
      department: user.department,
      orgUnitPath: user.orgUnitPath,
      googleGroups: user.googleGroups,
    });

    if (!isMatch) {
      continue;
    }

    const matchedIds = matchedMappingIdsByGroup.get(mapping.organisationGroupId) ?? [];
    matchedIds.push(mapping.id);
    matchedMappingIdsByGroup.set(mapping.organisationGroupId, matchedIds);
  }

  if (matchedMappingIdsByGroup.size === 0) {
    return { granted: 0 };
  }

  const member = await prisma.organisationMember.findFirst({
    where: { userId, organisationId: PSD401_ORG_ID },
    select: { id: true },
  });

  if (!member) {
    console.warn(`[directory-sync] applyDirectoryMappings: user ${userId} has no PSD401 member row`);
    return { granted: 0 };
  }

  const existingGroupMembers = await prisma.organisationGroupMember.findMany({
    where: { organisationMemberId: member.id },
    select: { groupId: true },
  });

  const existingGroupIds = new Set(existingGroupMembers.map((row) => row.groupId));

  const missingGroupIds = [...matchedMappingIdsByGroup.keys()].filter(
    (groupId) => !existingGroupIds.has(groupId),
  );

  if (missingGroupIds.length === 0) {
    return { granted: 0 };
  }

  const actor =
    source === 'login'
      ? { userId, name: user.name, email: user.email }
      : { userId: null, name: 'directory-sync', email: null };

  const granted = await prisma.$transaction(async (tx) => {
    const inserted = await tx.organisationGroupMember.createManyAndReturn({
      data: missingGroupIds.map((groupId) => ({
        id: generateDatabaseId('group_member'),
        groupId,
        organisationMemberId: member.id,
      })),
      skipDuplicates: true,
    });

    if (inserted.length > 0) {
      await tx.directorySyncAuditLog.createMany({
        data: inserted.map((row) => ({
          type: 'MEMBERSHIP_GRANTED',
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          data: {
            targetUserId: userId,
            organisationMemberId: member.id,
            organisationGroupId: row.groupId,
            mappingIds: matchedMappingIdsByGroup.get(row.groupId) ?? [],
          },
        })),
      });
    }

    return inserted.length;
  });

  return { granted };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lib/server-only/directory-sync/apply-directory-mappings.ts
git commit -m "feat: add additive-only directory mapping apply engine"
```

---

### Task 4: syncGoogleDirectory Return Status

**Files:**
- Modify: `packages/lib/server-only/user/sync-google-directory.ts`
- Modify: `packages/lib/server-only/user/sync-google-directory.test.ts`

**Interfaces:**
- Produces: `type SyncGoogleDirectoryStatus = 'synced' | 'throttled' | 'failed' | 'disabled'`, `syncGoogleDirectory(userId: number, email: string): Promise<SyncGoogleDirectoryStatus>` (was `Promise<void>`). Consumed by Task 6 (sweep handler counts sync failures separately from apply failures). The three OAuth callers in Task 5 ignore the resolved value.

- [ ] **Step 1: Update the existing error-path test to expect a status**

In `packages/lib/server-only/user/sync-google-directory.test.ts`, replace the last test:

```typescript
  it('catches error, logs warning, and does not throw when Prisma query throws', async () => {
    mockEnv.mockReturnValue('true');

    mockFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    await expect(syncGoogleDirectory(42, 'user@example.com')).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[directory-sync]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DB connection lost'));

    warnSpy.mockRestore();
  });
});
```

With:

```typescript
  it('returns "failed" and logs a warning when Prisma query throws', async () => {
    mockEnv.mockReturnValue('true');

    mockFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    await expect(syncGoogleDirectory(42, 'user@example.com')).resolves.toBe('failed');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[directory-sync]'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DB connection lost'));

    warnSpy.mockRestore();
  });

  it('returns "disabled" when the feature gate is off', async () => {
    mockEnv.mockReturnValue(undefined);

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    const status = await syncGoogleDirectory(1, 'user@example.com');

    expect(status).toBe('disabled');
  });

  it('returns "throttled" when synced within the last hour', async () => {
    mockEnv.mockReturnValue('true');

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    mockFindUnique.mockResolvedValue({ directoryLastSyncedAt: thirtyMinutesAgo });

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    const status = await syncGoogleDirectory(1, 'user@example.com');

    expect(status).toBe('throttled');
  });

  it('returns "synced" when the update succeeds', async () => {
    mockEnv.mockReturnValue('true');

    mockFindUnique.mockResolvedValue({ directoryLastSyncedAt: null });
    mockGetDirectoryUser.mockResolvedValue({
      department: 'IT',
      title: 'Engineer',
      orgUnitPath: '/Staff',
    });
    mockGetDirectoryGroups.mockResolvedValue(['group@example.com']);

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    const status = await syncGoogleDirectory(1, 'user@example.com');

    expect(status).toBe('synced');
  });

  it('returns "failed" when both API calls return null', async () => {
    mockEnv.mockReturnValue('true');

    mockFindUnique.mockResolvedValue({ directoryLastSyncedAt: null });
    mockGetDirectoryUser.mockResolvedValue(null);
    mockGetDirectoryGroups.mockResolvedValue(null);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { syncGoogleDirectory } = await import('./sync-google-directory');
    const status = await syncGoogleDirectory(42, 'user@example.com');

    expect(status).toBe('failed');

    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new assertions fail**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/user/sync-google-directory.test.ts
```

Expected: FAIL (the function still returns `undefined`).

- [ ] **Step 3: Commit the test changes**

```bash
git add packages/lib/server-only/user/sync-google-directory.test.ts
git commit -m "test: assert syncGoogleDirectory status returns"
```

- [ ] **Step 4: Change the implementation to return a status**

Replace the full contents of `packages/lib/server-only/user/sync-google-directory.ts`:

```typescript
// ABOUTME: Sync orchestrator that updates a user's directory fields from Google Workspace on every SSO login.
// ABOUTME: Throttled to once per hour; partial results are preserved — only fields from successful API calls are written.
import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';
import { getDirectoryGroups, getDirectoryUser } from '../google/directory-client';

const ONE_HOUR_MS = 60 * 60 * 1000;

export type SyncGoogleDirectoryStatus = 'synced' | 'throttled' | 'failed' | 'disabled';

export const syncGoogleDirectory = async (
  userId: number,
  email: string,
): Promise<SyncGoogleDirectoryStatus> => {
  try {
    if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
      return 'disabled';
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { directoryLastSyncedAt: true },
    });

    if (user?.directoryLastSyncedAt != null) {
      const elapsed = Date.now() - user.directoryLastSyncedAt.getTime();
      if (elapsed < ONE_HOUR_MS) {
        return 'throttled';
      }
    }

    const [directoryUser, directoryGroups] = await Promise.all([
      getDirectoryUser(email),
      getDirectoryGroups(email),
    ]);

    if (directoryUser === null && directoryGroups === null) {
      console.warn(`[directory-sync] Both API calls returned null for ${email}; skipping update`);
      return 'failed';
    }

    const data: Record<string, unknown> = {
      directoryLastSyncedAt: new Date(),
    };

    if (directoryUser !== null) {
      data.department = directoryUser.department;
      data.title = directoryUser.title;
      data.orgUnitPath = directoryUser.orgUnitPath;
    }

    if (directoryGroups !== null) {
      data.googleGroups = directoryGroups;
    }

    await prisma.user.update({
      where: { id: userId },
      data,
    });

    return 'synced';
  } catch (err) {
    console.warn(`[directory-sync] ${err instanceof Error ? err.message : 'Unknown error'}`);
    return 'failed';
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/user/sync-google-directory.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lib/server-only/user/sync-google-directory.ts
git commit -m "feat: return a status from syncGoogleDirectory instead of void

The sweep job needs to count sync failures separately from apply
failures. OAuth callers ignore the resolved value; behavior for them
is unchanged."
```

---

### Task 5: Login-Path Chaining

`handleOAuthCallbackUrl` has an existing test file, `handle-oauth-callback-url.test.ts`, that mocks `syncGoogleDirectory` and covers the new-user OAuth site. This task extends it with a mock for `applyDirectoryMappings` and adds assertions for the other two OAuth sites. TDD style: failing assertions first, then the chaining implementation.

**Files:**
- Modify: `packages/auth/server/lib/utils/handle-oauth-callback-url.ts`
- Modify: `packages/auth/server/lib/utils/handle-oauth-callback-url.test.ts`

**Interfaces:**
- Consumes: `applyDirectoryMappings` from Task 3, `syncGoogleDirectory` (unchanged call signature, new resolved type ignored) from Task 4.

- [ ] **Step 1: Write the failing test changes**

In `packages/auth/server/lib/utils/handle-oauth-callback-url.test.ts`, replace the mock declarations:

```typescript
const mockOnAuthorize = vi.fn();
const mockOnCreateUserHook = vi.fn();
const mockSyncGoogleDirectory = vi.fn();
const mockUserCreate = vi.fn();
const mockAccountCreate = vi.fn();

const mockPrisma = {
  account: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
    fn({
      user: { create: mockUserCreate },
      account: { create: mockAccountCreate },
    }),
  ),
};
```

With:

```typescript
const mockOnAuthorize = vi.fn();
const mockOnCreateUserHook = vi.fn();
const mockSyncGoogleDirectory = vi.fn();
const mockApplyDirectoryMappings = vi.fn();
const mockUserCreate = vi.fn();
const mockAccountCreate = vi.fn();
const mockUserSecurityAuditLogCreate = vi.fn();

const mockPrisma = {
  account: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
    fn({
      user: { create: mockUserCreate },
      account: { create: mockAccountCreate },
      userSecurityAuditLog: { create: mockUserSecurityAuditLogCreate },
    }),
  ),
};
```

Add a mock for the new module, after the existing `syncGoogleDirectory` mock:

```typescript
vi.mock('@documenso/lib/server-only/user/sync-google-directory', () => ({
  syncGoogleDirectory: mockSyncGoogleDirectory,
}));
```

With:

```typescript
vi.mock('@documenso/lib/server-only/user/sync-google-directory', () => ({
  syncGoogleDirectory: mockSyncGoogleDirectory,
}));

vi.mock('@documenso/lib/server-only/directory-sync/apply-directory-mappings', () => ({
  applyDirectoryMappings: mockApplyDirectoryMappings,
}));
```

In the `beforeEach` of the `'handleOAuthCallbackUrl new user provisioning'` describe block, replace:

```typescript
    mockOnAuthorize.mockResolvedValue(undefined);
    mockOnCreateUserHook.mockResolvedValue(undefined);
    mockSyncGoogleDirectory.mockResolvedValue(undefined);
  });
```

With:

```typescript
    mockOnAuthorize.mockResolvedValue(undefined);
    mockOnCreateUserHook.mockResolvedValue(undefined);
    mockSyncGoogleDirectory.mockResolvedValue(undefined);
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });
  });
```

In the `'still auto-provisions a new account...'` test, replace the closing assertions:

```typescript
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockOnCreateUserHook).toHaveBeenCalledTimes(1);
    expect(mockOnAuthorize).toHaveBeenCalledWith({ userId: 42 }, expect.anything());
  });
```

With:

```typescript
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockOnCreateUserHook).toHaveBeenCalledTimes(1);
    expect(mockOnAuthorize).toHaveBeenCalledWith({ userId: 42 }, expect.anything());

    await vi.waitFor(() => {
      expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(42, 'login');
    });
  });
```

At the end of the file, after the closing `});` of the `'handleOAuthCallbackUrl new user provisioning'` describe block, add a new describe block covering the other two OAuth sites:

```typescript
describe('handleOAuthCallbackUrl directory sync chaining', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetOpenIdConfiguration.mockResolvedValue({ token_endpoint: 'https://example.com/token' });
    mockValidateAuthorizationCode.mockResolvedValue({
      accessToken: () => 'fake-access-token',
      accessTokenExpiresAt: () => new Date(Date.now() + 3600_000),
      idToken: () => 'fake-id-token',
    });
    mockDecodeIdToken.mockReturnValue(newUserClaims);

    mockOnAuthorize.mockResolvedValue(undefined);
    mockAccountCreate.mockResolvedValue({});
    mockUserSecurityAuditLogCreate.mockResolvedValue({});
    mockSyncGoogleDirectory.mockResolvedValue(undefined);
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });
  });

  it('chains applyDirectoryMappings after sync when an account already exists', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({
      user: { id: 55, disabled: false },
    });

    const app = await buildTestApp();
    await requestCallback(app);

    await vi.waitFor(() => {
      expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(55, 'login');
    });
  });

  it('chains applyDirectoryMappings after sync when linking a new account to an existing user', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 77,
      emailVerified: new Date(),
      disabled: false,
    });

    const app = await buildTestApp();
    await requestCallback(app);

    await vi.waitFor(() => {
      expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(77, 'login');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify the new assertions fail**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/auth/server/lib/utils/handle-oauth-callback-url.test.ts
```

Expected: FAIL. The three assertions on `mockApplyDirectoryMappings` time out, because the handler does not call it yet.

- [ ] **Step 3: Commit the test changes**

```bash
git add packages/auth/server/lib/utils/handle-oauth-callback-url.test.ts
git commit -m "test: assert applyDirectoryMappings chains after sync at all three OAuth sites"
```

- [ ] **Step 4: Add the import**

After the existing `syncGoogleDirectory` import (`packages/auth/server/lib/utils/handle-oauth-callback-url.ts:12`), add:

```typescript
import { applyDirectoryMappings } from '@documenso/lib/server-only/directory-sync/apply-directory-mappings';
```

- [ ] **Step 5: Chain apply after sync at the existing-account site**

Replace (around line 80):

```typescript
    if (clientOptions.id === 'google') {
      void syncGoogleDirectory(existingAccount.user.id, email).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[directory-sync] Sync failed: ${message}`);
      });
    }
```

With:

```typescript
    if (clientOptions.id === 'google') {
      void syncGoogleDirectory(existingAccount.user.id, email)
        .then(async () => {
          await applyDirectoryMappings(existingAccount.user.id, 'login');
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.warn(`[directory-sync] Sync failed: ${message}`);
        });
    }
```

- [ ] **Step 6: Chain apply after sync at the account-link site**

Replace (around line 149):

```typescript
    if (clientOptions.id === 'google') {
      void syncGoogleDirectory(userWithSameEmail.id, email).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[directory-sync] Sync failed: ${message}`);
      });
    }
```

With:

```typescript
    if (clientOptions.id === 'google') {
      void syncGoogleDirectory(userWithSameEmail.id, email)
        .then(async () => {
          await applyDirectoryMappings(userWithSameEmail.id, 'login');
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.warn(`[directory-sync] Sync failed: ${message}`);
        });
    }
```

- [ ] **Step 7: Chain apply after sync at the new-user site**

Replace (around line 210):

```typescript
  if (clientOptions.id === 'google') {
    void syncGoogleDirectory(createdUser.id, email).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.warn(`[directory-sync] Sync failed: ${message}`);
    });
  }
```

With:

```typescript
  if (clientOptions.id === 'google') {
    void syncGoogleDirectory(createdUser.id, email)
      .then(async () => {
        await applyDirectoryMappings(createdUser.id, 'login');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[directory-sync] Sync failed: ${message}`);
      });
  }
```

- [ ] **Step 8: Type check the auth package**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/auth/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 9: Run the updated auth test and the lib directory-sync and user tests to verify no regressions**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/auth/server/lib/utils/handle-oauth-callback-url.test.ts packages/lib/server-only/user/ packages/lib/server-only/directory-sync/
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/auth/server/lib/utils/handle-oauth-callback-url.ts
git commit -m "feat: chain applyDirectoryMappings after syncGoogleDirectory on login

All three OAuth paths now grant group memberships from matching rules
immediately after the directory sync write completes, instead of
waiting for the next nightly sweep. Errors from either call are
caught by the existing warn-and-continue handler; authentication is
never blocked."
```

---

### Task 6: Nightly Sweep Job

**Files:**
- Create: `packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`
- Create: `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts`
- Test: `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts`
- Modify: `packages/lib/jobs/client.ts`

**Interfaces:**
- Consumes: `syncGoogleDirectory` from Task 4, `applyDirectoryMappings` from Task 3.
- Produces: `DIRECTORY_SYNC_SWEEP_JOB_DEFINITION` (id `internal.directory-sync-sweep`), `run({ payload, io })` handler. Registered in `jobsClient`; no other task depends on its exports.

- [ ] **Step 1: Write the failing handler tests**

```typescript
// ABOUTME: Unit tests for the directory sync sweep handler.
// ABOUTME: Covers the disabled exit, user scope, error isolation, counters, and failed-sync-still-applies.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.fn();
const mockSyncGoogleDirectory = vi.fn();
const mockApplyDirectoryMappings = vi.fn();
const mockEnv = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    user: { findMany: mockFindMany },
  },
}));

vi.mock('../../../server-only/user/sync-google-directory', () => ({
  syncGoogleDirectory: mockSyncGoogleDirectory,
}));

vi.mock('../../../server-only/directory-sync/apply-directory-mappings', () => ({
  applyDirectoryMappings: mockApplyDirectoryMappings,
}));

vi.mock('../../../utils/env', () => ({
  env: mockEnv,
}));

const io = { logger: { info: mockLoggerInfo } } as unknown as Parameters<
  typeof import('./directory-sync-sweep.handler').run
>[0]['io'];

describe('directory-sync-sweep handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockEnv.mockReturnValue('true');
  });

  it('exits immediately without querying users when the feature gate is disabled', async () => {
    mockEnv.mockReturnValue(undefined);

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('scopes the query to non-disabled users with a linked Google account', async () => {
    mockFindMany.mockResolvedValue([]);

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        disabled: false,
        accounts: { some: { provider: 'google' } },
      },
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
    });
  });

  it('calls sync then apply for every scoped user and sums granted counts', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, email: 'a@psd401.net' },
      { id: 2, email: 'b@psd401.net' },
    ]);
    mockSyncGoogleDirectory.mockResolvedValue('synced');
    mockApplyDirectoryMappings.mockResolvedValueOnce({ granted: 2 }).mockResolvedValueOnce({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(1, 'a@psd401.net');
    expect(mockSyncGoogleDirectory).toHaveBeenCalledWith(2, 'b@psd401.net');
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep');
    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(2, 'sweep');
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=2'));
  });

  it('still calls applyDirectoryMappings for a user whose sync failed', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledWith(1, 'sweep');
  });

  it('isolates a per-user error: one failing user does not abort the batch', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, email: 'a@psd401.net' },
      { id: 2, email: 'b@psd401.net' },
    ]);
    mockSyncGoogleDirectory.mockResolvedValue('synced');
    mockApplyDirectoryMappings
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ granted: 1 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockApplyDirectoryMappings).toHaveBeenCalledTimes(2);
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=1'));
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('granted=1'));
  });

  it('counts sync failures separately from apply failures', async () => {
    mockFindMany.mockResolvedValue([{ id: 1, email: 'a@psd401.net' }]);
    mockSyncGoogleDirectory.mockResolvedValue('failed');
    mockApplyDirectoryMappings.mockResolvedValue({ granted: 0 });

    const { run } = await import('./directory-sync-sweep.handler');
    await run({ payload: {}, io });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('syncFailures=1'),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('applyFailures=0'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts
```

Expected: FAIL (`./directory-sync-sweep.handler` module does not exist yet).

- [ ] **Step 3: Commit the test file**

```bash
git add packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts
git commit -m "test: add failing tests for the directory sync sweep handler"
```

- [ ] **Step 4: Implement the job definition**

Create `packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`:

```typescript
// ABOUTME: Job definition for the nightly directory sync sweep.
// ABOUTME: Cron-triggered; the handler re-syncs directory data and re-applies mapping rules for every Google SSO user.

import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID = 'internal.directory-sync-sweep';

const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA = z.object({});

export type TDirectorySyncSweepJobDefinition = z.infer<
  typeof DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA
>;

export const DIRECTORY_SYNC_SWEEP_JOB_DEFINITION = {
  id: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
  name: 'Directory Sync Sweep',
  version: '1.0.0',
  trigger: {
    name: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
    schema: DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_SCHEMA,
    cron: '0 9 * * *', // 09:00 UTC daily, roughly 1am Pacific.
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./directory-sync-sweep.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof DIRECTORY_SYNC_SWEEP_JOB_DEFINITION_ID,
  TDirectorySyncSweepJobDefinition
>;
```

- [ ] **Step 5: Implement the handler**

Create `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts`:

```typescript
// ABOUTME: Nightly sweep handler. Re-syncs directory data and re-applies group mapping rules
// ABOUTME: for every user with a linked Google account, walked in small concurrent batches.

import { prisma } from '@documenso/prisma';

import { applyDirectoryMappings } from '../../../server-only/directory-sync/apply-directory-mappings';
import { syncGoogleDirectory } from '../../../server-only/user/sync-google-directory';
import { env } from '../../../utils/env';
import type { JobRunIO } from '../../client/_internal/job';
import type { TDirectorySyncSweepJobDefinition } from './directory-sync-sweep';

const CHUNK_SIZE = 5;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

export const run = async ({
  io,
}: {
  payload: TDirectorySyncSweepJobDefinition;
  io: JobRunIO;
}) => {
  if (env('GOOGLE_DIRECTORY_SYNC_ENABLED') !== 'true') {
    io.logger.info('[directory-sync-sweep] Feature disabled, exiting');
    return;
  }

  const users = await prisma.user.findMany({
    where: {
      disabled: false,
      accounts: { some: { provider: 'google' } },
    },
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
  });

  const counters = {
    processed: 0,
    synced: 0,
    throttled: 0,
    syncFailures: 0,
    applyFailures: 0,
    granted: 0,
  };

  for (const batch of chunk(users, CHUNK_SIZE)) {
    await Promise.all(
      batch.map(async (user) => {
        counters.processed += 1;

        let syncStatus: string;

        try {
          syncStatus = await syncGoogleDirectory(user.id, user.email);
        } catch (err) {
          io.logger.info(
            `[directory-sync-sweep] sync threw for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
          syncStatus = 'failed';
        }

        if (syncStatus === 'synced') {
          counters.synced += 1;
        } else if (syncStatus === 'throttled') {
          counters.throttled += 1;
        } else {
          counters.syncFailures += 1;
        }

        try {
          const result = await applyDirectoryMappings(user.id, 'sweep');
          counters.granted += result.granted;
        } catch (err) {
          counters.applyFailures += 1;
          io.logger.info(
            `[directory-sync-sweep] apply failed for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }),
    );
  }

  io.logger.info(
    `[directory-sync-sweep] processed=${counters.processed} synced=${counters.synced} throttled=${counters.throttled} syncFailures=${counters.syncFailures} applyFailures=${counters.applyFailures} granted=${counters.granted}`,
  );
};
```

- [ ] **Step 6: Run the handler tests to verify they pass**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Register the job**

In `packages/lib/jobs/client.ts`, add the import after the `SYNC_EMAIL_DOMAINS_JOB_DEFINITION` import:

```typescript
import { DIRECTORY_SYNC_SWEEP_JOB_DEFINITION } from './definitions/internal/directory-sync-sweep';
```

Add it to the `jobsClient` array, after `SEAL_DOCUMENT_SWEEP_JOB_DEFINITION`:

```typescript
  SEAL_DOCUMENT_SWEEP_JOB_DEFINITION,
  DIRECTORY_SYNC_SWEEP_JOB_DEFINITION,
```

- [ ] **Step 8: Type check**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/lib/tsconfig.json
```

Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/lib/jobs/definitions/internal/directory-sync-sweep.ts packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts packages/lib/jobs/client.ts
git commit -m "feat: add nightly directory sync sweep job

Cron 0 9 * * * (UTC). Walks non-disabled users with a linked Google
account in batches of 5, re-syncing and re-applying mapping rules for
each. A failed sync still runs apply against last-known data. One bad
user never aborts the batch."
```

---

### Task 7: Mapping CRUD, Find, and Group Picker Business Logic

`find-directory-mappings.ts` and `find-directory-mapping-groups.ts` have no colocated test files, matching the repo convention: `find-subscription-claims.ts` and the other admin-router `find-*` business logic modules are plain Prisma passthroughs with no dedicated test file either. The mutations get tests because they contain branching logic (normalization, diffing, NOT_FOUND).

**Files:**
- Create: `packages/lib/server-only/directory-sync/create-directory-mapping.ts`
- Test: `packages/lib/server-only/directory-sync/create-directory-mapping.test.ts`
- Create: `packages/lib/server-only/directory-sync/update-directory-mapping.ts`
- Test: `packages/lib/server-only/directory-sync/update-directory-mapping.test.ts`
- Create: `packages/lib/server-only/directory-sync/delete-directory-mapping.ts`
- Test: `packages/lib/server-only/directory-sync/delete-directory-mapping.test.ts`
- Create: `packages/lib/server-only/directory-sync/find-directory-mappings.ts`
- Create: `packages/lib/server-only/directory-sync/find-directory-mapping-groups.ts`

**Interfaces:**
- Consumes: `normalizeMappingSourceValue` from Task 2, `generateDatabaseId('directory_mapping')` from Task 1, `PSD401_ORG_ID` from Task 1.
- Produces:
  - `createDirectoryMapping(options: { sourceField: DirectoryMappingSourceField; sourceValue: string; organisationGroupId: string; active?: boolean; actor: { userId: number; name: string | null; email: string } })`
  - `updateDirectoryMapping(options: { id: string; data: Partial<{ sourceField: DirectoryMappingSourceField; sourceValue: string; organisationGroupId: string; active: boolean }>; actor: { userId: number; name: string | null; email: string } })`
  - `deleteDirectoryMapping(options: { id: string; actor: { userId: number; name: string | null; email: string } })`
  - `findDirectoryMappings(options: { query?: string; page?: number; perPage?: number })`
  - `findDirectoryMappingGroups()`
  - All consumed by Task 8 (TRPC routes).

- [ ] **Step 1: Write the failing tests for create**

```typescript
// ABOUTME: Unit tests for createDirectoryMapping: normalization and the audit row it writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
  },
}));

describe('createDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { create: mockCreate },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('lowercases a GROUP sourceValue before writing', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'GROUP',
      sourceValue: 'tech-staff@psd401.net',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'GROUP',
      sourceValue: '  Tech-Staff@PSD401.net  ',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceValue: 'tech-staff@psd401.net' }),
    });
  });

  it('trims but preserves case for a DEPARTMENT sourceValue', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'DEPARTMENT',
      sourceValue: '  Technology  ',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceValue: 'Technology' }),
    });
  });

  it('writes one MAPPING_CREATED audit row diffing from null', async () => {
    mockCreate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { createDirectoryMapping } = await import('./create-directory-mapping');
    await createDirectoryMapping({
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_CREATED',
        userId: 1,
        name: 'Admin',
        email: 'admin@psd401.net',
        data: expect.objectContaining({
          mappingId: 'directory_mapping_1',
          changes: expect.objectContaining({
            sourceField: { from: null, to: 'DEPARTMENT' },
            sourceValue: { from: null, to: 'Technology' },
          }),
        }),
      }),
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL, commit the test**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/create-directory-mapping.test.ts
```

Expected: FAIL (module does not exist).

```bash
git add packages/lib/server-only/directory-sync/create-directory-mapping.test.ts
git commit -m "test: add failing tests for createDirectoryMapping"
```

- [ ] **Step 3: Implement createDirectoryMapping**

Create `packages/lib/server-only/directory-sync/create-directory-mapping.ts`:

```typescript
// ABOUTME: Creates a directory mapping rule and writes a MAPPING_CREATED audit row, in one transaction.

import type { DirectoryMappingSourceField } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { generateDatabaseId } from '../../universal/id';
import { normalizeMappingSourceValue } from './mapping-matching';

export type CreateDirectoryMappingOptions = {
  sourceField: DirectoryMappingSourceField;
  sourceValue: string;
  organisationGroupId: string;
  active?: boolean;
  actor: { userId: number; name: string | null; email: string };
};

export const createDirectoryMapping = async (options: CreateDirectoryMappingOptions) => {
  const { sourceField, sourceValue, organisationGroupId, active = true, actor } = options;

  const normalizedValue = normalizeMappingSourceValue(sourceField, sourceValue);

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.create({
      data: {
        id: generateDatabaseId('directory_mapping'),
        sourceField,
        sourceValue: normalizedValue,
        organisationGroupId,
        active,
      },
    });

    await tx.directorySyncAuditLog.create({
      data: {
        type: 'MAPPING_CREATED',
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        data: {
          mappingId: mapping.id,
          changes: {
            sourceField: { from: null, to: mapping.sourceField },
            sourceValue: { from: null, to: mapping.sourceValue },
            organisationGroupId: { from: null, to: mapping.organisationGroupId },
            active: { from: null, to: mapping.active },
          },
        },
      },
    });

    return mapping;
  });
};
```

- [ ] **Step 4: Run tests, verify PASS, commit**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/create-directory-mapping.test.ts
```

Expected: all tests PASS.

```bash
git add packages/lib/server-only/directory-sync/create-directory-mapping.ts
git commit -m "feat: add createDirectoryMapping"
```

- [ ] **Step 5: Write the failing tests for update**

```typescript
// ABOUTME: Unit tests for updateDirectoryMapping: NOT_FOUND, field-level diffing, and
// ABOUTME: normalization against the effective post-update sourceField.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, AppErrorCode } from '../../errors/app-error';

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    directoryGroupMapping: { findFirst: mockFindFirst },
    $transaction: mockTransaction,
  },
}));

describe('updateDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { update: mockUpdate },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('throws NOT_FOUND when the mapping does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { updateDirectoryMapping } = await import('./update-directory-mapping');

    await expect(
      updateDirectoryMapping({
        id: 'directory_mapping_missing',
        data: { active: false },
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toThrow(AppError);

    await expect(
      updateDirectoryMapping({
        id: 'directory_mapping_missing',
        data: { active: false },
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });
  });

  it('normalizes sourceValue against a newly-provided sourceField', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'GROUP',
      sourceValue: 'tech-staff@psd401.net',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { sourceField: 'GROUP', sourceValue: 'Tech-Staff@PSD401.net' },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'directory_mapping_1' },
      data: expect.objectContaining({
        sourceField: 'GROUP',
        sourceValue: 'tech-staff@psd401.net',
      }),
    });
  });

  it('writes a diff containing only the changed fields', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: false,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { active: false },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_UPDATED',
        data: {
          mappingId: 'directory_mapping_1',
          changes: { active: { from: true, to: false } },
        },
      }),
    });
  });

  it('writes no audit row when nothing actually changed', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockUpdate.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });

    const { updateDirectoryMapping } = await import('./update-directory-mapping');
    await updateDirectoryMapping({
      id: 'directory_mapping_1',
      data: { active: true },
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run, verify FAIL, commit**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/update-directory-mapping.test.ts
```

Expected: FAIL (module does not exist).

```bash
git add packages/lib/server-only/directory-sync/update-directory-mapping.test.ts
git commit -m "test: add failing tests for updateDirectoryMapping"
```

- [ ] **Step 7: Implement updateDirectoryMapping**

Create `packages/lib/server-only/directory-sync/update-directory-mapping.ts`:

```typescript
// ABOUTME: Updates a directory mapping rule and writes a field-level MAPPING_UPDATED audit row,
// ABOUTME: in one transaction. Normalizes sourceValue against the effective post-update sourceField.

import type { DirectoryMappingSourceField } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { normalizeMappingSourceValue } from './mapping-matching';

export type UpdateDirectoryMappingData = Partial<{
  sourceField: DirectoryMappingSourceField;
  sourceValue: string;
  organisationGroupId: string;
  active: boolean;
}>;

export type UpdateDirectoryMappingOptions = {
  id: string;
  data: UpdateDirectoryMappingData;
  actor: { userId: number; name: string | null; email: string };
};

export const updateDirectoryMapping = async (options: UpdateDirectoryMappingOptions) => {
  const { id, data, actor } = options;

  const existing = await prisma.directoryGroupMapping.findFirst({ where: { id } });

  if (!existing) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Directory mapping not found' });
  }

  const effectiveSourceField = data.sourceField ?? existing.sourceField;

  const nextSourceValue =
    data.sourceValue !== undefined
      ? normalizeMappingSourceValue(effectiveSourceField, data.sourceValue)
      : existing.sourceValue;

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (data.sourceField !== undefined && data.sourceField !== existing.sourceField) {
    changes.sourceField = { from: existing.sourceField, to: data.sourceField };
  }

  if (nextSourceValue !== existing.sourceValue) {
    changes.sourceValue = { from: existing.sourceValue, to: nextSourceValue };
  }

  if (
    data.organisationGroupId !== undefined &&
    data.organisationGroupId !== existing.organisationGroupId
  ) {
    changes.organisationGroupId = {
      from: existing.organisationGroupId,
      to: data.organisationGroupId,
    };
  }

  if (data.active !== undefined && data.active !== existing.active) {
    changes.active = { from: existing.active, to: data.active };
  }

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.update({
      where: { id },
      data: {
        sourceField: effectiveSourceField,
        sourceValue: nextSourceValue,
        organisationGroupId: data.organisationGroupId ?? existing.organisationGroupId,
        active: data.active ?? existing.active,
      },
    });

    if (Object.keys(changes).length > 0) {
      await tx.directorySyncAuditLog.create({
        data: {
          type: 'MAPPING_UPDATED',
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          data: { mappingId: mapping.id, changes },
        },
      });
    }

    return mapping;
  });
};
```

- [ ] **Step 8: Run tests, verify PASS, commit**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/update-directory-mapping.test.ts
```

Expected: all tests PASS.

```bash
git add packages/lib/server-only/directory-sync/update-directory-mapping.ts
git commit -m "feat: add updateDirectoryMapping"
```

- [ ] **Step 9: Write the failing tests for delete**

```typescript
// ABOUTME: Unit tests for deleteDirectoryMapping: NOT_FOUND and the audit row it writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, AppErrorCode } from '../../errors/app-error';

const mockFindFirst = vi.fn();
const mockDelete = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@documenso/prisma', () => ({
  prisma: {
    directoryGroupMapping: { findFirst: mockFindFirst },
    $transaction: mockTransaction,
  },
}));

describe('deleteDirectoryMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        directoryGroupMapping: { delete: mockDelete },
        directorySyncAuditLog: { create: mockAuditLogCreate },
      }),
    );
  });

  it('throws NOT_FOUND when the mapping does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { deleteDirectoryMapping } = await import('./delete-directory-mapping');

    await expect(
      deleteDirectoryMapping({
        id: 'directory_mapping_missing',
        actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.NOT_FOUND });
  });

  it('deletes the mapping and writes a MAPPING_DELETED audit row', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'directory_mapping_1',
      sourceField: 'DEPARTMENT',
      sourceValue: 'Technology',
      organisationGroupId: 'org_group_1',
      active: true,
    });
    mockDelete.mockResolvedValue({ id: 'directory_mapping_1' });

    const { deleteDirectoryMapping } = await import('./delete-directory-mapping');
    await deleteDirectoryMapping({
      id: 'directory_mapping_1',
      actor: { userId: 1, name: 'Admin', email: 'admin@psd401.net' },
    });

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'directory_mapping_1' } });
    expect(mockAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MAPPING_DELETED',
        userId: 1,
        data: {
          mappingId: 'directory_mapping_1',
          changes: {
            sourceField: { from: 'DEPARTMENT', to: null },
            sourceValue: { from: 'Technology', to: null },
            organisationGroupId: { from: 'org_group_1', to: null },
            active: { from: true, to: null },
          },
        },
      }),
    });
  });
});
```

- [ ] **Step 10: Run, verify FAIL, commit**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/delete-directory-mapping.test.ts
```

Expected: FAIL (module does not exist).

```bash
git add packages/lib/server-only/directory-sync/delete-directory-mapping.test.ts
git commit -m "test: add failing tests for deleteDirectoryMapping"
```

- [ ] **Step 11: Implement deleteDirectoryMapping**

Create `packages/lib/server-only/directory-sync/delete-directory-mapping.ts`:

```typescript
// ABOUTME: Deletes a directory mapping rule and writes a MAPPING_DELETED audit row, in one
// ABOUTME: transaction. Existing OrganisationGroupMember rows already inserted by earlier
// ABOUTME: syncs are untouched, matching the additive-only invariant.

import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';

export type DeleteDirectoryMappingOptions = {
  id: string;
  actor: { userId: number; name: string | null; email: string };
};

export const deleteDirectoryMapping = async (options: DeleteDirectoryMappingOptions) => {
  const { id, actor } = options;

  const existing = await prisma.directoryGroupMapping.findFirst({ where: { id } });

  if (!existing) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Directory mapping not found' });
  }

  return await prisma.$transaction(async (tx) => {
    const mapping = await tx.directoryGroupMapping.delete({ where: { id } });

    await tx.directorySyncAuditLog.create({
      data: {
        type: 'MAPPING_DELETED',
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        data: {
          mappingId: existing.id,
          changes: {
            sourceField: { from: existing.sourceField, to: null },
            sourceValue: { from: existing.sourceValue, to: null },
            organisationGroupId: { from: existing.organisationGroupId, to: null },
            active: { from: existing.active, to: null },
          },
        },
      },
    });

    return mapping;
  });
};
```

- [ ] **Step 12: Run tests, verify PASS, commit**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/delete-directory-mapping.test.ts
```

Expected: all tests PASS.

```bash
git add packages/lib/server-only/directory-sync/delete-directory-mapping.ts
git commit -m "feat: add deleteDirectoryMapping"
```

- [ ] **Step 13: Add findDirectoryMappings (no test, matches find-subscription-claims.ts convention)**

Create `packages/lib/server-only/directory-sync/find-directory-mappings.ts`:

```typescript
// ABOUTME: Lists directory mappings with their target group and team, paginated and
// ABOUTME: optionally filtered by sourceValue substring. Mirrors find-subscription-claims.ts.

import { prisma } from '@documenso/prisma';

import type { FindResultResponse } from '../../types/search-params';

export type FindDirectoryMappingsOptions = {
  query?: string;
  page?: number;
  perPage?: number;
};

export const findDirectoryMappings = async (options: FindDirectoryMappingsOptions) => {
  const { query, page = 1, perPage = 20 } = options;

  const whereClause = query
    ? { sourceValue: { contains: query, mode: 'insensitive' as const } }
    : {};

  const [data, count] = await Promise.all([
    prisma.directoryGroupMapping.findMany({
      where: whereClause,
      include: {
        organisationGroup: {
          include: {
            teamGroups: { include: { team: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { sourceValue: 'asc' },
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
    }),
    prisma.directoryGroupMapping.count({ where: whereClause }),
  ]);

  return {
    data,
    count,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(count / perPage),
  } satisfies FindResultResponse<typeof data>;
};
```

- [ ] **Step 14: Add findDirectoryMappingGroups (no test)**

Create `packages/lib/server-only/directory-sync/find-directory-mapping-groups.ts`:

```typescript
// ABOUTME: Lists every PSD401 org group eligible as a mapping target, with its linked teams,
// ABOUTME: for the admin UI's group picker. Includes INTERNAL_TEAM and INTERNAL_ORGANISATION
// ABOUTME: groups alongside CUSTOM groups: standard teams' member groups are the natural
// ABOUTME: mapping targets (spec section 2, "deliberate divergence from upstream").

import { prisma } from '@documenso/prisma';

import { PSD401_ORG_ID } from '../../constants/psd401';

export const findDirectoryMappingGroups = async () => {
  return await prisma.organisationGroup.findMany({
    where: { organisationId: PSD401_ORG_ID },
    include: {
      teamGroups: { include: { team: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
};
```

- [ ] **Step 15: Type-check the package**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/lib/tsconfig.json
```

Expected: no errors.

- [ ] **Step 16: Commit the find helpers**

```bash
git add packages/lib/server-only/directory-sync/find-directory-mappings.ts packages/lib/server-only/directory-sync/find-directory-mapping-groups.ts
git commit -m "feat: add findDirectoryMappings and findDirectoryMappingGroups"
```

---

### Task 8: TRPC Routes for the `admin.directoryMappings` Namespace

No admin-router route file has a colocated test in this codebase (`find-subscription-claims.ts`, `create-subscription-claim.ts`, etc. are all untested). This task follows that convention: routes are thin `adminProcedure` wrappers around the Task 7 business logic, verified by `tsc` and by Task 11's manual dev-rollout check, not by vitest.

Spec section 6 also asks for route-level TRPC validation tests. `packages/trpc` has no vitest project, so this plan deliberately does not add them. Validation logic lives in Task 7's lib functions, which already have tests. Routes stay thin wrappers checked by `tsc`. Flagged here as an accepted deviation from the spec, for Reese's awareness.

**Files:**
- Create: `packages/trpc/server/admin-router/find-directory-mappings.ts`
- Create: `packages/trpc/server/admin-router/find-directory-mappings.types.ts`
- Create: `packages/trpc/server/admin-router/create-directory-mapping.ts`
- Create: `packages/trpc/server/admin-router/create-directory-mapping.types.ts`
- Create: `packages/trpc/server/admin-router/update-directory-mapping.ts`
- Create: `packages/trpc/server/admin-router/update-directory-mapping.types.ts`
- Create: `packages/trpc/server/admin-router/delete-directory-mapping.ts`
- Create: `packages/trpc/server/admin-router/delete-directory-mapping.types.ts`
- Create: `packages/trpc/server/admin-router/list-directory-mapping-groups.ts`
- Create: `packages/trpc/server/admin-router/list-directory-mapping-groups.types.ts`
- Modify: `packages/trpc/server/admin-router/router.ts`

**Interfaces:**
- Consumes: `createDirectoryMapping`, `updateDirectoryMapping`, `deleteDirectoryMapping`, `findDirectoryMappings`, `findDirectoryMappingGroups` from Task 7. `ZFindSearchParamsSchema` from `packages/lib/types/search-params.ts`.
- Produces: `admin.directoryMappings.find`, `admin.directoryMappings.create`, `admin.directoryMappings.update`, `admin.directoryMappings.delete`, `admin.directoryMappings.listGroups` TRPC procedures, consumed by Task 9 (Admin UI).

- [ ] **Step 1: Add the find route types**

Create `packages/trpc/server/admin-router/find-directory-mappings.types.ts`:

```typescript
// ABOUTME: Zod input/output types for admin.directoryMappings.find, mirroring
// ABOUTME: find-admin-organisations.types.ts for the nested-relation response shape.

import { z } from 'zod';

import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';
import OrganisationGroupSchema from '@documenso/prisma/generated/zod/modelSchema/OrganisationGroupSchema';
import TeamGroupSchema from '@documenso/prisma/generated/zod/modelSchema/TeamGroupSchema';
import TeamSchema from '@documenso/prisma/generated/zod/modelSchema/TeamSchema';

import { ZFindSearchParamsSchema } from '@documenso/lib/types/search-params';

export const ZFindDirectoryMappingsRequestSchema = ZFindSearchParamsSchema.extend({});

export type TFindDirectoryMappingsRequest = z.infer<typeof ZFindDirectoryMappingsRequestSchema>;

export const ZFindDirectoryMappingsResponseSchema = z.object({
  data: DirectoryGroupMappingSchema.extend({
    organisationGroup: OrganisationGroupSchema.pick({
      id: true,
      name: true,
      type: true,
      organisationRole: true,
    }).extend({
      teamGroups: TeamGroupSchema.pick({ id: true, teamId: true, teamRole: true })
        .extend({
          team: TeamSchema.pick({ id: true, name: true }),
        })
        .array(),
    }),
  }).array(),
  count: z.number(),
  currentPage: z.number(),
  perPage: z.number(),
  totalPages: z.number(),
});

export type TFindDirectoryMappingsResponse = z.infer<typeof ZFindDirectoryMappingsResponseSchema>;
```

- [ ] **Step 2: Add the find route**

Create `packages/trpc/server/admin-router/find-directory-mappings.ts`:

```typescript
// ABOUTME: TRPC route wrapping findDirectoryMappings for the admin directory mappings table.

import { findDirectoryMappings } from '@documenso/lib/server-only/directory-sync/find-directory-mappings';

import { adminProcedure } from '../trpc';
import {
  ZFindDirectoryMappingsRequestSchema,
  ZFindDirectoryMappingsResponseSchema,
} from './find-directory-mappings.types';

export const findDirectoryMappingsRoute = adminProcedure
  .input(ZFindDirectoryMappingsRequestSchema)
  .output(ZFindDirectoryMappingsResponseSchema)
  .query(async ({ input }) => {
    return await findDirectoryMappings(input);
  });
```

- [ ] **Step 3: Add the create route types and route**

Create `packages/trpc/server/admin-router/create-directory-mapping.types.ts`:

```typescript
// ABOUTME: Zod input/output types for admin.directoryMappings.create.

import { z } from 'zod';

import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';

export const ZCreateDirectoryMappingRequestSchema = z.object({
  sourceField: z.enum(['GROUP', 'DEPARTMENT', 'ORG_UNIT']),
  sourceValue: z.string().trim().min(1).max(255),
  organisationGroupId: z.string().min(1),
  active: z.boolean().optional(),
});

export type TCreateDirectoryMappingRequest = z.infer<typeof ZCreateDirectoryMappingRequestSchema>;

export const ZCreateDirectoryMappingResponseSchema = DirectoryGroupMappingSchema;

export type TCreateDirectoryMappingResponse = z.infer<typeof ZCreateDirectoryMappingResponseSchema>;
```

Create `packages/trpc/server/admin-router/create-directory-mapping.ts`:

```typescript
// ABOUTME: TRPC route wrapping createDirectoryMapping. Actor is taken from the admin session.

import { createDirectoryMapping } from '@documenso/lib/server-only/directory-sync/create-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZCreateDirectoryMappingRequestSchema,
  ZCreateDirectoryMappingResponseSchema,
} from './create-directory-mapping.types';

export const createDirectoryMappingRoute = adminProcedure
  .input(ZCreateDirectoryMappingRequestSchema)
  .output(ZCreateDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return await createDirectoryMapping({
      ...input,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
```

- [ ] **Step 4: Add the update route types and route**

Create `packages/trpc/server/admin-router/update-directory-mapping.types.ts`:

```typescript
// ABOUTME: Zod input/output types for admin.directoryMappings.update.

import { z } from 'zod';

import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';

export const ZUpdateDirectoryMappingRequestSchema = z.object({
  id: z.string().min(1),
  sourceField: z.enum(['GROUP', 'DEPARTMENT', 'ORG_UNIT']).optional(),
  sourceValue: z.string().trim().min(1).max(255).optional(),
  organisationGroupId: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export type TUpdateDirectoryMappingRequest = z.infer<typeof ZUpdateDirectoryMappingRequestSchema>;

export const ZUpdateDirectoryMappingResponseSchema = DirectoryGroupMappingSchema;

export type TUpdateDirectoryMappingResponse = z.infer<typeof ZUpdateDirectoryMappingResponseSchema>;
```

Create `packages/trpc/server/admin-router/update-directory-mapping.ts`:

```typescript
// ABOUTME: TRPC route wrapping updateDirectoryMapping. Actor is taken from the admin session.

import { updateDirectoryMapping } from '@documenso/lib/server-only/directory-sync/update-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZUpdateDirectoryMappingRequestSchema,
  ZUpdateDirectoryMappingResponseSchema,
} from './update-directory-mapping.types';

export const updateDirectoryMappingRoute = adminProcedure
  .input(ZUpdateDirectoryMappingRequestSchema)
  .output(ZUpdateDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;

    return await updateDirectoryMapping({
      id,
      data,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
```

- [ ] **Step 5: Add the delete route types and route**

Create `packages/trpc/server/admin-router/delete-directory-mapping.types.ts`:

```typescript
// ABOUTME: Zod input/output types for admin.directoryMappings.delete.

import { z } from 'zod';

export const ZDeleteDirectoryMappingRequestSchema = z.object({
  id: z.string().min(1),
});

export type TDeleteDirectoryMappingRequest = z.infer<typeof ZDeleteDirectoryMappingRequestSchema>;

export const ZDeleteDirectoryMappingResponseSchema = z.object({ id: z.string() });

export type TDeleteDirectoryMappingResponse = z.infer<typeof ZDeleteDirectoryMappingResponseSchema>;
```

Create `packages/trpc/server/admin-router/delete-directory-mapping.ts`:

```typescript
// ABOUTME: TRPC route wrapping deleteDirectoryMapping. Actor is taken from the admin session.

import { deleteDirectoryMapping } from '@documenso/lib/server-only/directory-sync/delete-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZDeleteDirectoryMappingRequestSchema,
  ZDeleteDirectoryMappingResponseSchema,
} from './delete-directory-mapping.types';

export const deleteDirectoryMappingRoute = adminProcedure
  .input(ZDeleteDirectoryMappingRequestSchema)
  .output(ZDeleteDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return await deleteDirectoryMapping({
      id: input.id,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
```

- [ ] **Step 6: Add the listGroups route types and route**

Create `packages/trpc/server/admin-router/list-directory-mapping-groups.types.ts`:

```typescript
// ABOUTME: Zod output type for admin.directoryMappings.listGroups, the group picker source.

import { z } from 'zod';

import OrganisationGroupSchema from '@documenso/prisma/generated/zod/modelSchema/OrganisationGroupSchema';
import TeamGroupSchema from '@documenso/prisma/generated/zod/modelSchema/TeamGroupSchema';
import TeamSchema from '@documenso/prisma/generated/zod/modelSchema/TeamSchema';

export const ZListDirectoryMappingGroupsResponseSchema = OrganisationGroupSchema.pick({
  id: true,
  name: true,
  type: true,
  organisationRole: true,
})
  .extend({
    teamGroups: TeamGroupSchema.pick({ id: true, teamId: true, teamRole: true })
      .extend({
        team: TeamSchema.pick({ id: true, name: true }),
      })
      .array(),
  })
  .array();

export type TListDirectoryMappingGroupsResponse = z.infer<
  typeof ZListDirectoryMappingGroupsResponseSchema
>;
```

Create `packages/trpc/server/admin-router/list-directory-mapping-groups.ts`:

```typescript
// ABOUTME: TRPC route wrapping findDirectoryMappingGroups for the admin group picker.

import { findDirectoryMappingGroups } from '@documenso/lib/server-only/directory-sync/find-directory-mapping-groups';

import { adminProcedure } from '../trpc';
import { ZListDirectoryMappingGroupsResponseSchema } from './list-directory-mapping-groups.types';

export const listDirectoryMappingGroupsRoute = adminProcedure
  .output(ZListDirectoryMappingGroupsResponseSchema)
  .query(async () => {
    return await findDirectoryMappingGroups();
  });
```

- [ ] **Step 7: Wire the namespace into router.ts**

`packages/trpc/server/admin-router/router.ts` groups routes under namespaces as plain object literals (`claims: { find: ..., create: ..., ... }`), all nested inside the single outer `adminRouter = router({ ... })` call. No namespace wraps its own routes in a second `router({ ... })` call. Add a new `directoryMappings` namespace following that exact pattern:

```typescript
import { createDirectoryMappingRoute } from './create-directory-mapping';
import { deleteDirectoryMappingRoute } from './delete-directory-mapping';
import { findDirectoryMappingsRoute } from './find-directory-mappings';
import { listDirectoryMappingGroupsRoute } from './list-directory-mapping-groups';
import { updateDirectoryMappingRoute } from './update-directory-mapping';
```

Inside the `adminRouter = router({ ... })` object, add:

```typescript
  directoryMappings: {
    find: findDirectoryMappingsRoute,
    create: createDirectoryMappingRoute,
    update: updateDirectoryMappingRoute,
    delete: deleteDirectoryMappingRoute,
    listGroups: listDirectoryMappingGroupsRoute,
  },
```

- [ ] **Step 8: Type-check the trpc package**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/trpc/tsconfig.json
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/trpc/server/admin-router/find-directory-mappings.ts packages/trpc/server/admin-router/find-directory-mappings.types.ts packages/trpc/server/admin-router/create-directory-mapping.ts packages/trpc/server/admin-router/create-directory-mapping.types.ts packages/trpc/server/admin-router/update-directory-mapping.ts packages/trpc/server/admin-router/update-directory-mapping.types.ts packages/trpc/server/admin-router/delete-directory-mapping.ts packages/trpc/server/admin-router/delete-directory-mapping.types.ts packages/trpc/server/admin-router/list-directory-mapping-groups.ts packages/trpc/server/admin-router/list-directory-mapping-groups.types.ts packages/trpc/server/admin-router/router.ts
git commit -m "feat: add admin.directoryMappings TRPC namespace"
```

---

### Task 9: Admin UI for Directory Mappings

The table is not functional without the create/update/delete dialogs (its row actions render them directly), and the form component is shared by both the create and update dialogs. Splitting this into separate tasks would leave an intermediate task with nothing a reviewer could exercise in the browser, so it stays one task. No admin UI component in this codebase (`admin-claims-table.tsx`, `claim-*-dialog.tsx`, `subscription-claim-form.tsx`) has a colocated test file; this task follows that convention and is verified manually in Task 11's dev rollout.

**Files:**
- Create: `apps/remix/app/components/forms/directory-mapping-form.tsx`
- Create: `apps/remix/app/components/dialogs/directory-mapping-create-dialog.tsx`
- Create: `apps/remix/app/components/dialogs/directory-mapping-update-dialog.tsx`
- Create: `apps/remix/app/components/dialogs/directory-mapping-delete-dialog.tsx`
- Create: `apps/remix/app/components/tables/admin-directory-mappings-table.tsx`
- Create: `apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`
- Modify: `apps/remix/app/routes/_authenticated+/admin+/_layout.tsx:131-135`

**Interfaces:**
- Consumes: `admin.directoryMappings.{find,create,update,delete,listGroups}` from Task 8. `ZCreateDirectoryMappingRequestSchema`, `TListDirectoryMappingGroupsResponse`, `TFindDirectoryMappingsResponse` types from Task 8.
- Produces: the `/admin/directory-mappings` page. Nothing later in this plan consumes these files directly.

- [ ] **Step 1: Build the shared form component**

Create `apps/remix/app/components/forms/directory-mapping-form.tsx`:

```typescript
// ABOUTME: Form for creating and editing a directory mapping rule. Shared by the create and
// ABOUTME: update dialogs, following the pattern in subscription-claim-form.tsx.

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { ZCreateDirectoryMappingRequestSchema } from '@documenso/trpc/server/admin-router/create-directory-mapping.types';
import type { TListDirectoryMappingGroupsResponse } from '@documenso/trpc/server/admin-router/list-directory-mapping-groups.types';
import { Badge } from '@documenso/ui/primitives/badge';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';

export type DirectoryMappingFormValues = z.infer<typeof ZCreateDirectoryMappingRequestSchema>;

type DirectoryMappingFormProps = {
  mapping: DirectoryMappingFormValues;
  groups: TListDirectoryMappingGroupsResponse;
  onFormSubmit: (data: DirectoryMappingFormValues) => Promise<void>;
  formSubmitTrigger?: React.ReactNode;
};

export const formatGroupLabel = (group: TListDirectoryMappingGroupsResponse[number]) => {
  const teamNames = group.teamGroups.map((teamGroup) => teamGroup.team.name);

  return group.name ?? (teamNames.length > 0 ? teamNames.join(', ') : group.id);
};

export const DirectoryMappingForm = ({
  mapping,
  groups,
  onFormSubmit,
  formSubmitTrigger,
}: DirectoryMappingFormProps) => {
  const { t } = useLingui();

  const form = useForm<DirectoryMappingFormValues>({
    resolver: zodResolver(ZCreateDirectoryMappingRequestSchema),
    defaultValues: mapping,
  });

  const sourceField = useWatch({ control: form.control, name: 'sourceField' });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset disabled={form.formState.isSubmitting} className="space-y-4">
          <FormField
            control={form.control}
            name="sourceField"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Source Field</Trans>
                </FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GROUP">{t`Google Group`}</SelectItem>
                      <SelectItem value="DEPARTMENT">{t`Department`}</SelectItem>
                      <SelectItem value="ORG_UNIT">{t`Org Unit Path`}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sourceValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Source Value</Trans>
                </FormLabel>
                <FormControl>
                  <Input placeholder={t`e.g. tech-staff@psd401.net`} {...field} />
                </FormControl>
                <FormDescription>
                  {sourceField === 'ORG_UNIT' ? (
                    <Trans>a rule value of / matches every user with a non-null org unit</Trans>
                  ) : (
                    <Trans>
                      The Google group email, department name, or org unit path to match.
                    </Trans>
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="organisationGroupId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Target Group</Trans>
                </FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder={t`Select a group`} />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          <div className="flex flex-col items-start gap-0.5">
                            <div className="flex items-center gap-2">
                              <span>{formatGroupLabel(group)}</span>
                              <Badge variant="neutral" size="small">
                                {group.type}
                              </Badge>
                            </div>
                            {group.teamGroups.length > 0 && (
                              <span className="text-muted-foreground text-xs">
                                {group.teamGroups
                                  .map(
                                    (teamGroup) => `${teamGroup.team.name} (${teamGroup.teamRole})`,
                                  )
                                  .join(', ')}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <div className="flex items-center">
                    <Checkbox
                      id="mapping-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <label className="ml-2 text-sm text-muted-foreground" htmlFor="mapping-active">
                      <Trans>Active</Trans>
                    </label>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />

          {formSubmitTrigger}
        </fieldset>
      </form>
    </Form>
  );
};
```

- [ ] **Step 2: Build the create dialog**

Create `apps/remix/app/components/dialogs/directory-mapping-create-dialog.tsx`:

```typescript
// ABOUTME: Dialog for creating a directory mapping rule. Fetches the group picker options
// ABOUTME: itself so the create button works standalone from the page header.

import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DirectoryMappingForm } from '../forms/directory-mapping-form';

export const DirectoryMappingCreateDialog = () => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { data: groups } = trpc.admin.directoryMappings.listGroups.useQuery(undefined, {
    enabled: open,
  });

  const { mutateAsync: createMapping, isPending } =
    trpc.admin.directoryMappings.create.useMutation({
      onSuccess: () => {
        toast({ title: t`Directory mapping created successfully.` });
        setOpen(false);
      },
      onError: () => {
        toast({
          title: t`Failed to create directory mapping.`,
          variant: 'destructive',
        });
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger onClick={(e) => e.stopPropagation()} asChild={true}>
        <Button className="flex-shrink-0" variant="secondary">
          <Trans>Create mapping</Trans>
        </Button>
      </DialogTrigger>

      <DialogContent className="scrollbar-hidden max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Create Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Map a Google directory value to a target group.</Trans>
          </DialogDescription>
        </DialogHeader>

        <DirectoryMappingForm
          mapping={{
            sourceField: 'GROUP',
            sourceValue: '',
            organisationGroupId: groups?.[0]?.id ?? '',
            active: true,
          }}
          groups={groups ?? []}
          onFormSubmit={createMapping}
          formSubmitTrigger={
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                <Trans>Cancel</Trans>
              </Button>

              <Button type="submit" loading={isPending}>
                <Trans>Create Mapping</Trans>
              </Button>
            </DialogFooter>
          }
        />
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 3: Build the update dialog**

Create `apps/remix/app/components/dialogs/directory-mapping-update-dialog.tsx`:

```typescript
// ABOUTME: Dialog for editing an existing directory mapping rule, opened from the table row menu.

import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import type { TFindDirectoryMappingsResponse } from '@documenso/trpc/server/admin-router/find-directory-mappings.types';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DirectoryMappingForm } from '../forms/directory-mapping-form';

export type DirectoryMappingUpdateDialogProps = {
  mapping: TFindDirectoryMappingsResponse['data'][number];
  trigger: React.ReactNode;
};

export const DirectoryMappingUpdateDialog = ({
  mapping,
  trigger,
}: DirectoryMappingUpdateDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { data: groups } = trpc.admin.directoryMappings.listGroups.useQuery(undefined, {
    enabled: open,
  });

  const { mutateAsync: updateMapping, isPending } =
    trpc.admin.directoryMappings.update.useMutation({
      onSuccess: () => {
        toast({ title: t`Directory mapping updated successfully.` });
        setOpen(false);
      },
      onError: () => {
        toast({
          title: t`Failed to update directory mapping.`,
          variant: 'destructive',
        });
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DialogTrigger>

      <DialogContent className="scrollbar-hidden max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Update Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Modify the details of this directory mapping.</Trans>
          </DialogDescription>
        </DialogHeader>

        <DirectoryMappingForm
          mapping={{
            sourceField: mapping.sourceField,
            sourceValue: mapping.sourceValue,
            organisationGroupId: mapping.organisationGroupId,
            active: mapping.active,
          }}
          groups={groups ?? []}
          onFormSubmit={async (data) =>
            await updateMapping({
              id: mapping.id,
              ...data,
            })
          }
          formSubmitTrigger={
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                <Trans>Cancel</Trans>
              </Button>

              <Button type="submit" loading={isPending}>
                <Trans>Update Mapping</Trans>
              </Button>
            </DialogFooter>
          }
        />
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 4: Build the delete dialog**

Create `apps/remix/app/components/dialogs/directory-mapping-delete-dialog.tsx`:

```typescript
// ABOUTME: Confirmation dialog for deleting a directory mapping rule. Deleting a mapping does
// ABOUTME: not remove any group memberships it already granted; the invariant is additive-only.

import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import { Alert, AlertDescription } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';

export type DirectoryMappingDeleteDialogProps = {
  mappingId: string;
  mappingLabel: string;
  trigger: React.ReactNode;
};

export const DirectoryMappingDeleteDialog = ({
  mappingId,
  mappingLabel,
  trigger,
}: DirectoryMappingDeleteDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { mutateAsync: deleteMapping, isPending } =
    trpc.admin.directoryMappings.delete.useMutation({
      onSuccess: () => {
        toast({ title: t`Directory mapping deleted successfully.` });
        setOpen(false);
      },
      onError: (err) => {
        console.error(err);

        toast({
          title: t`Failed to delete directory mapping.`,
          variant: 'destructive',
        });
      },
    });

  return (
    <Dialog open={open} onOpenChange={(value) => !isPending && setOpen(value)}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Are you sure you want to delete the following mapping?</Trans>
          </DialogDescription>
        </DialogHeader>

        <Alert variant="neutral">
          <AlertDescription className="text-center font-semibold">
            {mappingLabel}
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            <Trans>Cancel</Trans>
          </Button>

          <Button
            type="submit"
            variant="destructive"
            loading={isPending}
            onClick={async () => deleteMapping({ id: mappingId })}
          >
            <Trans>Delete</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 5: Build the table**

Create `apps/remix/app/components/tables/admin-directory-mappings-table.tsx`:

```typescript
// ABOUTME: Admin table listing directory mappings, with an inline active toggle and a row
// ABOUTME: menu for update/delete, mirroring admin-claims-table.tsx.

import { useMemo } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { EditIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { ZUrlSearchParamsSchema } from '@documenso/lib/types/search-params';
import { trpc } from '@documenso/trpc/react';
import { Badge } from '@documenso/ui/primitives/badge';
import type { DataTableColumnDef } from '@documenso/ui/primitives/data-table';
import { DataTable } from '@documenso/ui/primitives/data-table';
import { DataTablePagination } from '@documenso/ui/primitives/data-table-pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { Switch } from '@documenso/ui/primitives/switch';
import { TableCell } from '@documenso/ui/primitives/table';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DirectoryMappingDeleteDialog } from '../dialogs/directory-mapping-delete-dialog';
import { DirectoryMappingUpdateDialog } from '../dialogs/directory-mapping-update-dialog';
import { formatGroupLabel } from '../forms/directory-mapping-form';

export const AdminDirectoryMappingsTable = () => {
  const { t, i18n } = useLingui();
  const { toast } = useToast();

  const [searchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();

  const parsedSearchParams = ZUrlSearchParamsSchema.parse(Object.fromEntries(searchParams ?? []));

  const { data, isLoading, isLoadingError } = trpc.admin.directoryMappings.find.useQuery({
    query: parsedSearchParams.query,
    page: parsedSearchParams.page,
    perPage: parsedSearchParams.perPage,
  });

  const { mutate: updateMapping } = trpc.admin.directoryMappings.update.useMutation({
    onError: () => {
      toast({
        title: t`Failed to update directory mapping.`,
        variant: 'destructive',
      });
    },
  });

  const onPaginationChange = (page: number, perPage: number) => {
    updateSearchParams({ page, perPage });
  };

  const results = data ?? {
    data: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo(() => {
    return [
      {
        header: t`Source Field`,
        accessorKey: 'sourceField',
        cell: ({ row }) => <Badge>{row.original.sourceField}</Badge>,
      },
      {
        header: t`Source Value`,
        accessorKey: 'sourceValue',
      },
      {
        header: t`Target Group`,
        cell: ({ row }) => {
          const group = row.original.organisationGroup;

          return (
            <div className="flex flex-col items-start gap-0.5">
              <div className="flex items-center gap-2">
                <span>{formatGroupLabel(group)}</span>
                <Badge variant="neutral" size="small">
                  {group.type}
                </Badge>
              </div>
              {group.teamGroups.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {group.teamGroups
                    .map((teamGroup) => `${teamGroup.team.name} (${teamGroup.teamRole})`)
                    .join(', ')}
                </span>
              )}
            </div>
          );
        },
      },
      {
        header: t`Updated`,
        accessorKey: 'updatedAt',
        cell: ({ row }) => i18n.date(row.original.updatedAt),
      },
      {
        header: t`Active`,
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            onCheckedChange={(checked) =>
              updateMapping({ id: row.original.id, active: checked })
            }
          />
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <MoreHorizontalIcon className="h-5 w-5 text-muted-foreground" />
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-52" align="start" forceMount>
              <DropdownMenuLabel>
                <Trans>Actions</Trans>
              </DropdownMenuLabel>

              <DirectoryMappingUpdateDialog
                mapping={row.original}
                trigger={
                  <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                    <div>
                      <EditIcon className="mr-2 h-4 w-4" />
                      <Trans>Update</Trans>
                    </div>
                  </DropdownMenuItem>
                }
              />

              <DirectoryMappingDeleteDialog
                mappingId={row.original.id}
                mappingLabel={`${row.original.sourceField}: ${row.original.sourceValue}`}
                trigger={
                  <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                    <div>
                      <Trash2Icon className="mr-2 h-4 w-4" />
                      <Trans>Delete</Trans>
                    </div>
                  </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ] satisfies DataTableColumnDef<(typeof results)['data'][number]>[];
  }, []);

  return (
    <div>
      <DataTable
        columns={columns}
        data={results.data}
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPaginationChange={onPaginationChange}
        error={{ enable: isLoadingError }}
        skeleton={{
          enable: isLoading,
          rows: 3,
          component: (
            <>
              <TableCell className="py-4 pr-4">
                <Skeleton className="h-4 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8 rounded-full" />
              </TableCell>
              <TableCell>
                <div className="flex flex-row justify-end space-x-2">
                  <Skeleton className="h-2 w-6 rounded" />
                </div>
              </TableCell>
            </>
          ),
        }}
      >
        {(table) => <DataTablePagination additionalInformation="VisibleCount" table={table} />}
      </DataTable>
    </div>
  );
};
```

- [ ] **Step 6: Build the route**

Create `apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx`:

```typescript
// ABOUTME: Admin page listing and managing directory sync mapping rules.

import { useEffect, useState } from 'react';

import { useLingui } from '@lingui/react/macro';
import { useLocation, useSearchParams } from 'react-router';

import { useDebouncedValue } from '@documenso/lib/client-only/hooks/use-debounced-value';
import { Input } from '@documenso/ui/primitives/input';

import { DirectoryMappingCreateDialog } from '~/components/dialogs/directory-mapping-create-dialog';
import { SettingsHeader } from '~/components/general/settings-header';
import { AdminDirectoryMappingsTable } from '~/components/tables/admin-directory-mappings-table';

export default function DirectoryMappings() {
  const { t } = useLingui();

  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('query') ?? '');

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 500);

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString());

    params.set('query', debouncedSearchQuery);

    if (debouncedSearchQuery === '') {
      params.delete('query');
    }

    if (params.toString() === searchParams?.toString()) {
      return;
    }

    setSearchParams(params);
  }, [debouncedSearchQuery, pathname, searchParams]);

  return (
    <div>
      <SettingsHeader
        title={t`Directory Mappings`}
        subtitle={t`Map Google directory groups, departments, and org units to Documenso groups`}
        hideDivider
      >
        <DirectoryMappingCreateDialog />
      </SettingsHeader>

      <div className="mt-4">
        <Input
          defaultValue={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t`Search by source value`}
          className="mb-4"
        />

        <AdminDirectoryMappingsTable />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the nav entry**

In `apps/remix/app/routes/_authenticated+/admin+/_layout.tsx`, add `FolderSyncIcon` to the `lucide-react` import list (it is a confirmed export, aliased from `FolderSync`):

```typescript
import {
  AlertTriangleIcon,
  BarChart3,
  Building2Icon,
  FileStack,
  FolderSyncIcon,
  MailIcon,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
```

Insert a new nav button after the Email Domains block (`apps/remix/app/routes/_authenticated+/admin+/_layout.tsx:131-135`), before the Organisation Insights block:

```typescript
          <Button
            variant="ghost"
            className={cn(
              'justify-start md:w-full',
              pathname?.startsWith('/admin/directory-mappings') && 'bg-secondary',
            )}
            asChild
          >
            <Link to="/admin/directory-mappings">
              <FolderSyncIcon className="mr-2 h-5 w-5" />
              <Trans>Directory Mappings</Trans>
            </Link>
          </Button>
```

- [ ] **Step 8: Type-check the remix app**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p apps/remix/tsconfig.json
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/remix/app/components/forms/directory-mapping-form.tsx apps/remix/app/components/dialogs/directory-mapping-create-dialog.tsx apps/remix/app/components/dialogs/directory-mapping-update-dialog.tsx apps/remix/app/components/dialogs/directory-mapping-delete-dialog.tsx apps/remix/app/components/tables/admin-directory-mappings-table.tsx apps/remix/app/routes/_authenticated+/admin+/directory-mappings.tsx apps/remix/app/routes/_authenticated+/admin+/_layout.tsx
git commit -m "feat: add admin UI for directory mappings"
```

---

### Task 10: Full Test Suite Run and Type Check

**Files:** None (verification only)

- [ ] **Step 1: Run all directory sync tests**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run packages/lib/server-only/directory-sync/ packages/lib/server-only/user/sync-google-directory.test.ts packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts
```

Expected: All tests PASS.

- [ ] **Step 2: Run the full lib test suite**

`-w` is `--watch`, not a workspace flag. It hangs forever and must not be used. Scope with `--root` instead:

```bash
cd /Users/HerberR_1/code/documenso && npx vitest run --root packages/lib
```

Expected: All tests PASS, no regressions against Phase 1's directory sync tests or anything else in `packages/lib`. Verified 2026-08-12: 31 test files, 226 tests, all pass, ~3.5s.

- [ ] **Step 3: Run the auth package tests**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx vitest run --root packages/auth
```

Expected: All tests PASS. `handle-oauth-callback-url.ts` changed in Task 5; this catches any regression in the OAuth callback flow. Verified 2026-08-12 (pre-Task-5 baseline): 2 test files, 4 tests, all pass, ~400ms.

- [ ] **Step 4: Type check each touched package**

There is no root `tsconfig.json`, so a bare `tsc --noEmit` from the repo root prints the compiler help text and exits 1 without checking anything. Check each package against its own tsconfig instead:

```bash
cd /Users/HerberR_1/code/documenso && npx -p typescript tsc --noEmit -p packages/prisma/tsconfig.json
npx -p typescript tsc --noEmit -p packages/lib/tsconfig.json
npx -p typescript tsc --noEmit -p packages/auth/tsconfig.json
npx -p typescript tsc --noEmit -p packages/trpc/tsconfig.json
npx -p typescript tsc --noEmit -p apps/remix/tsconfig.json
```

Expected: no new errors in any file this plan created or modified. This repo carries pre-existing type errors unrelated to this plan. Verified 2026-08-12 baseline, before this plan's changes: 59 errors (prisma), 68 (lib), 17 (auth), 50 (trpc), 102 (remix). All of them sit in unrelated files (envelope-router, field-router, organisation-router, team-router, and others). None touch anything named `directory`. Grep each command's output for `directory` and for the paths in this task's Files blocks. Anything there is a real regression. A stable or lower count elsewhere is fine and out of scope for this plan.

- [ ] **Step 5: Lint**

Run:
```bash
cd /Users/HerberR_1/code/documenso && npx turbo run lint
```

Expected: No lint errors in any touched package. Fix and re-run if anything fails; do not disable a rule to silence it.

---

### Task 11: Dev Rollout

Deploys the built image to on-prem dev, confirms the migration applies on boot, and exercises both apply paths (login and sweep) against real data before touching prod. Per this repo's convention, dev is always verified before AWS production.

**Files:** None (deployment and manual verification only)

- [ ] **Step 1: Build and push the image**

Run:
```bash
cd /Users/HerberR_1/code/documenso && docker buildx build --platform linux/amd64 -f docker/Dockerfile --push -t ghcr.io/psd401/documenso:latest .
```

Expected: build succeeds, image pushed to GHCR. On Apple Silicon this requires Colima with Rosetta (`colima start --vm-type=vz --vz-rosetta`) if not already running.

- [ ] **Step 2: Check the dev stack's image pin before deploying**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "grep DOCUMENSO_IMAGE /home/psdadmin/psd401-stack/.env"
```

Expected: `DOCUMENSO_IMAGE=ghcr.io/psd401/documenso:latest`. If it points at a locally built `documenso:<sha>` image instead, edit the `.env` on the host to restore the `:latest` value before continuing, or `docker compose pull` will fail with "pull access denied" and silently leave the old container running.

- [ ] **Step 3: Deploy to dev**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "cd /home/psdadmin/psd401-stack && sudo docker compose pull && sudo docker compose up -d"
```

Expected: `documenso` container recreated with the new image.

- [ ] **Step 4: Confirm the migration applied on boot**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '%add_directory_group_mapping%';\""
```

Expected: one row, `finished_at` populated (not NULL). If `finished_at` is NULL, the app failed to start; check `sudo docker compose logs documenso --tail 100` on the host before continuing.

- [ ] **Step 5: Enable the feature gate on dev**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "grep GOOGLE_DIRECTORY_SYNC_ENABLED /home/psdadmin/psd401-stack/.env || echo 'GOOGLE_DIRECTORY_SYNC_ENABLED=true' | sudo tee -a /home/psdadmin/psd401-stack/.env"
```

If the line was added, restart the app to pick it up:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "cd /home/psdadmin/psd401-stack && sudo docker compose up -d documenso"
```

Expected: `GOOGLE_DIRECTORY_SYNC_ENABLED=true` present in `.env`. Phase 1's own gate must already be enabled on dev for directory data to exist to map against; if the sync itself was never turned on here, that's a prerequisite outside this plan's scope, not a bug in this step.

- [ ] **Step 6: Create a test mapping rule against real dev data**

Log into `https://documenso-dev.psd401.net/admin/directory-mappings` as a system admin (or via `playwright@psd401.net` if that account has admin rights; otherwise use a real admin account). Create a rule with `sourceField: DEPARTMENT`, `sourceValue` set to a department string known to exist on at least one dev user (check `SELECT DISTINCT department FROM "User" WHERE department IS NOT NULL LIMIT 5;` against the dev DB first), targeting an existing `CUSTOM` organisation group.

Expected: the mapping appears in the table with `Active` on.

- [ ] **Step 7: Verify the login-path apply**

Run Playwright locally against dev using the credentials in `packages/app-tests/e2e/fixtures/authentication.ts` (`playwright@psd401.net` / `TestDev2026!`), or sign in manually as a user whose `department` matches the rule from Step 6, via `apiSignin` or the browser.

```bash
cd /Users/HerberR_1/code/documenso && npx playwright test --grep "directory" 2>/dev/null || echo "No dedicated e2e spec for this feature; verify manually via browser login instead."
```

Then confirm the membership landed:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT * FROM \\\"DirectorySyncAuditLog\\\" ORDER BY \\\"createdAt\\\" DESC LIMIT 5;\""
```

Expected: a `MEMBERSHIP_GRANTED` row for the logged-in user, and a new `OrganisationGroupMember` row for that user in the target group.

- [ ] **Step 8: Confirm the sweep job registered at boot**

There is no manual-trigger endpoint for this job. `LocalJobProvider` (`packages/lib/jobs/client/local.ts`) requires a pre-created `BackgroundJob` row and a signed request (via `sign()`) to `/api/jobs/{jobDefinitionId}/{jobId}`. Only the cron poller itself assembles both. Skip any manual-trigger attempt and confirm the poller picked up the job instead.

```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker compose logs documenso --tail 500 | grep '\[JOBS\]: Registered cron job internal.directory-sync-sweep'"
```

Expected: `[JOBS]: Registered cron job internal.directory-sync-sweep (0 9 * * *)`.

- [ ] **Step 9: Wait for the next scheduled run and verify**

The cron fires at 09:00 UTC daily. Note the current UTC time and wait until the next occurrence has passed, then check the summary log line:

```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker compose logs documenso --since 24h | grep '\[directory-sync-sweep\] processed='"
```

Expected: one line per run, e.g. `[directory-sync-sweep] processed=194 synced=194 throttled=0 syncFailures=0 applyFailures=0 granted=1`, `processed` matching dev's Google-linked user count and `granted` matching the users who matched the Step 6 rule.

Then confirm the writes against the DB directly:

```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT COUNT(*) FROM \\\"DirectorySyncAuditLog\\\" WHERE type = 'MEMBERSHIP_GRANTED' AND \\\"createdAt\\\" > NOW() - INTERVAL '1 day';\""
```

```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT COUNT(*) FROM \\\"OrganisationGroupMember\\\" WHERE \\\"createdAt\\\" > NOW() - INTERVAL '1 day';\""
```

Expected: both counts are small and match only the users actually matched by active rules, none unexpected.

---

### Task 12: Prod Enablement

**Do not run this task without Reese's explicit go-ahead.** Dev verification in Task 11 must be green first. This task changes production authentication and authorization behavior for every PSD401 staff login.

**Files:** None (deployment and configuration only)

- [ ] **Step 1: Confirm Task 11's dev verification is complete**

Do not proceed unless every step in Task 11 passed. If any step in Task 11 failed and was worked around rather than fixed, stop and re-verify on dev before touching prod.

- [ ] **Step 2: Get Reese's go-ahead**

Ask Reese directly: "Dev verification for directory sync Phase 2 is green. Ready to enable on prod?" Do not proceed past this step without an explicit yes.

- [ ] **Step 3: Copy the Google service account key from dev to prod**

Prod has no service account key today (confirmed in the spec's current-state check: "No `GOOGLE_*` env vars and no service account key on the EC2 host"). Enabling Phase 1 sync on prod is this plan's Goal 1, so this step provisions it. The key never passes through chat; it moves host-to-host via your machine as a relay.

First, find the key's filename on dev:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "grep GOOGLE_SERVICE_ACCOUNT_KEY_FILE /home/psdadmin/psd401-stack/.env"
```

Copy it from dev to a local scratch path, then to prod at the same relative location under the stack directory, then remove the local copy:
```bash
scp -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60:/home/psdadmin/psd401-stack/<key-filename> /tmp/psd401-directory-sync-key.json
scp -i ~/.ssh/psd401-documenso-n8n.pem /tmp/psd401-directory-sync-key.json ubuntu@documenso.psd401.net:/home/ubuntu/psd401-stack/<key-filename>
rm /tmp/psd401-directory-sync-key.json
```

Replace `<key-filename>` with the value from the `grep` output before running. Expected: the key file exists at the same path on both hosts.

- [ ] **Step 4: Pin the new image digest on prod**

Run:
```bash
docker buildx imagetools inspect ghcr.io/psd401/documenso:latest | grep Digest
```

Edit `docker-compose.yml` on the prod host to pin that digest (prod tracks a digest, not `:latest`):
```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "cd /home/ubuntu/psd401-stack && sed -i 's|ghcr.io/psd401/documenso@sha256:[a-f0-9]*|ghcr.io/psd401/documenso@sha256:<new-digest>|' docker-compose.yml"
```

Replace `<new-digest>` with the value from the `imagetools inspect` output before running.

- [ ] **Step 5: Deploy the new image to prod**

Run:
```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "cd /home/ubuntu/psd401-stack && docker compose pull && docker compose up -d documenso"
```

Expected: container recreated. Confirm the migration applied the same way as Task 11 Step 4, against the prod DB.

- [ ] **Step 6: Add the sync env vars and enable the feature gate on prod**

Get the admin email and key filename dev already uses, so prod matches exactly:
```bash
ssh -i ~/.ssh/id_ed25519 psdadmin@10.0.70.60 "grep -E 'GOOGLE_DIRECTORY_ADMIN_EMAIL|GOOGLE_SERVICE_ACCOUNT_KEY_FILE' /home/psdadmin/psd401-stack/.env"
```

Append the three required vars to prod's `.env`, using the values from the command above:
```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "cat <<'EOF' | sudo tee -a /home/ubuntu/psd401-stack/.env
GOOGLE_DIRECTORY_SYNC_ENABLED=true
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=<same-path-as-dev>
GOOGLE_DIRECTORY_ADMIN_EMAIL=<same-value-as-dev>
EOF"
```

Replace `<same-path-as-dev>` and `<same-value-as-dev>` with the actual values before running. Restart to pick up the new env vars:
```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "cd /home/ubuntu/psd401-stack && docker compose up -d documenso"
```

Expected: all three vars present in prod's `.env`, container restarted.

- [ ] **Step 7: Verify with zero mapping rules first**

Before creating any prod mapping rule, confirm the feature is inert with none configured: log into `https://documenso.psd401.net/admin/directory-mappings`, confirm the table is empty, and confirm a normal staff login still succeeds and creates no unexpected `OrganisationGroupMember` rows.

- [ ] **Step 8: Create the first real prod mapping rule**

With Reese present, create one low-risk mapping rule (a single department or group, targeting a group Reese names). Do not bulk-create rules in this step.

- [ ] **Step 9: Verify the first sweep on prod**

There is no manual-trigger endpoint for this job (same constraint as Task 11 Step 8). Confirm the cron registered, then wait for the 09:00 UTC run:

```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "sudo docker compose logs documenso --tail 500 | grep '\[JOBS\]: Registered cron job internal.directory-sync-sweep'"
```

Expected: `[JOBS]: Registered cron job internal.directory-sync-sweep (0 9 * * *)`. After the next 09:00 UTC has passed:

```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "sudo docker compose logs documenso --since 24h | grep '\[directory-sync-sweep\] processed='"
```

Expected: one `[directory-sync-sweep] processed=... synced=... throttled=... syncFailures=... applyFailures=... granted=...` line, `processed` near 285 (all Google-linked prod users) and `granted` matching only the one rule created in Step 8.

```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT * FROM \\\"DirectorySyncAuditLog\\\" WHERE type = 'MEMBERSHIP_GRANTED' ORDER BY \\\"createdAt\\\" DESC LIMIT 10;\""
```

Expected: audit rows matching only the one rule created in Step 8, no unexpected matches. Confirm with Reese before creating any additional rules.

- [ ] **Step 10: Confirm Goal 1: directory columns populated fleet-wide**

The sweep calls `syncGoogleDirectory` for every Google-linked user regardless of any mapping rule (Task 6). This is Goal 1 from the plan's opening line and the spec's Goal 1: "Enable Phase 1 data sync on prod for all users." Verify it directly against the prod DB, after the sweep in Step 9 has run:

```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT COUNT(*) FROM \\\"User\\\" WHERE \\\"directoryLastSyncedAt\\\" IS NOT NULL;\""
```

```bash
ssh -i ~/.ssh/psd401-documenso-n8n.pem ubuntu@documenso.psd401.net "sudo docker exec psd401-stack-postgres-1 psql -U documenso -d documenso -c \"SELECT COUNT(*) FROM \\\"User\\\" WHERE department IS NOT NULL;\""
```

Expected: both counts near 285, matching the spec's current-state count of Google-linked prod users (`0/285 users synced` before this plan). A count far below 285 is not a failure on the first day. It means most users have not logged in or been swept yet, and the count should climb over subsequent logins and nightly sweeps.

- [ ] **Step 11: Update the district's backup verification expectations**

No action required in this plan. Note only: `DirectoryGroupMapping` and `DirectorySyncAuditLog` rows are covered by the existing nightly `pg_dump` in `backup.sh`; no change needed there.
