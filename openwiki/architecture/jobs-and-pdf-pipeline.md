---
type: Reference
title: Background Jobs and PDF Pipeline
description: >
  The local job provider, the seal-document sweep's unbounded retry
  design, and the DOCX/DOC-to-PDF and encrypted-PDF pipelines.
tags: [architecture, jobs, pdf, libreoffice, qpdf]
---

# Background jobs and PDF pipeline

## Job system

Custom in-house job runner under [`packages/lib/jobs/`](../../packages/lib/jobs),
with pluggable providers in `packages/lib/jobs/client/`: `local.ts`
(Postgres-backed queue + HTTP self-call, PSD401's choice), `bullmq.ts`
(Redis-backed), `inngest.ts` (managed cloud). Job definitions live in
`packages/lib/jobs/definitions/{emails,internal}/`, each as a `<name>.ts`
(id, trigger, optional cron, payload schema) paired with a
`<name>.handler.ts` that's lazy-imported at execution time.

### Local provider mechanics

[`packages/lib/jobs/client/local.ts`](../../packages/lib/jobs/client/local.ts):

- `triggerJob()` creates a `BackgroundJob` row, then `submitJobToEndpoint()`
  POSTs to `${NEXT_PRIVATE_INTERNAL_WEBAPP_URL()}/api/jobs/:jobDefinitionId/:jobId`
  and races that fetch against a **150ms** `setTimeout` — the trigger call
  returns regardless of whether the HTTP round trip finished, i.e. job
  submission is fire-and-forget from the caller's perspective.
- `getApiHandler()` is the endpoint that actually runs a job: verifies a
  signature, atomically claims the `BackgroundJob` row (`PENDING` →
  `PROCESSING`), runs the handler, and on failure compares
  `backgroundJob.retried` against `maxRetries` to decide `FAILED` vs.
  re-queue. `BackgroundJob.maxRetries` defaults to `3`
  (`schema.prisma`); a task-level retry cap of `3` is also hardcoded in
  `runTask()`.
- A cron poller (`startCron()`/`processCronTick()`) runs every 30s (+0-5s
  jitter) and uses deterministic per-slot job IDs so concurrent instances
  collide on a Postgres unique constraint instead of double-running a cron
  job.

### Seal-document sweep

- Definition: [`packages/lib/jobs/definitions/internal/seal-document-sweep.ts`](../../packages/lib/jobs/definitions/internal/seal-document-sweep.ts)
  — cron `*/15 * * * *` (every 15 minutes).
- Handler: [`packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts`](../../packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts)
  — queries `PENDING` `DOCUMENT`-type envelopes that are either fully
  signed/CC'd or have any rejection, excluding envelopes with a recipient
  `signedAt` in the last 15 minutes (to avoid racing the normal completion
  path), limited to 100 per run. For each match it re-triggers
  `internal.seal-document` with `isResealing: true`.
- **No upper time bound on staleness, by design.** The handler's own
  comment states the reasoning directly: *"No upper bound — if the initial
  seal trigger was dropped (150ms timeout in local job provider), the
  sweep must keep retrying. The seal job's own maxRetries handles truly
  broken PDFs."* Do not add a time-based cutoff here — it would
  permanently abandon envelopes whose initial trigger was dropped by the
  150ms race above. The `internal.seal-document` job's own `maxRetries`
  (DB default 3) is what bounds retries for a genuinely corrupt PDF.

## PDF pipeline

### DOCX/DOC → PDF conversion

[`packages/lib/server-only/utils/convert-to-pdf.ts`](../../packages/lib/server-only/utils/convert-to-pdf.ts):

- `MAX_CONVERSION_SIZE = 25 * 1024 * 1024` (25MB) — oversized uploads are
  rejected with `AppError('CONVERSION_FAILED', ...)` before conversion.
- `CONVERSION_TIMEOUT_MS = 60_000` (60s) — passed to the `soffice`
  `execFile` call.
- A module-level `conversionQueue` promise chain (`enqueue()`) serializes
  every `soffice --headless` invocation process-wide — LibreOffice's
  single-instance lock means concurrent conversions crash, so callers
  queue rather than run in parallel.
- Magic-byte validation (`isValidDocumentContent()`) checks for OOXML
  (`PK\x03\x04`) or OLE2/CFBF (`\xD0\xCF\x11\xE0`) headers before shelling
  out.
- `findBinary('soffice')` resolves the binary via `which`/`where`, then a
  table of known install paths, caching the result; if it can't find
  `soffice` (or `qpdf`, for decryption) it throws `AppError`
  with code `DEPENDENCY_MISSING`.

### Encrypted PDF decryption

`normalizePdf` (below) detects `pdfDoc.isEncrypted` and calls
`decryptPdf` (`packages/lib/server-only/utils/decrypt-pdf.ts`), which
shells out to `qpdf --decrypt`, also via `findBinary('qpdf')`.

### Normalization and flattening — two distinct code paths, don't conflate them

[`packages/lib/server-only/pdf/normalize-pdf.ts`](../../packages/lib/server-only/pdf/normalize-pdf.ts)
(`normalizePdf(pdf, { flattenForm = true })`) is the **upload-time** path:
it decrypts if needed, merges split content streams (working around an
`@libpdf/core` bug that can blank pages with array-type `/Contents`), then
calls `flattenLayers()` and — when `flattenForm` is true — `form.flatten()`
followed by `flattenAnnotations()`. It genuinely does call
`form.flatten()`, controlled per envelope type: creation of envelope items
(`packages/lib/server-only/envelope-item/create-envelope-items.ts`) passes
`flattenForm: envelope.type !== 'TEMPLATE'`, so form flattening runs for
plain document uploads but is skipped for templates (whose AcroForm
fields still need to be readable for field-mapping in the editor).

The **seal path** is different and is where the "never call
`form.flatten()`" rule actually applies: `decorateAndSignPdf` in
[`packages/lib/jobs/definitions/internal/seal-document.handler.ts`](../../packages/lib/jobs/definitions/internal/seal-document.handler.ts)
calls `pdfDoc.flattenAll()` (not `form.flatten()`) before inserting fields
and signatures, then `flattenAll()` again afterward, followed by
`pdfDoc.context.catalog.removeAcroForm()` — the handler's own comment:
*"`@libpdf/core`'s `flattenAll` misses some AcroForm fields (e.g.
Word-origin `/Tx` fields). Nuke the entire AcroForm dictionary so no
interactive fields survive into the signed PDF."* Calling `form.flatten()`
on the seal path is what destroys page content on AcroForm PDFs from
Acrobat PDFMaker (the bug this comment guards against); it is not called
there.

## Source references

- Job client: [`packages/lib/jobs/client/local.ts`](../../packages/lib/jobs/client/local.ts)
- Seal sweep: [`packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts`](../../packages/lib/jobs/definitions/internal/seal-document-sweep.handler.ts)
- Seal handler: [`packages/lib/jobs/definitions/internal/seal-document.handler.ts`](../../packages/lib/jobs/definitions/internal/seal-document.handler.ts)
- Conversion: [`packages/lib/server-only/utils/convert-to-pdf.ts`](../../packages/lib/server-only/utils/convert-to-pdf.ts), [`packages/lib/server-only/utils/find-binary.ts`](../../packages/lib/server-only/utils/find-binary.ts)
- Normalization: [`packages/lib/server-only/pdf/normalize-pdf.ts`](../../packages/lib/server-only/pdf/normalize-pdf.ts)
- Integration tests that self-skip without the binaries: [`packages/lib/server-only/utils/convert-to-pdf.integration.test.ts`](../../packages/lib/server-only/utils/convert-to-pdf.integration.test.ts), [`packages/lib/server-only/utils/decrypt-pdf.integration.test.ts`](../../packages/lib/server-only/utils/decrypt-pdf.integration.test.ts)
