---
type: Operations
title: CI and Repository Automation
description: GitHub Actions workflows for the PSD401 Documenso fork - CI build and Docker smoke test, Playwright E2E, GHCR image publishing, tag-based release branch sync, org security scan, Claude PR review, and the scheduled OpenWiki refresh.
tags: [operations, ci, github-actions, security, automation]
openwiki:
  roles: [operations, delivery]
  change_kinds: [ci-workflow, secrets, release]
  source_paths:
    - .github/workflows/ci.yml
    - .github/workflows/e2e-tests.yml
    - .github/workflows/build-psd401.yml
    - .github/workflows/deploy.yml
    - .github/workflows/security-scan.yml
    - .github/workflows/claude-review.yml
    - .github/workflows/openwiki-update.yml
  symbols: [build_app, build_docker, e2e_tests, build, deploy, security-scan, claude-review, openwiki]
---

# CI and Repository Automation

This repository's `.github/workflows/` directory holds the workflows that
build, test, publish, and maintain the fork. Some are fork-owned (CI, image
publishing, release sync). Others are thin callers of reusable workflows
owned by the PSD401 organisation, whose internals are not in this repository
and cannot be verified here.

## Workflow inventory

| Workflow | Trigger | What it does | Owner |
|----------|---------|--------------|-------|
| [`ci.yml`](../../.github/workflows/ci.yml) "Continuous Integration" | `push` and `pull_request` to `main`, `workflow_call` | Two jobs: `build_app` runs `npm run build`; `build_docker` builds `docker/Dockerfile` and smoke-tests the runtime image | Fork |
| [`e2e-tests.yml`](../../.github/workflows/e2e-tests.yml) "Playwright Tests" | `push` and `pull_request` to `main` | Starts services with `npm run dx:up`, migrates and seeds the DB, then runs `npm run ci` (build plus `test:e2e`); uploads Playwright results on failure or success | Fork |
| [`build-psd401.yml`](../../.github/workflows/build-psd401.yml) "Build PSD401 Fork" | `workflow_dispatch` only | Builds and pushes `ghcr.io/psd401/documenso` as `:latest` and `:<short SHA>` after the same regression guard | Fork |
| [`deploy.yml`](../../.github/workflows/deploy.yml) "Deploy to Production" | Push of any tag | Checks out `main` and fast-forwards the `release` branch to it, then pushes `release` | Fork |
| [`security-scan.yml`](../../.github/workflows/security-scan.yml) "Security Scan" | `pull_request`, `push` to `main`, weekly cron (Mondays 09:00 UTC), manual | Calls the org reusable `reusable-security-scan.yml@main` | Org reusable |
| [`claude-review.yml`](../../.github/workflows/claude-review.yml) "Claude Review" | `pull_request` (opened, synchronize, ready_for_review, reopened) | Calls the org reusable `reusable-claude-review.yml@main`, skipping `dependabot[bot]` actors | Org reusable |
| [`openwiki-update.yml`](../../.github/workflows/openwiki-update.yml) "OpenWiki Update" | `push` to `main`, weekly cron (Mondays 08:00 UTC), manual | Calls the org reusable `reusable-openwiki.yml@main`, which regenerates this wiki | Org reusable |

The other workflows in the directory (issue and PR labelling, stale
handling, semantic PR titles, CodeQL, translation sync, and the upstream
`publish.yml`) are not covered here.

## Image runtime guard (shared by CI and publishing)

`ci.yml`'s `build_docker` job and `build-psd401.yml` run the same three
checks against the built image: `soffice` on PATH, `qpdf` on PATH, and a
Liberation font visible to `fc-list`. The comments in both files tie these to
the conversion pipeline: `convert-to-pdf.ts` and `decrypt-pdf.ts` resolve
binaries with `which`, and the failure would surface as `DEPENDENCY_MISSING`
on DOCX/DOC uploads or encrypted PDFs. The publish workflow only pushes tags
after these checks pass. See
[operations/deployment.md](deployment.md#building-and-publishing-the-image) for
the image build stages and
[architecture/jobs-and-pdf-pipeline.md](../architecture/jobs-and-pdf-pipeline.md)
for the pipeline that needs these binaries.

## Release sync

`deploy.yml` does not build or deploy anything itself. On a tag push it
checks out `main` (using the `GH_TOKEN` secret for checkout) and runs
`git merge --ff-only main` into `release`, then pushes `release`. Any
downstream deployment that follows `release` is outside this repository.
The production steps in [operations/deployment.md](deployment.md#aws-production)
are the operator-run path.

## Reusable org workflows and secrets

Three workflows are thin callers of reusable workflows in the
`PSD401/.github` repository. The callers pin `@main` on purpose (the inline
comments cite the org's standards document), so a change to the reusable
propagates without a commit here. Those inline comments also carry
`zizmor: ignore[unpinned-uses]` markers, which suggests the org runs the
zizmor workflow linter on these files (the lint setup itself is not in this
repository).

- **Explicit secrets.** `openwiki-update.yml` used to pass `secrets: inherit`.
  It now forwards only `BEDROCK_API_KEY` and `PSD_AUTOMATION_APP_PRIVATE_KEY`.
  `claude-review.yml` forwards only `BEDROCK_API_KEY`. Keep this pattern:
  add a secret by name to the caller's `secrets:` block, not by inheriting all.
- **Permissions must be granted by the caller.** `openwiki-update.yml`
  requests `contents: write` and `pull-requests: write`. `claude-review.yml`
  requests `id-token: write`, because the org default token is read-only and
  a reusable cannot elevate its caller's permissions.
- **Dependabot is excluded from Claude review.** The caller skips
  `dependabot[bot]` actors because a Dependabot-triggered run cannot grant
  `id-token: write`, which causes a `startup_failure`.

## How the wiki is refreshed

`openwiki-update.yml` is the trigger for regenerating `openwiki/`. Its
concurrency group `openwiki` uses `cancel-in-progress: true`, so back-to-back
merges leave only the last regeneration. The caller passes `base_branch: main` and
`auto_merge: false` to the reusable, so its output is not merged automatically.
See [quickstart.md](../quickstart.md) for what the wiki covers.

## Change-safety notes

- Edit the workflow files in this directory for fork behaviour. Changes to
  `@main` reusables are made in `PSD401/.github`, outside this repository.
- Do not add secret values to workflow files. Only secret names appear here.
- Validation: there is no workflow linter in `package.json`. Check YAML
  edits by reading them, and run the narrow checks that a workflow exercises
  (`npm run build`, or `npm run ci` for the E2E path). Avoid the full E2E
  suite locally unless the change affects the Playwright path, because it
  starts the Docker dev stack via `npm run dx:up`.
- Evidence gap: the internals of `reusable-security-scan.yml`,
  `reusable-claude-review.yml`, and `reusable-openwiki.yml` are not in this
  repository.
ory.
able-security-scan.yml`,
  `reusable-claude-review.yml`, and `reusable-openwiki.yml` are not in this
  repository.
ory.
