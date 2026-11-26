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
changes — use `npx tsc --noEmit -p <package>/tsconfig.json` for type checking
([`AGENTS.md`](../AGENTS.md)).

An alternative container-based dev stack, closer to what runs at
`documenso-dev.psd401.net`, lives at
[`deploy/docker-compose.dev.yml`](../deploy/docker-compose.dev.yml): it
builds the production `docker/Dockerfile` image locally and points it at a
Postgres container and an Inbucket mail catcher, with billing left enabled
so enterprise feature gates can be exercised.

## Tests

```bash
# Unit + integration (vitest, package-local config)
npm run test -w @documenso/lib

# End-to-end (Playwright), against a running app
npm run test:e2e -w @documenso/app-tests
```

The root `package.json` in this checkout has no `test` or `test:e2e` script.
The root `ci` script runs `turbo run test:e2e`. [`AGENTS.md`](../AGENTS.md)
lists a root-level `npm run test:e2e`, which does not exist here, so use the
workspace form above.

Vitest splits into two projects per
[`packages/lib/vitest.config.ts`](../packages/lib/vitest.config.ts): `unit`
(`*.test.ts`, 5s timeout) and `integration` (`*.integration.test.ts`, 60s
timeout, 30s hook timeout). Integration tests that need `soffice`/`qpdf`
skip themselves at runtime via `describe.skipIf(!binaryExists(...))`, e.g.
[`packages/lib/server-only/utils/convert-to-pdf.integration.test.ts`](../packages/lib/server-only/utils/convert-to-pdf.integration.test.ts).
Playwright E2E tests authenticate via email/password
(`packages/app-tests/e2e/fixtures/authentication.ts`), bypassing Google
OAuth. The dev-environment credentials are kept outside the repository; see
[operations/deployment.md](operations/deployment.md#playwright-e2e-credentials-dev-only).

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
  [operations/deployment.md](operations/deployment.md). GitHub Actions
  triggers, E2E sharding, and the scoped automation secrets are in
  [operations/ci-and-automation.md](operations/ci-and-automation.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md).

## Where to start for a change

Pick the row closest to your change, open its page, then the entry points. The
validation commands are narrow and quiet; run them before any broader check.

| Change area or intent | Wiki page | Entry points (files and symbols) | Focused tests | Minimal validation |
|---|---|---|---|---|
| Directory sync matching, grants, revocations, sweep breaker | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `planDirectoryMembership`, `applyDirectoryMappings` in `packages/lib/server-only/directory-sync/`; `run` in `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts` | `plan-directory-membership.test.ts`, `apply-directory-mappings.test.ts`, `directory-sync-sweep.handler.test.ts` | `npm run test -w @documenso/lib -- --reporter=dot directory-sync` |
| ADMIN grants on org or team groups, mapping admin guards | [identity/teams-and-access.md](identity/teams-and-access.md#admin-grants-on-directory-mapped-groups) | `assertGroupsNotDirectoryMapped`, `assertMappingTargetAllowed` in `assert-mapping-target-allowed.ts`; `updateOrganisationGroupRoute`, `createTeamGroupsRoute`, `updateTeamGroupRoute` | `assert-mapping-target-allowed.test.ts` (no route-level test) | `npm run test -w @documenso/lib -- --reporter=dot assert-mapping-target-allowed` |
| Folder visibility, folder allow-lists, bulk move destinations | [identity/teams-and-access.md](identity/teams-and-access.md#folder-access-control) | `buildFolderAccessFilter` in `packages/lib/utils/folder-access.ts`; `bulkMoveEnvelopesRoute` in `packages/trpc/server/envelope-router/bulk-move-envelopes.ts` | `bulk-move-envelopes.test.ts` (no vitest config in `packages/trpc`); no dedicated folder-access test | `npx tsc --noEmit -p packages/trpc/tsconfig.json` |
| Background jobs and the local job provider | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `triggerJob()`, `getApiHandler()` in `packages/lib/jobs/client/local.ts`; seal sweep in `seal-document-sweep.handler.ts` | no focused job test identified | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| DOCX/DOC conversion and encrypted-PDF handling | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md#pdf-pipeline) | `packages/lib/server-only/utils/convert-to-pdf.ts` | `convert-to-pdf.integration.test.ts` (skips without `soffice`/`qpdf`) | `npm run test -w @documenso/lib -- --reporter=dot convert-to-pdf` |
| Public API v2 tokens and folder-scoped envelope queries | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `getApiTokenByToken` in `packages/lib/server-only/public-api/get-api-token-by-token.ts`; `findEnvelopes` in `packages/lib/server-only/envelope/find-envelopes.ts` | no focused test identified | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| Removed webhook trigger route; Stripe webhook route | [fork/changes.md](fork/changes.md#removed-surfaces) | `apps/remix/app/routes/api+/stripe.webhook.ts` | `webhook-trigger-route-removed.test.ts` | `npm run test -w @documenso/lib -- --reporter=dot webhook-trigger-route-removed` |
| Fork billing, self-hosted limits, enterprise gates | [fork/changes.md](fork/changes.md) | `SELFHOSTED_PLAN_LIMITS` in `packages/ee/server-only/limits/constants.ts`; `createOrganisation` in `packages/lib/server-only/organisation/create-organisation.ts` | no focused test identified | `npx tsc --noEmit -p packages/lib/tsconfig.json` |
| GitHub Actions triggers, E2E sharding, secret scoping | [operations/ci-and-automation.md](operations/ci-and-automation.md) | `.github/workflows/ci.yml`, `e2e-tests.yml`, `security-scan.yml`, `openwiki-update.yml`; `test:e2e` in `turbo.json` | none (workflows are not unit-tested) | none local; open a pull request, since no workflow linter is configured |
| Local dev stack, image build, deployment | [operations/deployment.md](operations/deployment.md) | `docker/development/compose.yml`, `docker/Dockerfile`, `deploy/docker-compose.dev.yml` | none | `docker compose -f docker/development/compose.yml config --quiet` |
| Monorepo layout, request path, tRPC mounting | [architecture/overview.md](architecture/overview.md) | `apps/remix/server/trpc/hono-trpc-remix.ts`; `packages/trpc/server/router.ts` | none | `npx tsc --noEmit -p packages/trpc/tsconfig.json` |
| Envelope, recipient, field, and folder data model | [architecture/data-model.md](architecture/data-model.md) | `packages/prisma/schema.prisma` | none | `npx tsc --noEmit -p packages/lib/tsconfig.json` |

Conditional, expensive checks: `npm run build` only when a change needs a
build artifact or the user asks for it, since [AGENTS.md](../AGENTS.md) notes
it takes about two minutes. `npm run test:e2e` needs running services (`npm run dx:up`)
and a built app, so use it only for user-visible flows that the unit tests
cannot cover. Opening a pull request is the only source-backed check for
workflow YAML changes, because the repo configures no local workflow linter.

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| [`CLAUDE.md`](../CLAUDE.md) | Gitignored and not tracked; this checkout contains only its OpenWiki pointer. The maintainers' copy holds environment and access details, which this wiki cannot verify (see [evidence gaps](operations/deployment.md#evidence-gaps)). |
| [`AGENTS.md`](../AGENTS.md) | Tracked agent guidance: build and type-check rules, code style, and error-handling conventions |
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

Areas seen in recent changes that this wiki does not document yet:

- **Document editor recipient ordering**: `toEditorFormRecipients` in
  [`packages/lib/client-only/hooks/use-editor-recipients.ts`](../packages/lib/client-only/hooks/use-editor-recipients.ts)
  normalizes recipients into contiguous signing-order slots. No page covers the
  envelope editor yet, and the change is a UI fix rather than an operations concern.
- **Inherited release workflows**: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  fast-forwards `release` from `main` on every tag push, and
  [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) publishes
  Docker images from the release branch. Both come from upstream. The PSD401 image
  path is `build-psd401.yml`, and these two are not verified as part of it, so
  they are not described.
- **Other workflows**: translation sync, labelers, stale-issue, and
  semantic-PR checks under `.github/workflows/`. They did
  not change in this run and carry little operational risk.
- **Seed and copy changes**: `seedDocuments` in
  [`packages/prisma/seed/documents.ts`](../packages/prisma/seed/documents.ts) now
  throws on unsupported document types, and the dashboard copy in
  [`apps/remix/app/routes/_authenticated+/dashboard.tsx`](../apps/remix/app/routes/_authenticated+/dashboard.tsx)
  changed spelling. Both are too small to justify a page.
