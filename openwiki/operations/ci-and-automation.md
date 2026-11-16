---
type: Operations
title: CI and Repository Automation
description: >
  GitHub Actions workflows for this fork: the CI build and Docker smoke test,
  the manual image publish, the org-reusable Claude review, security scan, and
  OpenWiki update workflows, their triggers and secret scoping, and the rule that
  every action reference is pinned to a commit SHA.
tags: [operations, ci, github-actions, security, openwiki]
---

# CI and repository automation

This page covers the workflows under `.github/workflows/` that matter for
changing or operating this fork. Most upstream workflows (deploy, publish,
translations, labelers) are not covered in depth; see the
[backlog](../quickstart.md#backlog).

## Workflow inventory

| Workflow file | Trigger | What it does |
|---|---|---|
| `ci.yml` (`Continuous Integration`) | `push` and `pull_request` to `main`; `workflow_call` | `build_app` runs `npm run build` after copying `.env.example` to `.env`. `build_docker` builds `docker/Dockerfile` and runs the runtime smoke test (see below). |
| `build-psd401.yml` | `workflow_dispatch` only | Builds the image, runs the same three-command regression guard, then pushes `:latest` and `:$GIT_SHA` to GHCR. Details in [deployment.md](deployment.md#building-and-publishing-the-image). |
| `claude-review.yml` | `pull_request` (`opened`, `synchronize`, `ready_for_review`, `reopened`) | Calls the org reusable `reusable-claude-review.yml`, passing only `BEDROCK_API_KEY`. Skipped for `dependabot[bot]` actors. |
| `security-scan.yml` | `pull_request`, `push` to `main`, weekly cron (`0 9 * * 1`), `workflow_dispatch` | Calls the org reusable `reusable-security-scan.yml`. |
| `openwiki-update.yml` | `workflow_dispatch`, `push` to `main`, weekly cron (`0 8 * * 1`) | Calls the org reusable `reusable-openwiki.yml` to regenerate this wiki and open a docs PR against `main` (`auto_merge: false`). |

Other workflows in the directory (`deploy.yml`, `publish.yml`,
`e2e-tests.yml`, `codeql-analysis.yml`, translation sync, labelers) are
present but not documented here.

## Invariants

- **Every `uses:` reference is pinned to a full commit SHA** with a version
  comment, for example `actions/checkout@<sha> # v4.4.0`. Commits `26176342f`
  (#200) and `59091c1fe` (#204) established this across the workflow files.
  The org reusable workflows are pinned to the
  `v1.0.0` SHA. Local composite actions (`./.github/actions/node-install`,
  `./.github/actions/playwright-install`) are the only exception.
- **Secrets are passed by name, never with `secrets: inherit`.** The OpenWiki
  caller passes `BEDROCK_API_KEY` and `PSD_AUTOMATION_APP_PRIVATE_KEY`
  (commit `5bf50013c`). The Claude review caller passes only
  `BEDROCK_API_KEY`. A new caller should pass only the secrets the reusable
  workflow reads.
- **Dependabot PRs are not reviewed, but the required check still reports.**
  `claude-review.yml` has two jobs. The real review job is skipped for
  `dependabot[bot]`. A second job named `claude-review` calls
  `reusable-claude-review-skip.yml`, so the required context
  `claude-review / claude-review` passes. Renaming either job risks
  breaking that required-check name.
- **Reusable OpenWiki runs are serialized.** `openwiki-update.yml` uses
  `concurrency: group: openwiki` with `cancel-in-progress: true`, so only the
  latest merge's regeneration survives.
- **The Docker image must start with the document-conversion dependencies.**
  Both `build-psd401.yml` (before any push) and `ci.yml`'s `build_docker` job
  run `command -v soffice`, `command -v qpdf`, and
  `fc-list | grep -iq liberation` inside the built image. Removing a runtime
  package from `docker/Dockerfile` makes both fail, which is intended. See
  [jobs-and-pdf-pipeline.md](../architecture/jobs-and-pdf-pipeline.md) for why
  each dependency is needed.

## Change guidance

- **Adding or updating an action:** resolve the tag to a commit SHA, keep the
  version comment, and do not use a branch name. The narrow check is:

  ```bash
  grep -rn "uses:" .github | grep -vE "@[0-9a-f]{40}" | grep -v "uses: ./"
  ```

  It should print nothing. Local `./` composite actions are expected to
  appear in the first grep and are filtered out here.
- **Adding a secret to a caller:** pass only that secret by name. Do not
  switch a caller back to `secrets: inherit`.
- **Changing the image's runtime packages:** update `docker/Dockerfile` and the
  smoke test in both `ci.yml` and `build-psd401.yml` together. A change in
  only one leaves the other workflow's guard out of date.
- **Scope boundary:** the org reusable workflows live in another repository
  (`PSD401/.github`). Their internals are not in this tree, so this page can
  only describe how this repo calls them.
- **Gitleaks:** `.gitleaksignore` records findings that were reviewed and
  accepted. Its contents are not reproduced here. Add an entry only after
  review, not to silence a new finding without a reason.

## Validation

Workflow YAML has no local linter in this repo (`package.json` defines
`biome check` for TypeScript only). The practical checks are:

- The `uses:` pinning grep above for action-reference changes.
- For image-dependency changes, run the three `docker run ... command -v`
  commands from [deployment.md](deployment.md#building-and-publishing-the-image)
  against a locally built image. This is expensive (a full Docker build), so
  run it only when `docker/Dockerfile` or the runtime packages change.

## Source references

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- [`.github/workflows/build-psd401.yml`](../../.github/workflows/build-psd401.yml)
- [`.github/workflows/claude-review.yml`](../../.github/workflows/claude-review.yml)
- [`.github/workflows/security-scan.yml`](../../.github/workflows/security-scan.yml)
- [`.github/workflows/openwiki-update.yml`](../../.github/workflows/openwiki-update.yml)
- [`.github/actions/node-install/action.yml`](../../.github/actions/node-install/action.yml)
- [`.gitleaksignore`](../../.gitleaksignore)
