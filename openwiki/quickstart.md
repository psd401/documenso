---
type: Overview
title: Documenso (PSD401 Fork)
description: >
  Peninsula School District's fork of Documenso, an open-source e-signature
  platform, run as the district's DocuSign replacement. Remix (React Router)
  app on a Hono server, tRPC + Prisma + Postgres, self-hosted on-prem and on
  AWS. Enterprise features unlocked, Stripe billing stripped.
tags: [overview, psd401, documenso, e-signature]
---

# Documenso (PSD401 Fork)

Peninsula School District No. 401's fork of [Documenso](https://documenso.com),
based on upstream `v2.9.1` (`package.json`). The district runs it in place of
DocuSign for signature workflows (Technology Use Agreements, transfer forms,
HR paperwork). The fork unlocks Documenso's Enterprise Edition feature set,
strips Stripe billing, and adds PSD401-specific identity provisioning
(Google SSO auto-join, Google Directory Sync, directory-to-group mappings).

## Quick start (local development)

```bash
# Start Postgres + Inbucket (local SMTP catcher)
docker compose -f docker/development/compose.yml up -d

# Install deps, run migrations, seed the DB
npm ci
npm run prisma:migrate-dev
npm run prisma:seed

# Compile translations, then start the Remix dev server
npm run dev
```

Use `bun` where the project scripts allow it; `npm`/`npx` is what the
repo's own `package.json` scripts invoke directly (see
[`package.json`](../package.json)). Do not run `npm run build` to verify
changes — use `npx -p typescript tsc --noEmit` for type checking
(`CLAUDE.md`).

An alternative container-based dev stack, closer to what runs at
`documenso-dev.psd401.net`, lives at
[`deploy/docker-compose.dev.yml`](../deploy/docker-compose.dev.yml): it
builds the production `docker/Dockerfile` image locally and points it at a
Postgres container and an Inbucket mail catcher, with billing left enabled
so enterprise feature gates can be exercised.

## Tests

```bash
# Unit + integration (vitest, per-package)
npm run test    # (or the package-local vitest config)

# End-to-end (Playwright), against a running app
npm run test:e2e
```

Vitest splits into two projects per
[`packages/lib/vitest.config.ts`](../packages/lib/vitest.config.ts): `unit`
(`*.test.ts`, 5s timeout) and `integration` (`*.integration.test.ts`, 60s
timeout, 30s hook timeout). Integration tests that need `soffice`/`qpdf`
skip themselves at runtime via `describe.skipIf(!binaryExists(...))`, e.g.
[`packages/lib/server-only/utils/convert-to-pdf.integration.test.ts`](../packages/lib/server-only/utils/convert-to-pdf.integration.test.ts).
Playwright E2E tests authenticate via email/password
(`packages/app-tests/e2e/fixtures/authentication.ts`), bypassing Google
OAuth — see [operations/deployment.md](operations/deployment.md) for the
dev-environment credentials.

## Architecture at a glance

- **Monorepo**: npm workspaces + Turborepo, `apps/*` and `packages/*`. See
  [architecture/overview.md](architecture/overview.md).
- **Data model**: documents are wrapped in `Envelope` records that hold one
  or more `EnvelopeItem`s (multi-document signing packets), plus
  `Recipient`/`Field`/`Folder`. See [architecture/data-model.md](architecture/data-model.md).
- **Background jobs & PDF pipeline**: async email/seal/webhook jobs, plus
  DOCX/DOC-to-PDF conversion (LibreOffice) and encrypted-PDF decryption
  (qpdf). See [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md).
- **Identity**: Google SSO with auto-join to the PSD401 organisation,
  Google Directory Sync, and an admin-managed directory-to-group mapping
  system. See [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md)
  and [identity/teams-and-access.md](identity/teams-and-access.md).
- **Fork-specific changes**: Enterprise Edition unlocked, Stripe billing
  stripped, self-hosted plan limits raised to effectively unlimited. See
  [fork/changes.md](fork/changes.md).
- **Operations**: on-prem dev then AWS production, GHCR image builds,
  digest-pinned prod deploys, nightly S3 backups. See
  [operations/deployment.md](operations/deployment.md). CI, the security
  scan, the Claude review gate, and release workflows are in
  [operations/ci-and-security.md](operations/ci-and-security.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md).

## Where to start for a change

Use this table to go from an intent to the owning page, first source files,
and narrow check. Test commands run from the package directory (`vitest run`
is the package `test` script).

