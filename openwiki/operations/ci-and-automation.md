---
type: Reference
title: CI, Security Scanning, and Automation Workflows
description: >
  GitHub Actions triggers and policy for the PSD401 fork: pull-request-only CI and sharded Playwright E2E, the Docker runtime smoke test, SHA-pinned actions, the org security scan, Claude review, scoped OpenWiki update secrets, and the manual image build.
tags: [operations, ci, github-actions, security, e2e]
---

# CI, security scanning, and automation workflows

Workflows live in [`.github/workflows/`](../../.github/workflows/) and two local
composite actions live in [`.github/actions/`](../../.github/actions/)
(`node-install`, `playwright-install`). The fork's workflow changes are mostly
trigger, permission, and pinning policy. The build logic is upstream's.

For the image build and production promotion, see [deployment.md](deployment.md).

## Triggers at a glance

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | `pull_request` to `main`; `workflow_call` | `build_app` runs `npm run build`. `build_docker` builds `docker/Dockerfile` without pushing, then runs the runtime smoke test for `soffice`, `qpdf`, and Liberation fonts. |
| [`e2e-tests.yml`](../../.github/workflows/e2e-tests.yml) | `pull_request` to `main` | Playwright in 8 shards on `ubuntu-24.04`, with `fail-fast: false`. |
| [`codeql-analysis.yml`](../../.github/workflows/codeql-analysis.yml) | `pull_request` to `main`; weekly on `main`; manual | CodeQL. The weekly run on `main` keeps a baseline for PR comparisons. |
| [`security-scan.yml`](../../.github/workflows/security-scan.yml) | `pull_request`; `push` to `main`; weekly; manual | Calls the org's reusable security scan at `v1.15.0`, with `allowed_spdx: "AFFERO"`. |
| [`claude-review.yml`](../../.github/workflows/claude-review.yml) | `pull_request` (opened, synchronize, ready_for_review, reopened) | Calls the org's reusable Claude review and passes only `BEDROCK_API_KEY`. Dependabot PRs run a skip job that reports the same `claude-review` check. |
| [`openwiki-update.yml`](../../.github/workflows/openwiki-update.yml) | `push` to `main`; weekly; manual | Calls the org's reusable OpenWiki update with `base_branch: main` and `auto_merge: false`. Passes only `BEDROCK_API_KEY` and `PSD_AUTOMATION_APP_PRIVATE_KEY`. |
| [`build-psd401.yml`](../../.github/workflows/build-psd401.yml) | `workflow_dispatch` only | Builds the fork image, runs the smoke test, and pushes `ghcr.io/psd401/documenso`. |
| `deploy.yml`, `publish.yml` | Tag push; push to `release`; manual | Inherited from upstream. See the note below. |

## Invariants and policy

- **CI, E2E, and CodeQL run on pull requests only.** Commit `6207db3d1` removed
  the `push` to `main` triggers. A merge to `main` is therefore not re-tested by
  these workflows. `security-scan.yml` and `openwiki-update.yml` still run on push.
- **E2E shards come from the matrix and turbo.** Each job sets
  `E2E_TEST_PATH: '--shard=N/8'`. `turbo.json` lists `E2E_TEST_PATH` in
  `passThroughEnv` for `test:e2e`, so the value reaches the Playwright command
  (`npm run ci` runs `turbo run build --filter=@documenso/remix` and then
  `turbo run test:e2e`). Each shard uploads `packages/app-tests/**/test-results/*`
  as `test-results-N` for 7 days.
- **E2E mirrors production's choices.** The job sets
  `NEXT_PUBLIC_UPLOAD_TRANSPORT: database`, so MinIO is not started, and
  `NEXT_PUBLIC_DISABLE_SIGNUP: 'true'`. `auth-flow.spec.ts` asserts that `/signup`
  redirects to `/signin` under that setting.
- **Actions are pinned to full commit SHAs** with a version comment. The
  external `uses:` references use 40-character SHAs. Local
  `./.github/actions/*` references are unpinned by design.
- **Reusable org workflows are pinned deliberately.** `security-scan.yml` stays at
  `v1.15.0`. Its comment says `v1.16.0` fails on medium-severity zizmor findings
  that this fork's workflows currently have. Re-check those findings before
  bumping it.
- **Secrets are passed explicitly.** The callers list named secrets and do not use
  `secrets: inherit`, which an earlier version of `openwiki-update.yml` did
  (commit `5bf50013c`). `.gitleaksignore` records reviewed gitleaks findings
  (commit `26176342f`).
- **The Docker smoke test is duplicated.** The same three `docker run` checks
  appear in `ci.yml` (`build_docker`) and `build-psd401.yml`. Change them together,
  and change `docker/Dockerfile` only with those checks in mind.

Upstream's `deploy.yml` fast-forwards the `release` branch from `main` when a tag
is pushed. `publish.yml` publishes upstream's Docker images from the `release`
branch. Neither is part of the PSD401 promotion path in [deployment.md](deployment.md).
Check them before assuming a tag deploys anything.

## Change navigation

- **Changing triggers or branch filters:** edit the `on:` block in the workflow
  file. Keep the `pull_request` and `push` semantics in mind: a push to `main`
  does not run CI.
- **Adding or bumping an action:** pin it to a full commit SHA and keep the version
  comment in the same style as the existing lines.
- **Changing E2E environment or sharding:** edit the `env:` block in
  `e2e-tests.yml`, and add any new `E2E_*` variable to `turbo.json`
  `passThroughEnv` for `test:e2e`. The signup assertion lives in
  `packages/app-tests/e2e/user/auth-flow.spec.ts`.
- **Changing the image contents:** update `docker/Dockerfile` and the smoke-test
  commands in both `ci.yml` and `build-psd401.yml`.

Validation: the repository configures no local workflow linter. zizmor runs only
inside the org's reusable security scan. The narrowest check is to review the YAML and open a PR so
the workflow runs. The E2E job needs Docker services (`npm run dx:up`), a full
build, and a seeded database. It is expensive and should be run only when a
change affects the E2E path. Locally, the Docker smoke commands need a built
image, which is also expensive.
