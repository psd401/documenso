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
changes — use `npx tsc --noEmit` for type checking (`AGENTS.md`; the root
`CLAUDE.md` is a pointer to it).

An alternative container-based dev stack, closer to what runs at
`documenso-dev.psd401.net`, lives at
[`deploy/docker-compose.dev.yml`](../deploy/docker-compose.dev.yml): it
builds the production `docker/Dockerfile` image locally and points it at a
Postgres container and an Inbucket mail catcher, with billing left enabled
so enterprise feature gates can be exercised.

## Tests

```bash
# Unit + integration (vitest). The root package.json has no test script;
# packages/lib owns the vitest config and the "test" script
npm run test -w @documenso/lib

# Narrow to matching test files (vitest positional filter)
npm run test -w @documenso/lib -- webhook

# End-to-end (Playwright). The app-tests script starts the Remix app itself
npm run test:e2e -w @documenso/app-tests
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
  digest-pinned prod deploys, backups (described in operator notes, not in
  this repo). See [operations/deployment.md](operations/deployment.md). The
  GitHub Actions inventory, release chain, and SHA-pinning/gitleaks policy
  are in [operations/ci-and-security.md](operations/ci-and-security.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md). Outbound
  webhooks (queued as jobs, SSRF-guarded) are in
  [integrations/webhooks.md](integrations/webhooks.md).

## Task routing

Start with the row that matches the change. Source paths are relative to the
repository root; symbols are exported names. Use the focused command first and
widen only when the row says so.

| Change area or intent | Wiki page | Entry points | Key symbols | Focused tests | Minimal validation |
|---|---|---|---|---|---|
| Document events fan out to team webhooks | [integrations/webhooks.md](integrations/webhooks.md) | `packages/lib/server-only/webhooks/trigger/trigger-webhook.ts`, `packages/lib/jobs/definitions/internal/execute-webhook.handler.ts`, `packages/lib/server-only/webhooks/execute-webhook-call.ts` | `triggerWebhook`, `EXECUTE_WEBHOOK_JOB_DEFINITION`, `run`, `executeWebhookCall`, `assertNotPrivateUrl` | `packages/lib/server-only/webhooks/assert-webhook-url.test.ts`, `packages/lib/utils/webhook-trigger-route-removed.test.ts` | `npm run test -w @documenso/lib -- webhook` |
| Public API v2 tokens, team scope, folder filters | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `packages/lib/server-only/public-api/get-api-token-by-token.ts`, `packages/lib/server-only/envelope/find-envelopes.ts` | `getApiTokenByToken`, `findEnvelopes` | none located | `npx tsc --noEmit -p packages/trpc/tsconfig.json` |
| Background job runner and providers | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/jobs/client/local.ts`, `packages/lib/jobs/client/_internal/job.ts` | `LocalJobProvider`, `defineJob`, `triggerJob` | `packages/lib/jobs/client/client.test.ts` | `npm run test -w @documenso/lib -- client.test` |
| DOCX/DOC to PDF conversion, PDF decryption | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/server-only/utils/convert-to-pdf.ts` | `convertToPdf` | `packages/lib/server-only/utils/convert-to-pdf.test.ts`; the `.integration.test.ts` skips itself without `soffice`/`qpdf` | `npm run test -w @documenso/lib -- convert-to-pdf` |
| SSO auto-join, Google directory sync, group mappings | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/apply-directory-mappings.ts`, `packages/lib/jobs/definitions/internal/directory-sync-sweep.ts`, `packages/trpc/server/admin-router/create-directory-mapping.ts` | `getDirectorySyncRevokeMode`, `DIRECTORY_SYNC_SYSTEM_ACTOR` | `packages/lib/server-only/directory-sync/apply-directory-mappings.test.ts`, `packages/lib/server-only/directory-sync/create-directory-mapping.test.ts` | `npm run test -w @documenso/lib -- directory-mapping` |
| Teams, folders, folder access | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/lib/server-only/folder/find-folders.ts` | `findFolders` | none located | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| Enterprise features, self-hosted limits, billing gates | [fork/changes.md](fork/changes.md) | `packages/ee/server-only/limits/server.ts`, `packages/ee/server-only/stripe/`, `packages/lib/server-only/organisation/create-organisation.ts` | `getServerLimits`, `SELFHOSTED_PLAN_LIMITS`, `createOrganisation` | none located | `npx tsc --noEmit -p packages/ee/tsconfig.json` |
| CI, action pins, image builds, release chain | [operations/ci-and-security.md](operations/ci-and-security.md), [operations/deployment.md](operations/deployment.md) | `.github/workflows/ci.yml`, `.github/workflows/build-psd401.yml`, `.github/workflows/deploy.yml`, `.gitleaksignore` | `build_docker` job | none (workflow checks are external tools) | `zizmor --min-severity high .github/workflows` (external tool; see the CI page) |
| Monorepo layout, request path, providers | [architecture/overview.md](architecture/overview.md) | `apps/remix/server/trpc/hono-trpc-remix.ts`, `apps/remix/app/root.tsx` | `appRouter`, `loader` | none | `npx tsc --noEmit -p apps/remix/tsconfig.json` |

Broad type checks are slower. Use them only for changes that span packages.
Do not run `npm run build` for verification (`AGENTS.md`).

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| [`CLAUDE.md`](../CLAUDE.md) | A 7-line pointer to [`AGENTS.md`](../AGENTS.md) in this checkout. The gotcha list and dev/prod environment notes this wiki once cited are not present here |
| [`AGENTS.md`](../AGENTS.md) | Agent instructions: build/test/lint commands and code conventions |
| [`docs/feature-backlog.md`](../docs/feature-backlog.md) | Requested features not yet built |
| [`docs/superpowers/plans/`](../docs/superpowers/plans/) and [`docs/superpowers/specs/`](../docs/superpowers/specs/) | Implementation plans and design specs for fork-specific features (AWS cutover, Google Directory Sync phases, team merge, field transparency) |

## What this wiki does not re-document

This wiki focuses on what's PSD401-specific or load-bearing for operating
the fork: identity/provisioning, the fork's deviations from upstream, and
day-to-day operations. It does not re-document upstream Documenso's UI
workflows, the full tRPC/REST API surface, or every provider option
(`ARCHITECTURE.md` already covers the swappable Storage/Signing/Email/Jobs
providers upstream supports).

## Backlog

Areas identified but not yet documented in depth. Each has a source anchor
and the reason it is deferred.

- **Dev/prod environment notes, backup schedule, E2E credentials, and
  gotcha list** (formerly cited from root `CLAUDE.md`). Evidence-blocked:
  [`CLAUDE.md`](../CLAUDE.md) is a 7-line pointer in this checkout, and the
  notes are not in the repository. Revisit only if they are restored to a
  tracked file.
- **Organisation reusable workflows** (`security-scan`, `claude-review`,
  `openwiki-update`). Evidence-blocked: the logic lives in `PSD401/.github`
  and is not inspectable from this repo. See
  [CI, security scanning, and release workflows](operations/ci-and-security.md).
- **`publish.yml` target namespace** (`ghcr.io/documenso/documenso-*`).
  Open question rather than a documentation gap: confirm whether this
  workflow should run on the fork at all. See
  [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).
- **PDF signing** (`packages/signing`, local P12 vs Google Cloud KMS). Not
  yet documented; the provider choice is summarized in
  [architecture/overview.md](architecture/overview.md) only.
- **Session auth and passkeys** (`packages/auth`: Arctic OAuth, WebAuthn,
  session cookies). Not yet documented; the Google SSO entry points are in
  [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md).
- **Legacy REST API v1** (`packages/api`, deprecated but maintained). Not
  yet documented; only listed in [architecture/overview.md](architecture/overview.md).
- **`apps/openpage-api`** (small Next.js status/analytics API). Not yet
  documented; only listed in [architecture/overview.md](architecture/overview.md).