| Change area or intent | Wiki page | Entry points | Key symbols | Focused tests | Minimal validation |
|---|---|---|---|---|---|
| Sign-up auto-join to the PSD401 org and baseline groups | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/user/create-user.ts`, `packages/lib/server-only/directory-sync/psd401-membership.ts`, `packages/lib/constants/psd401.ts` | `onCreateUserHook`, `ensurePsd401BaselineMembership`, `PSD401_BASELINE_GROUP_IDS` | `packages/lib/server-only/user/create-user.test.ts` | `cd packages/lib && npx vitest run server-only/user/create-user.test.ts` |
| Directory sync: mappings, grants, revocations, sweep | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/apply-directory-mappings.ts`, `plan-directory-membership.ts`, `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts` | `applyDirectoryMappings`, `applyDirectoryRevocations`, `planDirectoryMembership`, `getDirectorySyncRevokeMode` | `packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts`, `mapping-matching.test.ts` | `cd packages/lib && npx vitest run server-only/directory-sync` |
| Folder listing and visibility | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/lib/server-only/folder/find-folders.ts`, `packages/lib/server-only/envelope/find-envelopes.ts` | `findFolders`, `findEnvelopes` | none located | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| Background jobs and job API | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/jobs/client.ts`, `packages/lib/jobs/client/local.ts` | `jobsClient`, `LocalJobProvider.triggerJob`, `LocalJobProvider.getApiHandler` | `packages/lib/jobs/client/client.test.ts` | `cd packages/lib && npx vitest run jobs/client/client.test.ts` |
| Webhook dispatch and the removed trigger route | [fork/changes.md](fork/changes.md) | `packages/lib/server-only/webhooks/trigger/trigger-webhook.ts`, `packages/lib/jobs/definitions/internal/execute-webhook.ts` | `triggerWebhook`, `EXECUTE_WEBHOOK_JOB_DEFINITION` | `packages/lib/utils/webhook-trigger-route-removed.test.ts` | `cd packages/lib && npx vitest run utils/webhook-trigger-route-removed.test.ts` |
| Public API v2 tokens and team scope | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `packages/lib/server-only/public-api/get-api-token-by-token.ts`, `packages/trpc/server/trpc.ts` | `getApiTokenByToken`, `authenticatedMiddleware` | none located | `npx tsc --noEmit -p packages/trpc/tsconfig.json` |
| Enterprise gating and self-hosted limits | [fork/changes.md](fork/changes.md) | `packages/ee/server-only/limits/server.ts`, `packages/ee/server-only/limits/constants.ts` | `getServerLimits`, `SELFHOSTED_PLAN_LIMITS` | none located | `npx tsc --noEmit -p packages/ee/tsconfig.json` |
| Data model (envelopes, recipients, fields) | [architecture/data-model.md](architecture/data-model.md) | `packages/prisma/schema.prisma` | `Envelope`, `EnvelopeItem`, `Recipient`, `Field` | none located | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| CI, security scan, review gate, release workflows | [operations/ci-and-security.md](operations/ci-and-security.md) | `.github/workflows/ci.yml`, `security-scan.yml`, `claude-review.yml`, `deploy.yml` | n/a (YAML workflows) | none | `grep -rnE "uses: [^./]+@v[0-9]" .github/workflows` (expect no output) |
| Image build and deployment environment | [operations/deployment.md](operations/deployment.md) | `deploy/docker-compose.dev.yml`, `docker/Dockerfile`, `.github/workflows/build-psd401.yml` | n/a (compose and Dockerfile) | none | `docker compose -f docker/development/compose.yml config -q` |

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| `CLAUDE.md` (repo root, gitignored) | Dense gotchas list (bugs hit and fixed, footguns) plus environment/access details for dev and prod. It is not in the tracked tree, so this wiki cannot verify its contents; tracked agent guidance is in [`AGENTS.md`](../AGENTS.md) |
| [`docs/feature-backlog.md`](../docs/feature-backlog.md) | Requested features not yet built |
| [`docs/superpowers/plans/`](../docs/superpowers/plans/) and [`docs/superpowers/specs/`](../docs/superpowers/specs/) | Implementation plans and design specs for fork-specific features (AWS cutover, Google Directory Sync phases, team merge, field transparency) |

## What this wiki does not re-document

This wiki focuses on what's PSD401-specific or load-bearing for operating
the fork: identity/provisioning, the fork's deviations from upstream, and
day-to-day operations. It does not re-document upstream Documenso's UI
workflows, the full tRPC/REST API surface, or every provider option
(`ARCHITECTURE.md` already covers the swappable Storage/Signing/Email/Jobs
providers upstream supports).
