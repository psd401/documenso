---
type: Reference
title: Envelopes, Documents, and Templates Data Model
description: >
  The Envelope/EnvelopeItem model that underlies both documents and
  templates, plus recipients, fields, and folders.
tags: [architecture, prisma, data-model, envelopes]
---

# Envelopes, documents, and templates data model

Full schema: [`packages/prisma/schema.prisma`](../../packages/prisma/schema.prisma)
(1179 lines). This page covers the core signing-workflow models only —
identity/org models are in [identity/teams-and-access.md](../identity/teams-and-access.md).

## Envelope is the umbrella for both documents and templates

`Envelope` (schema.prisma:395-459) is a single model for both — the
`type: EnvelopeType` enum (`DOCUMENT | TEMPLATE`) distinguishes them, and
template-specific fields (`templateType`, `publicTitle`,
`publicDescription`, `directLink`, `templateId`) live directly on the same
model rather than a separate `Template` table. Common fields: `status:
DocumentStatus` (`DRAFT | PENDING | COMPLETED | REJECTED`), `source:
DocumentSource` (`DOCUMENT | TEMPLATE | TEMPLATE_DIRECT_LINK`),
`scheduledAt` (for scheduled sends), `authOptions`/`formValues` (JSON),
`visibility: DocumentVisibility`, and the owning `userId`/`teamId`/
`folderId`.

## Envelope wraps multiple documents via EnvelopeItem

`EnvelopeItem` (schema.prisma:461-482) is what makes an envelope a
multi-document signing packet: each `Envelope` can have many
`EnvelopeItem` rows, each with its own `title`, `order`, and a 1:1 link to
`DocumentData` (the actual PDF bytes/pointer). `Field`s are scoped to a
specific `EnvelopeItem` (via `envelopeItemId`), not just the envelope, so
fields on a 3-document envelope are independently placed per document.
`EnvelopeItem.detectedFields` holds form fields auto-detected in an
uploaded PDF's AcroForm, pending review in the field editor.

```
Envelope (type: DOCUMENT | TEMPLATE)
 ├─ EnvelopeItem[]        (one per document in the packet)
 │    └─ DocumentData      (PDF bytes: S3_PATH | BYTES | BYTES_64)
 ├─ Recipient[]
 ├─ Field[]                (each field references an EnvelopeItem + Recipient)
 ├─ DocumentMeta            (1:1 — subject line, signing order, distribution)
 └─ Folder?                 (nullable — root if unset)
```

## DocumentMeta

`DocumentMeta` (schema.prisma:528-554), 1:1 with `Envelope`, holds
per-envelope settings: subject/message, timezone, date format,
`signingOrder: DocumentSigningOrder` (`PARALLEL | SEQUENTIAL`), which
signature input methods are allowed (typed/uploaded/drawn),
`distributionMethod`, `emailSettings`, `envelopeExpirationPeriod`, and
`reminderSettings`.

## Recipients and fields

`Recipient` (schema.prisma:599-635): belongs to an `Envelope`, has
`email`/`name`/a signing `token`, a `role: RecipientRole`
(`CC | SIGNER | VIEWER | APPROVER | ASSISTANT`), independent
`readStatus`/`signingStatus`/`sendStatus`, and a `signingOrder` position.
Indexed with trigram GIN indexes on email/name for search.

`Field` (schema.prisma:653+): references both an `envelopeId` and an
`envelopeItemId` (which document within the envelope) plus a `recipientId`
(who fills it), a `type: FieldType` (`SIGNATURE`, `FREE_SIGNATURE`,
`INITIALS`, `NAME`, `EMAIL`, `DATE`, `TEXT`, `NUMBER`, `RADIO`,
`CHECKBOX`, `DROPDOWN`, `CALCULATED`, and others), plus page/position/size.

## Folders

`Folder` (schema.prisma:364-387): owned by a `userId`/`teamId`, supports
nesting via a self-relation (`parentId` → `subfolders`), and holds
`envelopes: Envelope[]`. Access-control fields — `visibility:
DocumentVisibility`, `allowedUserIds Int[]`, `allowedGroupIds String[]` —
are described in [identity/teams-and-access.md](../identity/teams-and-access.md#folder-access-control),
including a confirmed gap where these allow-lists are enforced on folder
listing queries but **not** on the envelope/document queries that return
what's inside a folder.

## Audit trail

`DocumentAuditLog` (schema.prisma:484+): one row per envelope-lifecycle
event (`type` is a free-form string, `data` is JSON), capturing actor
`name`/`email`/`userId`/`userAgent`/`ipAddress` where available. This is
the source for a document's "audit trail" shown in the admin panel and the
signing certificate.

## Source references

- Schema: [`packages/prisma/schema.prisma`](../../packages/prisma/schema.prisma)
- Envelope creation from an upload: [`packages/lib/server-only/envelope-item/create-envelope-items.ts`](../../packages/lib/server-only/envelope-item/create-envelope-items.ts)
- Envelope/document queries: [`packages/lib/server-only/envelope/find-envelopes.ts`](../../packages/lib/server-only/envelope/find-envelopes.ts) (lower-level, used by the API and internal callers) and [`packages/lib/server-only/document/find-documents.ts`](../../packages/lib/server-only/document/find-documents.ts) (UI-facing, has additional recipient-match access logic — see [identity/teams-and-access.md](../identity/teams-and-access.md))
