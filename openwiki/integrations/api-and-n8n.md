---
type: Reference
title: Public API v2 and n8n
description: >
  Team-scoped API tokens, the envelope folderId query contract external
  callers must respect, and where n8n integration code actually lives.
tags: [integrations, api, n8n, tokens]
---

# Public API v2 and n8n

## API v2 tokens are hard-scoped to one team

`ApiToken.teamId` (`packages/prisma/schema.prisma`) is a required,
non-nullable `Int` FK to `Team` — a token is bound to exactly one team at
creation, with no nullable override column in the schema.

Token-authenticated requests resolve their team context straight from
that column, not from any request header:
[`packages/lib/server-only/public-api/get-api-token-by-token.ts`](../../packages/lib/server-only/public-api/get-api-token-by-token.ts)
looks up the hashed token (including its `team` relation) and throws
`UNAUTHORIZED`/`EXPIRED_CODE` as appropriate;
[`packages/trpc/server/trpc.ts`](../../packages/trpc/server/trpc.ts)
(around lines 91-110 and 189-208) injects `teamId: apiToken.teamId` into
context for API-token-authenticated procedures. The `x-team-id` header
(`packages/trpc/server/context.ts`) is parsed and used **only** for
session-based (browser) requests — there is no code path where a
bearer-token request's team can be overridden by that header. A single
API key therefore only ever sees its one team's envelopes; cross-team or
district-wide access needs system `Role.ADMIN` via the admin panel
instead (`adminFindDocuments` has no team filter) — see root `CLAUDE.md`
for the operational tradeoffs of that (PSD docs span 40+ teams, so no
single key can serve them all).

## The folderId contract every external caller must respect

[`packages/lib/server-only/envelope/find-envelopes.ts`](../../packages/lib/server-only/envelope/find-envelopes.ts)
(around lines 134-138):

```ts
// Folder filter
qb =
  folderId !== undefined
    ? qb.where('Envelope.folderId', '=', folderId)
    : qb.where('Envelope.folderId', 'is', null);
```

Omitting `folderId` from a query does **not** mean "search everywhere" —
it forces `WHERE folderId IS NULL`, i.e. root-level envelopes only. Any
integration that looks up an envelope by title or other criteria (an n8n
webhook handler, for example) must pass the correct `folderId` once
envelopes are being filed into folders, or the search silently returns
zero rows with no error. This is the exact mechanism that broke transfer
completion handling described in root `CLAUDE.md`: creator workflows
started filing into named folders (e.g. `tsd_folder_transfers_in/out`)
before the completion-handler search was updated to pass that same
`folderId`.

There is a second `find-envelopes.ts`, in
[`packages/trpc/server/envelope-router/find-envelopes.ts`](../../packages/trpc/server/envelope-router/find-envelopes.ts) —
that one is the thin tRPC router wrapper; the filtering logic itself
lives in the `packages/lib/server-only/envelope/` version cited above.

## Removed: unauthenticated `/api/webhook/trigger`

The `/api/webhook/trigger` route was deleted in the security fix PR #201
(`apps/remix/app/routes/api+/webhook.trigger.ts`, plus the handler and schema
under `packages/lib/server-only/webhooks/trigger/`). Per the header of its
guard test, its only check was a signature keyed on
`NEXT_PRIVATE_ENCRYPTION_KEY`, and no app code called it. The Stripe route
[`stripe.webhook.ts`](../../apps/remix/app/routes/api+/stripe.webhook.ts)
now types itself against its own module instead.

Do not reintroduce this route. The guard test
[`webhook-trigger-route-removed.test.ts`](../../packages/lib/utils/webhook-trigger-route-removed.test.ts)
fails if the route module or handler comes back, or if the Stripe route
references `webhook.trigger`. Run it with
`cd packages/lib && npx vitest run --project unit webhook-trigger-route-removed`.

## n8n

There is no n8n integration code in this repository — n8n runs as a
separate service (`n8n.psd401.net`, documented in root `CLAUDE.md`) that
calls into Documenso's public API v2 as an external client, and receives
webhooks/form submissions independently of this codebase. The only thing
this repo needs to get right for n8n workflows to work is the API
contract above (team-scoped tokens, explicit `folderId` on every
folder-scoped query) — there's nothing else n8n-specific to document
here. Repo-side documenso work related to n8n workflows is limited to
whatever the calling workflow sends over the public API, which is covered
by the standard [`ARCHITECTURE.md`](../../ARCHITECTURE.md) API v2
reference and this page.
