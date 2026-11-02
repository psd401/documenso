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
  [operations/deployment.md](operations/deployment.md). The GitHub Actions
  workflows, SHA-pinned actions, and the security-scan allowlist are in
  [operations/ci-and-workflows.md](operations/ci-and-workflows.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation. The
  unauthenticated `/api/webhook/trigger` route was removed.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md).

## Task routing

Start from the row that matches the change. Each route names the first
implementation symbols, focused tests, and the narrowest validation command.
Run unit tests from the package directory; the `unit` project excludes
`*.integration.test.ts`.

| Change area or intent | Wiki page | Entry points and symbols | Focused tests | Minimal validation |
|---|---|---|---|---|
| Directory sync grant or revoke behavior | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/apply-directory-mappings.ts` (`applyDirectoryMappings`, `applyDirectoryRevocations`); `plan-directory-membership.ts` (`planDirectoryMembership`, `groupGrantsAdmin`); `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts` | `apply-directory-mappings.test.ts`, `plan-directory-membership.test.ts`, `directory-sync-sweep.handler.test.ts` | `cd packages/lib && npx vitest run --project unit server-only/directory-sync` |
| Directory mapping admin CRUD or ADMIN rejection | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `assert-mapping-target-allowed.ts` (`assertMappingTargetAllowed`, `assertGroupsNotDirectoryMapped`, `ADMIN_GRANTING_GROUP_WHERE`); `create-directory-mapping.ts`, `update-directory-mapping.ts` | `assert-mapping-target-allowed.test.ts`, `create-directory-mapping.test.ts`, `update-directory-mapping.test.ts` | `cd packages/lib && npx vitest run --project unit server-only/directory-sync` |
| Team or organisation group ADMIN roles | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/trpc/server/team-router/create-team-groups.ts`, `update-team-group.ts`; `packages/trpc/server/organisation-router/update-organisation-group.ts` | None located; router guards are not directly tested | `npx tsc --noEmit` in the affected package |
| Folder and document visibility | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/lib/utils/folder-access.ts` (`buildFolderAccessFilter`); `packages/lib/server-only/envelope/find-envelopes.ts`; `packages/lib/server-only/document/find-documents.ts` | None located in this pass | `npx tsc --noEmit` in the affected package |
| Public API token scope and `folderId` queries | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `packages/lib/server-only/public-api/get-api-token-by-token.ts`; `packages/trpc/server/trpc.ts`; `packages/lib/server-only/envelope/find-envelopes.ts` | None located in this pass | `npx tsc --noEmit` in the affected package |
| Webhook route surface (removed `/api/webhook/trigger`) | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `apps/remix/app/routes/api+/stripe.webhook.ts` | `packages/lib/utils/webhook-trigger-route-removed.test.ts` | `cd packages/lib && npx vitest run --project unit webhook-trigger-route-removed` |
| Background jobs and provider delivery | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/jobs/client/local.ts` (`triggerJob`, `getApiHandler`); `packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts` | None located in this pass | `npx tsc --noEmit` in `packages/lib`, then `cd packages/lib && npx vitest run --project unit <test file>` for the job under change |
| DOCX conversion and encrypted PDF handling | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/server-only/utils/convert-to-pdf.ts`; `decrypt-pdf.ts`; `packages/lib/server-only/pdf/normalize-pdf.ts` | `convert-to-pdf.integration.test.ts`, `decrypt-pdf.integration.test.ts` (self-skip without `soffice`/`qpdf`) | `cd packages/lib && npx vitest run --project integration convert-to-pdf decrypt-pdf` (the tests skip themselves when a binary is missing, so check `command -v soffice qpdf` first) |
| Docker image, on-prem dev stack, prod deploy | [operations/deployment.md](operations/deployment.md) | `docker/Dockerfile`; `deploy/docker-compose.dev.yml`; `.github/workflows/build-psd401.yml` | Runtime smoke test in `.github/workflows/ci.yml` `build_docker` | `docker run --rm <image> sh -c 'command -v soffice'` (also `qpdf`, `fc-list`) |
| GitHub Actions, SHA pinning, secret scope, gitleaks allowlist | [operations/ci-and-workflows.md](operations/ci-and-workflows.md) | `.github/workflows/ci.yml`, `security-scan.yml`, `claude-review.yml`, `openwiki-update.yml`; `.gitleaksignore` | None (CI itself is the check) | Open a pull request and read the relevant CI job result |
| Fork billing gates and self-hosted limits | [fork/changes.md](fork/changes.md) | `packages/ee/server-only/limits/server.ts`; `packages/lib/server-only/organisation/create-organisation.ts` | None located in this pass | `npx tsc --noEmit` in the affected package |

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| [`CLAUDE.md`](../CLAUDE.md) | Intended home of the dense gotchas list and dev/prod access details. In the current checkout it is an untracked, 7-line OpenWiki pointer stub, so those details are not verifiable here (see [Backlog](#backlog)) |
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

Areas found in the sources that this wiki does not yet document in depth.

- **Operational access details (evidence-blocked).** Dev and prod
  environment details, Playwright dev credentials, n8n host details, and the
  backup schedule are described as living in root `CLAUDE.md`. That file is an
  untracked, 7-line OpenWiki pointer stub in this checkout. Source anchors:
  [`CLAUDE.md`](../CLAUDE.md), with references in
  [operations/deployment.md](operations/deployment.md) and
  [integrations/api-and-n8n.md](integrations/api-and-n8n.md). Restore the file
  or document the facts elsewhere before adding them here.
- **Upstream packages with no PSD401-specific behavior.** `packages/api`
  (REST v1), `packages/signing`, `packages/auth`, and `apps/openpage-api` are
  listed in [architecture/overview.md](architecture/overview.md) but not
  documented beyond that table. This is out of scope for the fork-focused wiki
  unless a PSD401 change touches them.
- **Router-level ADMIN guards lack direct tests.** Coverage is in
  [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md#source-references)
  (`assertGroupsNotDirectoryMapped` callers in `packages/trpc/server/`). Add a
  focused router test before relying on those guards in new code.
