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

Peninsula School District No. 401's fork of [Documenso](https://documenso.com).
The root `package.json` version field is `2.18.0`; the fork's upstream base is
not recorded in the manifest. The district runs it in place of
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
# Unit + integration (vitest, per package; the root has no test script)
cd packages/lib && npm run test    # = vitest run

# End-to-end (Playwright); the script starts the Remix server itself
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
- **Identity**: Google SSO. Every new user is placed in the PSD401 org's
  baseline groups at sign-up and again on each Google login and nightly sweep.
  Google Directory Sync and an admin-managed directory-to-group mapping system
  grant (and, in the nightly sweep only, revoke) membership, and directory data
  can never confer ADMIN. See
  [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md)
  and [identity/teams-and-access.md](identity/teams-and-access.md).
- **Fork-specific changes**: Enterprise Edition unlocked, Stripe billing
  stripped, self-hosted plan limits raised to effectively unlimited, and the
  upstream `/api/webhook/trigger` route removed. See
  [fork/changes.md](fork/changes.md).
- **Operations**: on-prem dev then AWS production, GHCR image builds,
  digest-pinned prod deploys, nightly S3 backups. See
  [operations/deployment.md](operations/deployment.md). GitHub Actions
  workflows (CI, the manual image publish, Claude review, security scan, and
  OpenWiki update), with SHA-pinned actions, are in
  [operations/ci-and-automation.md](operations/ci-and-automation.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md).

## Task routing

Start from the row that matches your change. Paths are repository-relative;
`packages/lib` commands run from that directory with its package-local
vitest config.

| Change area or intent | Wiki page | First source entry points | Key symbols | Focused tests | Minimal validation |
|---|---|---|---|---|---|
| Directory sync grants, revocations, circuit breaker | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/apply-directory-mappings.ts`, `plan-directory-membership.ts`, `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.ts` | `applyDirectoryMappings`, `planDirectoryMembership`, `exceedsRevokeCircuitBreaker` | `packages/lib/server-only/directory-sync/*.test.ts`, `packages/lib/jobs/definitions/internal/directory-sync-sweep.handler.test.ts` | `cd packages/lib && npx vitest run --project unit directory-sync --reporter=dot` |
| Directory mapping admin rules (ADMIN guard) | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/assert-mapping-target-allowed.ts`, `packages/trpc/server/admin-router/` | `assertMappingTargetAllowed`, `assertGroupsNotDirectoryMapped`, `ADMIN_GRANTING_GROUP_WHERE` | `assert-mapping-target-allowed.test.ts` | `cd packages/lib && npx vitest run --project unit assert-mapping-target-allowed --reporter=dot` |
| Sign-up and login baseline membership | [identity/sso-and-provisioning.md](identity/sso-and-provisioning.md) | `packages/lib/server-only/directory-sync/psd401-membership.ts`, `packages/lib/server-only/user/create-user.ts`, `packages/auth/server/lib/utils/handle-oauth-callback-url.ts` | `ensurePsd401BaselineMembership`, `onCreateUserHook`, `pickPrimaryMemberRow` | `psd401-membership.test.ts`, `create-user.test.ts` | `cd packages/lib && npx vitest run --project unit psd401-membership create-user --reporter=dot` |
| Team and organisation group roles | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/trpc/server/team-router/create-team-groups.ts`, `update-team-group.ts`, `packages/trpc/server/organisation-router/update-organisation-group.ts` | `assertGroupsNotDirectoryMapped`, `TeamGroup`, `OrganisationGroup` | `assert-mapping-target-allowed.test.ts` (guard logic) | `cd packages/lib && npx vitest run --project unit assert-mapping-target-allowed --reporter=dot` |
| Folder and document visibility | [identity/teams-and-access.md](identity/teams-and-access.md) | `packages/lib/utils/folder-access.ts`, `packages/lib/server-only/envelope/find-envelopes.ts` | `buildFolderAccessFilter`, `TEAM_DOCUMENT_VISIBILITY_MAP` | No dedicated test file found; evidence gap | `npx -p typescript tsc --noEmit` |
| Public API v2 tokens | [integrations/api-and-n8n.md](integrations/api-and-n8n.md) | `packages/lib/server-only/public-api/get-api-token-by-token.ts`, `packages/trpc/server/trpc.ts` | `getApiTokenByToken`, `ApiToken.teamId` | No dedicated test file found; evidence gap | `npx -p typescript tsc --noEmit` |
| Background jobs and PDF conversion | [architecture/jobs-and-pdf-pipeline.md](architecture/jobs-and-pdf-pipeline.md) | `packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts`, `packages/lib/server-only/utils/convert-to-pdf.ts`, `decrypt-pdf.ts` | `jobs.triggerJob`, `convertToPdf`, `decryptPdf` | `convert-to-pdf.test.ts`, `decrypt-pdf.test.ts`; `*.integration.test.ts` skip without binaries | `cd packages/lib && npx vitest run --project unit convert-to-pdf decrypt-pdf --reporter=dot` |
| Removed upstream routes and fork deviations | [fork/changes.md](fork/changes.md) | `packages/lib/utils/webhook-trigger-route-removed.test.ts` (guard), `apps/remix/app/routes/api+/stripe.webhook.ts` | `webhook.trigger` (removed) | `webhook-trigger-route-removed.test.ts` | `cd packages/lib && npx vitest run --project unit webhook-trigger-route-removed --reporter=dot` |
| GitHub Actions workflows and action pinning | [operations/ci-and-automation.md](operations/ci-and-automation.md) | `.github/workflows/ci.yml`, `build-psd401.yml`, `claude-review.yml`, `security-scan.yml`, `openwiki-update.yml` | `build_docker` job, `uses:` SHA pins | None (no workflow linter in the repo) | `grep -rn "uses:" .github \| grep -vE "@[0-9a-f]{40}" \| grep -v "uses: ./"` (expect no output) |
| Image runtime dependencies and deployment | [operations/deployment.md](operations/deployment.md) | `docker/Dockerfile`, `deploy/docker-compose.dev.yml` | `docker/Dockerfile` runner stage | `build_docker` smoke test in `ci.yml` | Conditional and expensive: `docker build -f docker/Dockerfile .` only when the image changes |

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| `CLAUDE.md` (root) | Gitignored local file (see `.gitignore`), not in the tracked tree. Its dev/prod environment and gotcha notes are referenced by several pages but cannot be verified from the repository |
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

- Other GitHub Actions workflows: `.github/workflows/deploy.yml`,
  `publish.yml`, `e2e-tests.yml`, `codeql-analysis.yml`, the `translations-*`
  sync workflows, labelers, and `stale.yml`. Not documented in depth because
  no change in the last documented range touched them and no change-routing
  path depends on them; expand [operations/ci-and-automation.md](operations/ci-and-automation.md)
  when one changes.
