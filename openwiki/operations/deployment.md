---
type: Operations
title: Deployment
description: >
  Local development, on-prem dev, AWS production, the GHCR build
  workflow, and backups.
tags: [operations, deployment, docker, aws, ghcr]
---

# Deployment

PSD401 always deploys to on-prem dev first, verifies, then promotes to
AWS production — never skip dev (`CLAUDE.md`).

## Local development

```bash
docker compose -f docker/development/compose.yml up -d
npm ci
npm run prisma:migrate-dev
npm run prisma:seed
npm run dev
```

See [quickstart.md](../quickstart.md) for the full command list and test
commands.

## On-prem dev container stack

[`deploy/docker-compose.dev.yml`](../../deploy/docker-compose.dev.yml)
builds the fork's own `docker/Dockerfile` locally (rather than pulling a
published image) and runs it against a Postgres 17 container and an
Inbucket SMTP catcher (web UI on 9000, SMTP on 2500) — no real email is
sent. Notable settings baked into that file (all non-secret, dev-only
values, safe to read from the compose file itself):

- `NEXT_PUBLIC_UPLOAD_TRANSPORT: database` — uploads stored as Base64 in
  Postgres, matching prod's storage choice.
- `NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH: /opt/documenso/cert.p12`,
  bind-mounted from `./cert.p12` — local P12 signing, not Google KMS.
  `NEXT_PRIVATE_SIGNING_PASSPHRASE: 'documenso-demo'` (a placeholder,
  rotated for real environments).
  `NEXT_PRIVATE_ENCRYPTION_KEY`/`NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`
  are inline dev-only test values in this file — not the values used
  anywhere real.
- `NEXT_PUBLIC_FEATURE_BILLING_ENABLED: 'true'` — deliberately left on
  in this compose file so the enterprise feature gates can be exercised
  during testing (contrast with prod, which runs it `false`; see
  [fork/changes.md](../fork/changes.md)).
- `extra_hosts: license.documenso.com:127.0.0.1` — blackholes upstream's
  license-check host.

The district's actual on-prem dev environment
(`documenso-dev.psd401.net`, Proxmox VM, Docker Compose with Caddy +
Postgres + the published `ghcr.io/psd401/documenso:latest` image) is
documented in the root [`CLAUDE.md`](../../CLAUDE.md#dev-on-prem)
Environments section — access details, SSH, and DB commands live there
rather than duplicated here, since they involve internal hostnames/IPs.

### Playwright E2E credentials (dev only)

`packages/app-tests/e2e/fixtures/authentication.ts`'s `apiSignin()` posts
to `/api/auth/email-password/authorize`, bypassing Google OAuth — used by
Playwright specs against the dev environment. Credentials are documented
in root `CLAUDE.md`.

## Building and publishing the image

[`.github/workflows/build-psd401.yml`](../../.github/workflows/build-psd401.yml) —
**manual dispatch only** (`workflow_dispatch`, not triggered by push).
Builds `docker/Dockerfile`, tags `ghcr.io/psd401/documenso:latest` and
`:$GIT_SHA` (short SHA), then runs a regression guard **before** pushing
either tag:

```bash
docker run --rm "$IMAGE:$GIT_SHA" sh -c 'command -v soffice'
docker run --rm "$IMAGE:$GIT_SHA" sh -c 'command -v qpdf'
docker run --rm "$IMAGE:$GIT_SHA" sh -c 'fc-list | grep -iq liberation'
```

If any of the three fail, the image is never pushed — this guards
against shipping a build that can't convert DOCX (no soffice / no
Liberation fonts) or decrypt encrypted PDFs (no qpdf), referencing past
regressions (issues #95/#96, #28). The same three-command smoke test also
runs in normal CI, in the `build_docker` job of
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Docker image build stages

[`docker/Dockerfile`](../../docker/Dockerfile) is a 4-stage build on
`node:22-alpine3.22`: `base` → `builder` (turbo prune) → `installer`
(`npm ci`, `turbo run build --filter=@documenso/remix...`, with
`NODE_OPTIONS=--max-old-space-size=4096` — an in-file comment notes the
combined enterprise+pipeline codebase exceeds the default ~2GB heap
during typegen/tsc) → `runner` (final image). The runner stage installs
`libreoffice-writer`, `font-liberation`, and `qpdf` via `apk add`, with
inline comments explaining exactly which pipeline files depend on each
(`convert-to-pdf.ts` on soffice, `normalize-pdf.ts`/`decrypt-pdf.ts` on
qpdf) — see
[architecture/jobs-and-pdf-pipeline.md](../architecture/jobs-and-pdf-pipeline.md).

## AWS production

Production runs on an EC2 host in the INFRA-CORE VPC, digest-pinned (not
`:latest` — the operator edits the pinned `sha256` digest in
`docker-compose.yml` on the host and runs
`docker compose pull && docker compose up -d documenso`). Full
host/SSH/deploy details are in root
[`CLAUDE.md`](../../CLAUDE.md#prod-aws), since they include internal
hostnames and access paths not appropriate to duplicate here.

The cutover from upstream's published image to this fork's custom-built
image is documented in
[`docs/superpowers/plans/2026-04-30-aws-cutover.md`](../../docs/superpowers/plans/2026-04-30-aws-cutover.md),
including the required environment-variable changes for the fork
(`NEXT_PUBLIC_FEATURE_BILLING_ENABLED` → `false`,
`NEXT_PUBLIC_DISABLE_SIGNUP` → `true` to stop external auto-join via the
create-user hook — see [fork/changes.md](../fork/changes.md) and
[identity/sso-and-provisioning.md](../identity/sso-and-provisioning.md))
and the Prisma migrations that had to be applied as part of the cutover.

## Backups

Root `CLAUDE.md` documents a nightly `pg_dump` (plus n8n data and stack
config) to `s3://psd401-documenso-backups/` via a cron job on the prod
EC2 host — this is the recovery source for accidental data loss (e.g. a
hard-deleted pending envelope; see the bulk-delete gotcha in
[`docs/feature-backlog.md`](../../docs/feature-backlog.md)). No backup
script lives in this repository to link to directly; treat root
`CLAUDE.md`'s Prod Environment section as the source of truth for the
exact schedule and script path.
