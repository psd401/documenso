---
type: Overview
title: System Architecture Overview
description: >
  Monorepo layout, request path, tech stack, and background providers for
  the Documenso PSD401 fork.
tags: [architecture, remix, trpc, hono, monorepo]
---

# System architecture overview

Documenso is an npm-workspaces + Turborepo monorepo. This page summarizes
the layout and request flow; the repo's own
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) (upstream-authored, still
accurate for this fork) has a fuller reference including every
provider/API detail. This page adds what `ARCHITECTURE.md` doesn't cover:
how PSD401's fork-specific code fits in.

## Monorepo layout

`apps/`:

| App | Package name | What it is |
|---|---|---|
| [`apps/remix`](../../apps/remix) | `@documenso/remix` | The main app: Remix (React Router v7) SSR frontend + a custom Hono server (`apps/remix/server/`). This is what's deployed. |
| [`apps/openpage-api`](../../apps/openpage-api) | `@documenso/openpage-api` | Separate Next.js app, small public status/analytics API — distinct from the main tRPC API. |
| `apps/docs` | `@documenso/documentation` | Upstream documentation site (Next.js + Nextra); not used for PSD401-specific docs. |

`packages/` (the ones with the most PSD401-specific code, see
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the full list):

| Package | What lives there |
|---|---|
| [`packages/lib`](../../packages/lib) | Core business logic: `server-only/` (DB/queue/PDF/crypto), `client-only/`, `universal/` (shared), `jobs/` (background job system), `constants/`, `types/`, `utils/`. Most fork-specific server logic (directory sync, PSD401 org constants) lives here. |
| [`packages/trpc`](../../packages/trpc) | tRPC routers under `server/` (mounted as both the internal RPC API and the public, OpenAPI-documented v2 API). |
| [`packages/prisma`](../../packages/prisma) | `schema.prisma`, migrations, seed data, a Kysely query-builder layer alongside the Prisma client. |
| [`packages/auth`](../../packages/auth) | Session/auth logic: OAuth (Arctic), WebAuthn/passkeys, session cookies. |
| [`packages/ee`](../../packages/ee) | "Enterprise Edition" feature code — unlocked in this fork (see [fork/changes.md](../fork/changes.md)). Stripe billing client code still lives here too, gated off rather than removed. |
| [`packages/signing`](../../packages/signing) | PDF cryptographic signing (local P12 file or Google Cloud KMS). |
| [`packages/api`](../../packages/api) | Hono-based public REST API v1 (deprecated but maintained). |
| [`packages/ui`](../../packages/ui) | Shared React component library (Shadcn/Radix/Tailwind). |

## Request path

Every SSR page render goes through
[`apps/remix/app/root.tsx`](../../apps/remix/app/root.tsx): its `loader()`
calls `getOptionalSession(request)`
(`@documenso/auth/server/lib/utils/get-session`) to establish the session,
then, if authenticated, `getOrganisationSession({ userId })`
(`@documenso/trpc/server/organisation-router/get-organisation-session`) to
load the user's organisations. Route-level access grouping is done by
Remix's flat-routes folder convention under
[`apps/remix/app/routes/`](../../apps/remix/app/routes): `_authenticated+/`,
`_unauthenticated+/`, `_recipient+/` (signing links), `_profile+/`,
`_share+/`, `embed+/`, `api+/`.

tRPC is mounted onto the Hono server at
[`apps/remix/server/trpc/hono-trpc-remix.ts`](../../apps/remix/server/trpc/hono-trpc-remix.ts):
`trpcServer({ router: appRouter, endpoint: '/api/trpc', createContext: ... })`,
wiring `@documenso/trpc/server/router`'s `appRouter`. A second file,
`apps/remix/server/trpc/hono-trpc-open-api.ts`, mounts the OpenAPI-documented
public API v2 variant. Background jobs are delivered over HTTP too: the
local job provider POSTs to `/api/jobs/:jobDefinitionId/:jobId`, handled by
`LocalJobProvider.getApiHandler()` in
[`packages/lib/jobs/client/local.ts`](../../packages/lib/jobs/client/local.ts)
(see [jobs-and-pdf-pipeline.md](jobs-and-pdf-pipeline.md)).

## Swappable providers (upstream feature, used as-is)

PSD401 runs with specific provider choices (see
[operations/deployment.md](../operations/deployment.md) for the actual env
values in use); the mechanism itself is upstream and documented in full in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md#swappable-providers`):

- **Storage**: `database` (uploaded documents stored as Base64 blobs in
  Postgres) or `s3`. PSD401 prod runs `database`.
- **Jobs**: `local` (Postgres-backed queue, PSD401's choice), `bullmq`
  (Redis-backed), or `inngest` (managed cloud).
- **PDF signing**: `local` (P12 certificate file) or `gcloud-hsm` (Google
  Cloud KMS). PSD401 uses `local` with a cert file bind-mounted into the
  container.
- **Email**: SMTP (auth or API-key), Resend, or MailChannels. PSD401 dev
  uses a local Inbucket SMTP catcher; prod uses SMTP.

## Tech stack

React 18 + React Router v7 (Remix) on the frontend; Hono as the server;
PostgreSQL 15+ via Prisma and Kysely; tRPC (with `trpc-to-openapi`) plus
ts-rest for API v1; Tailwind/Radix/Shadcn for UI; Arctic for OAuth;
`@libpdf/core`/`pdfjs-dist` for PDF manipulation; Lingui for i18n;
Turborepo + Vite for the build; Playwright and Vitest for tests.
