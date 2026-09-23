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
  [operations/deployment.md](operations/deployment.md).
- **Integrations**: public API v2 (team-scoped tokens), n8n automation.
  See [integrations/api-and-n8n.md](integrations/api-and-n8n.md).

## Repo-level docs worth knowing about

| Path | Purpose |
|------|---------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Upstream-authored high-level architecture diagram and API/job/provider reference — still accurate for this fork and a good companion to this wiki |
| [`CLAUDE.md`](../CLAUDE.md) | Dense gotchas list (bugs hit and fixed, footguns) plus environment/access details for dev and prod |
| [`docs/feature-backlog.md`](../docs/feature-backlog.md) | Requested features not yet built |
| [`docs/superpowers/plans/`](../docs/superpowers/plans/) and [`docs/superpowers/specs/`](../docs/superpowers/specs/) | Implementation plans and design specs for fork-specific features (AWS cutover, Google Directory Sync phases, team merge, field transparency) |

## What this wiki does not re-document

This wiki focuses on what's PSD401-specific or load-bearing for operating
the fork: identity/provisioning, the fork's deviations from upstream, and
day-to-day operations. It does not re-document upstream Documenso's UI
workflows, the full tRPC/REST API surface, or every provider option
(`ARCHITECTURE.md` already covers the swappable Storage/Signing/Email/Jobs
providers upstream supports).
