---
type: Operations
title: GitHub Actions Workflows and Supply-Chain Controls
description: >
  What the PSD401 fork's GitHub Actions workflows run, when they run, and the
  controls that keep them safe: SHA-pinned actions, the Docker smoke test in
  CI, the gitleaks allowlist, the reusable security-scan, Claude review, and
  OpenWiki refresh.
tags: [operations, ci, github-actions, security, supply-chain]
openwiki:
  roles: [operations, delivery]
  change_kinds: [ci-workflow, supply-chain, secrets]
  source_paths:
    - .github/workflows/ci.yml
    - .github/workflows/build-psd401.yml
    - .github/workflows/security-scan.yml
    - .github/workflows/claude-review.yml
    - .github/workflows/openwiki-update.yml
    - .github/actions/node-install/action.yml
    - .gitleaksignore
  symbols: [build_app, build_docker, claude-review-dependabot]
---

# GitHub Actions workflows and supply-chain controls

The fork's `.github/workflows/` directory runs two kinds of automation:
build and publish jobs that gate deployment artifacts, and security or review
jobs that protect the repository. Deployment mechanics (image build stages,
AWS hosts, backups) are described in [deployment.md](deployment.md); this page
covers the workflows and the rules behind them.

## Workflow inventory

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | push and PR to `main`, `workflow_call` | `build_app` runs `npm run build`. `build_docker` builds `docker/Dockerfile` without pushing, then runs the runtime smoke test (see below). |
| [`build-psd401.yml`](../../.github/workflows/build-psd401.yml) | `workflow_dispatch` only | Builds the image and pushes `ghcr.io/psd401/documenso`. The regression guard runs before the push. Details in [deployment.md](deployment.md#building-and-publishing-the-image). |
| [`security-scan.yml`](../../.github/workflows/security-scan.yml) | PR, push to `main`, Monday 09:00 UTC, manual | Calls the org-owned `PSD401/.github` reusable security scan, pinned to a commit SHA. |
| [`claude-review.yml`](../../.github/workflows/claude-review.yml) | PR opened, synchronized, ready for review, reopened | Calls the org-owned reusable Claude review. Passes only `BEDROCK_API_KEY`. |
| [`openwiki-update.yml`](../../.github/workflows/openwiki-update.yml) | push to `main`, Monday 08:00 UTC, manual | Calls the org-owned reusable OpenWiki job, which refreshes this `openwiki/` tree. Passes only `BEDROCK_API_KEY` and `PSD_AUTOMATION_APP_PRIVATE_KEY`. |

Other workflows in the directory (deploy, publish, e2e, translations, labelers,
stale, codeql) are outside this page's scope; read their YAML directly.

## Runtime smoke test for the Docker image

`ci.yml` job `build_docker` is the cheapest guard that the image can still
convert and decrypt documents. After the build it runs three checks:

```bash
docker run --rm documenso-<sha> sh -c 'command -v soffice'
docker run --rm documenso-<sha> sh -c 'command -v qpdf'
docker run --rm documenso-<sha> sh -c 'fc-list | grep -iq liberation'
```

These protect the DOCX/DOC conversion path and encrypted-PDF decryption
described in [jobs-and-pdf-pipeline.md](../architecture/jobs-and-pdf-pipeline.md).
`convert-to-pdf.ts` and `decrypt-pdf.ts` resolve their binaries through
`findBinary`, which checks `which`/`where` and known install paths. A missing
binary throws `DEPENDENCY_MISSING`. The same
three commands run inside `build-psd401.yml` before any tag is pushed.

## Supply-chain controls

- **Commit-pinned actions.** Every `uses:` reference is pinned to a full commit
  SHA with the version kept in a trailing comment (for example,
  `actions/checkout@11d5960a...  # v4.4.0` in `ci.yml`). The composite
  [`node-install` action](../../.github/actions/node-install/action.yml) follows
  the same rule. Reusable workflows from `PSD401/.github` are pinned to one tag
  SHA. The reusables run in the org repository, so a change there affects every
  caller and needs a new pin here.
- **Narrow secrets.** Callers pass named secrets instead of `secrets: inherit`.
  `openwiki-update.yml` and `claude-review.yml` both list their secrets
  explicitly. The reusable `claude-review` job still needs the caller to grant
  `id-token: write`.
- **Dependabot-safe review.** Dependabot PRs cannot receive the Claude review's
  `id-token` permission, so `claude-review.yml` routes them to a second job,
  `claude-review-dependabot`. That job has the same check name, `claude-review`,
  and calls a no-op reusable. The workflow comment says production repos require
  that check name, so removing the job would block Dependabot merges.
- **Secret-scan allowlist.** `security-scan` uses gitleaks, which reads
  [`.gitleaksignore`](../../.gitleaksignore) by default. Each entry is
  `<commit>:<file>:<rule>:<line>`, and the file records that the listed
  findings are upstream Documenso docs and examples. A finding outside this
  list fails the scan. When you add an entry, record the review reason in the
  file header.
- **OpenWiki concurrency.** `openwiki-update.yml` uses the concurrency group
  `openwiki` with `cancel-in-progress: true`, so overlapping merges keep only
  the newest wiki run.

## Change guidance

- Pin any new third-party action to a full SHA with a version comment, and
  match the existing pattern in `ci.yml`.
- Do not switch a caller back to `secrets: inherit`. Pass only the secrets the
  reusable needs.
- If you change the `claude-review` job names, keep the Dependabot job's
  `claude-review` name, or the required check stays pending.
- The checkout has no local linter for workflow YAML (no zizmor or actionlint
  config under `.github/`). Validate a workflow change by pushing it on a PR,
  where `ci.yml` and `security-scan.yml` run.
- The `.gitleaksignore` list is an allowlist for reviewed upstream findings.
  Do not add entries for new findings in this repository's own code; fix or
  rotate the value instead.

## Related pages

- [Deployment](deployment.md): image build stages, on-prem dev, AWS production.
- [Background jobs and PDF pipeline](../architecture/jobs-and-pdf-pipeline.md):
  the runtime dependencies the Docker smoke test protects.
- [Operations index](index.md).
