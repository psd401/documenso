---
type: Reference
title: Fork-Specific Changes
description: >
  What PSD401 changed from upstream Documenso — Enterprise Edition
  unlocked, billing gated off (not removed), and self-hosted limits.
tags: [fork, billing, enterprise, limits]
---

# Fork-specific changes

Base version: `2.9.1` (`package.json`). PSD401's active development
branch is `main` — `feature/psd401-unlock-enterprise` still exists in the
repo but is stale (its tip predates several commits already merged to
`main`, e.g. the 2026-09 session-cookie fix); treat `main` as the fork's
integration branch, not that feature branch.

## Enterprise Edition unlocked, billing gated off (not removed)

Stripe is **not deleted from the codebase** — it's gated. Full Stripe
client code still lives under
[`packages/ee/server-only/stripe/`](../../packages/ee/server-only/stripe/create-customer.ts)
(customer creation, subscription lookups, webhook handlers) and is wired
into [`packages/trpc/server/enterprise-router/router.ts`](../../packages/trpc/server/enterprise-router/router.ts)
and `admin-router/create-stripe-customer.ts`. `createOrganisation()`
(`packages/lib/server-only/organisation/create-organisation.ts`) still
calls Stripe's `createCustomer` when `IS_BILLING_ENABLED()` is true —
that flag is what's turned off in this fork's configuration, not the code
path itself.

The limits endpoint that would normally reflect a Stripe subscription
tier is short-circuited instead:
[`packages/ee/server-only/limits/server.ts`](../../packages/ee/server-only/limits/server.ts)
returns `SELFHOSTED_PLAN_LIMITS` unconditionally (its own comment: "Billing
is stripped; all requests return SELFHOSTED_PLAN_LIMITS unconditionally").
[`packages/ee/server-only/limits/constants.ts`](../../packages/ee/server-only/limits/constants.ts):

```ts
export const SELFHOSTED_PLAN_LIMITS: TLimitsSchema = {
  documents: Infinity,
  recipients: Infinity,
  directTemplates: Infinity,
};
```

This `TLimitsSchema` (documents/recipients/directTemplates) is a separate,
older limiting mechanism from the newer `OrganisationClaim`
(teamCount/memberCount/envelopeItemCount) — both exist in the schema and
both matter; see below.

## OrganisationClaim: correcting the "defaults to zero" claim

`OrganisationClaim.teamCount`/`.memberCount`/`.envelopeItemCount`
(schema.prisma) are required `Int` columns with **no `@default()`** —
there is no DB-level default of 0, so a bare Prisma create without
explicit values would be rejected, not silently zeroed.

What actually happens: `createOrganisation()` always builds the claim
explicitly via `createOrganisationClaimUpsertData()`
(`packages/lib/server-only/organisation/create-organisation.ts`), and
`createPersonalOrganisation()` (used for orgs created outside a Stripe
flow, e.g. via SSO auto-provisioning) hardcodes
`claim: internalClaims[INTERNAL_CLAIM_ID.ENTERPRISE]`. That `ENTERPRISE`
claim object, defined upstream in
[`packages/lib/types/subscription.ts:182-202`](../../packages/lib/types/subscription.ts),
hardcodes `teamCount: 0, memberCount: 0` — so those two fields genuinely
do land at 0 for orgs created this way, but via a hardcoded object, not a
schema default. **`envelopeItemCount` is `10` in that same object, not
0** — any limit check reading `envelopeItemCount` on a non-Stripe org
sees 10, not zero. Any code path relying on the "all three fields are
zero" framing from CLAUDE.md's gotcha list should be corrected: only
`teamCount`/`memberCount` are zero, and even then it's because of this
hardcoded claim, not a DB default.

## Removed `/api/webhook/trigger` route

Upstream shipped a Remix `action` at `/api/webhook/trigger` (its module
carried a "delete after deployment" note) that re-dispatched webhooks from
an HTTP request. PSD401 deleted it in commit `c46facb3c`, together with its
handler under `packages/lib/server-only/webhooks/trigger/`. Nothing in the
app called it: webhooks are queued in-process by `triggerWebhook()`
(`packages/lib/server-only/webhooks/trigger/trigger-webhook.ts`), which
enqueues the `execute-webhook` job (see
[architecture/jobs-and-pdf-pipeline.md](../architecture/jobs-and-pdf-pipeline.md)).

The removed handler checked a request signature with `verify()`
(`packages/lib/server-only/crypto/verify.ts`), which decrypts with
`NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`. The commit message describes the
key as `NEXT_PRIVATE_ENCRYPTION_KEY`; the code uses the secondary key. Either
way, a holder of a deployment's encryption key could forge requests to that
entry point, which is why the route was removed.

- `apps/remix/app/routes/api+/stripe.webhook.ts` now takes its `Route` type
  from its own generated types instead of the deleted module.
- `packages/lib/utils/webhook-trigger-route-removed.test.ts` guards against
  reintroduction: it asserts the route module and handler files are absent
  and that `stripe.webhook.ts` no longer references `webhook.trigger`.

## Self-hosted signup and access

- `NEXT_PUBLIC_DISABLE_SIGNUP` — when `true`, blocks new email/password
  self-registration (used on AWS prod to prevent external users from
  auto-joining the PSD401 org via the create-user hook — see
  [identity/sso-and-provisioning.md](../identity/sso-and-provisioning.md)).
- `NEXT_PRIVATE_ALLOWED_SIGNUP_DOMAINS` — restricts which email domains
  can self-register (PSD401 prod: `psd401.net`).
- `NEXT_PUBLIC_FEATURE_BILLING_ENABLED` — the flag `IS_BILLING_ENABLED()`
  reads; PSD401 prod sets this `false` (the on-prem dev compose file sets
  it `true` deliberately, specifically to exercise the enterprise feature
  gates in testing — see
  [operations/deployment.md](../operations/deployment.md)).

## What "Enterprise Edition unlocked" means in practice

The [`packages/ee`](../../packages/ee/index.ts) package (`FEATURES`,
`server-only/`) gates enterprise-tier functionality (advanced
organisation/group management, some field types, etc.) behind claim
flags. Because self-hosted orgs get the `ENTERPRISE` internal claim by
default (see above) rather than a free/starter claim, those features are
available without a paid subscription in this fork — "unlocked" here
means "the self-hosted claim path grants the enterprise flag set," not
that the `packages/ee` code itself was rewritten.
