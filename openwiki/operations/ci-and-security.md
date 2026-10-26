---
type: Operations
title: CI workflows, security scanning, and automation
description: Which GitHub Actions workflows run on this fork and when, the SHA-pinning and secret-scoping rules, the gitleaks ignore policy, the Claude review check shim for Dependabot, and the OpenWiki refresh job. Read before editing anything under .github/.
tags: [operations, ci, github-actions, security, gitleaks, zizmor]
openwiki:
  roles: [operations, delivery, repository]
  change_kinds: [ci-workflow, supply-chain, secrets, security-scan]
  source_paths:
    - .github/workflows/ci.yml
    - .github/workflows/e2e-tests.yml
    - .github/workflows/codeql-analysis.yml
    - .github/workflows/security-scan.yml
    - .github/workflows/claude-review.yml
    - .github/workflows/openwiki-update.yml
    - .github/workflows/build-psd401.yml
    - .github/workflows/publish.yml
    - .github/workflows/deploy.yml
    - .github/workflows/translations-pull.yml
    - .github/actions/node-install/action.yml
    - .gitleaksignore
    - .github/dependabot.yml
  invariants:
    - Every remote `uses:` reference is pinned to a full commit SHA with the tag kept as a trailing comment; local ./.github/actions references are the only unpinned ones.
    - Reusable workflows from PSD401/.github are called by SHA; a no-op job named claude-review keeps the required Dependabot check green.
    - Secrets are passed by name, never with secrets: inherit, to the OpenWiki and Claude review reusables.
    - A new finding not listed in .gitleaksignore fails the security-scan job.
    - build-psd401.yml is manual only; the GHCR image is built from the fork Dockerfile, not on push.
  validation_commands: ["cd /home/runner/work/documenso/documenso && grep -rn 'uses:' .github | grep -vE '@[0-9a-f]{40}' || true"]
---

# CI workflows, security scanning, and automation

This fork keeps the upstream Documenso workflows and adds PSD401 org
automation. Workflow files are under
[`.github/workflows/`](../../.github/workflows/). Most reusable logic lives in
the org repository `PSD401/.github`; this repo only holds the callers, so
edits to shared behaviour happen there, not here.

## Which workflow runs when

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../../.github/workflows/ci.yml) | push and PR to `main`; `workflow_call` | `build_app` builds the app; `build_docker` builds the Docker image and runs `command -v soffice` and `command -v qpdf` inside it, so a missing converter fails CI. |
| [`e2e-tests.yml`](../../.github/workflows/e2e-tests.yml) | push and PR to `main` | Playwright E2E on a larger runner; copies `.env.example` to `.env` and uses the local node and playwright composite actions. |
| [`codeql-analysis.yml`](../../.github/workflows/codeql-analysis.yml) | push and PR to `main`; manual | CodeQL analysis. |
| [`security-scan.yml`](../../.github/workflows/security-scan.yml) | PR, push to `main`, Monday 09:00 UTC cron, manual | Calls the PSD401 org security-scan reusable, pinned to a SHA. Runs zizmor (workflow static analysis) and gitleaks over full history. |
| [`claude-review.yml`](../../.github/workflows/claude-review.yml) | PR `opened`, `synchronize`, `ready_for_review`, `reopened` | Calls the org Claude review reusable for non-Dependabot PRs. It never fails on findings; it posts review comments. |
| [`openwiki-update.yml`](../../.github/workflows/openwiki-update.yml) | manual, push to `main`, Monday 08:00 UTC cron | Calls the org OpenWiki reusable to regenerate `openwiki/` and open the docs PR. |
| [`build-psd401.yml`](../../.github/workflows/build-psd401.yml) | manual only | Builds and pushes the fork image to GHCR; see [deployment](deployment.md). |
| [`publish.yml`](../../.github/workflows/publish.yml) | push to `release`; manual with a tag | Builds and publishes the platform containers. |
| [`deploy.yml`](../../.github/workflows/deploy.yml) | push of any tag | Pushes the tagged code to the release branch using `GH_TOKEN`. |
| `translations-*.yml`, `stale.yml`, issue and PR labeler workflows | schedules, issue and PR events | Crowdin sync and repository housekeeping inherited from upstream. |

The production deployment path (GHCR image, digest-pinned compose on the
EC2 host) is described in [deployment](deployment.md).

## Rules that CI depends on

**Action pinning.** Every external `uses:` reference is pinned to a commit
SHA, with the resolved tag as a trailing comment (for example
`actions/checkout@11d5960a… # v4.4.0`). This was done for the zizmor high
severity `unpinned-uses` findings in `26176342f`. Local composite actions
(`./.github/actions/node-install`, `playwright-install`) cannot be pinned and
are the only exception. Bumping a pin is a manual edit: the github-actions
entry in [`dependabot.yml`](../../.github/dependabot.yml) sets
`open-pull-requests-limit: 0`, so Dependabot does not open version-update
PRs for actions.

**Secret scoping.** `openwiki-update.yml` passes exactly
`BEDROCK_API_KEY` and `PSD_AUTOMATION_APP_PRIVATE_KEY` to the reusable
(commit `5bf50013c`), instead of inheriting every repository secret.
`claude-review.yml` passes only `BEDROCK_API_KEY`. Keep new reusable calls
to explicit secret names.

**Permissions.** Callers must grant permissions they need. The
`claude-review` caller grants `id-token: write`, and the `openwiki-update`
caller grants `contents: write` and `pull-requests: write`, because org
default tokens are read-only and reusables cannot elevate them.

**Dependabot and the required review check.** The `claude-review` job is
skipped for `dependabot[bot]` because that actor cannot receive
`id-token: write`. Production repos require a `claude-review / claude-review`
status, and a skipped job reports a different context. The
`claude-review-dependabot` job (commit `938a4fd7e`) has the same name, runs
only for Dependabot, has `permissions: {}`, and calls a no-op reusable so the
required context passes.

## Gitleaks findings policy

[`.gitleaksignore`](../../.gitleaksignore) (added in `26176342f`) lists
reviewed findings as `<commit>:<file>:<rule>:<line>`. The header states that
the first group, about 50 entries, is example tokens in upstream Documenso's
own history, so it is public upstream content. Add an entry only after
reviewing a finding as a non-secret. A finding in a new commit still fails
`security-scan`. Do not put real credentials in the ignore file or in any
doc.

## Change guidance

- **Adding an action**: pin it to a full SHA with a `# tag` comment, and check
  with the grep in `validation_commands` above.
- **Adding a reusable call**: pass named secrets only, grant the minimum
  `permissions`, and make sure a Dependabot path still produces the required
  check names.
- **Changing `ci.yml`**: the `build_docker` smoke commands mirror the image
  checks in [deployment](deployment.md). Keep them in sync.
- **Validation**: workflow YAML is checked by running CI on a PR. Local
  checks should stay narrow, such as the grep above. Do not run the full
  Playwright or Docker builds to validate workflow-only edits.
- **Not in this repo**: the org reusables' behaviour (zizmor rules,
  reusable-claude-review prompts, OpenWiki generator). Those live in
  `PSD401/.github`.

Related: the OpenWiki refresh job here regenerates the same `openwiki/`
tree that [quickstart](../quickstart.md) starts from.
