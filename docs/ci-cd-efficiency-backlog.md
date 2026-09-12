# CI/CD Efficiency and Branch Separation - Implementation Backlog

## Goal

Restore path-aware GitHub Actions so documentation and unrelated changes consume no hosted minutes, run only the quality lanes affected by a code change on `main`, and run one complete promotion gate on `release`. The workflows must have one implementation of each quality job, no cross-branch trigger overlap, and a measured remote result. Production deployment remains Dokploy-owned and must not be silently redirected by this CI refactor.

## Evidence and baseline

- The current single workflow, `.github/workflows/quality.yml`, has no `paths-ignore` and forces `backend`, `frontend`, `security`, and `smoke` to `true`, so it runs all five quality jobs for every trigger.
- Its immediately preceding version already contained a safe changed-path classifier and ran PostgreSQL integration only when the backend lane was selected. Commit `78a9fd13` removed those guards.
- On 2026-09-12, remote runs `34709717197` (`main`) and `34707598194` (`release`) both validated the same SHA `002ec7ffa802f6254a690bb9de22e44dd1ba24d9`; each lasted about ten minutes. This is evidence of branch-trigger duplication, not a local estimate of billable minutes.
- GitHub reports no branch protection for either `main` or `release` at planning time. The repository currently has one active workflow named `Quality`.
- The maintainer confirms that live Dokploy is configured to deploy on `release` changes. The checked-in generated `.dokploy/state.yml` still names `main`, so it is stale evidence and must not be used to infer or alter the live deployment source. No GitHub Actions deployment workflow or deployment credential exists in this checkout.

## Architectural decisions

- Keep the existing quality commands, timeouts, caches, failure-only artifacts, least-privilege `contents: read`, and cancellation behavior. Minute savings come from selecting fewer jobs, not weakening test, security, PostgreSQL, browser, or Compose gates.
- Use one repository-owned Bash classifier and one reusable `workflow_call` quality workflow. This avoids copying the job graph into branch dispatchers and avoids adding a third-party path-filter action and its supply-chain/update lifecycle.
- `CI - Main` handles `pull_request` targeting `main` and direct `push` to `main`, runs the incremental profile, and never listens to `release`. `CI - Release` handles only `push` to `release` plus manual dispatch, runs the full profile, and never listens to `main` or `pull_request`. A promoted commit can therefore receive an intentional full release validation, but no single push starts both branch workflows.
- `paths-ignore` is a dispatcher optimization only. Use it only for proven non-runtime files: Markdown/documentation, `LICENSE`, GitHub issue/PR templates, and `.DS_Store`. Do not ignore images, static assets, Docker files, dependency manifests, Compose files, `.github/workflows/**`, `.github/renovate.json`, test files, or generated OpenAPI: each can affect a shipped build, CI behavior, or a contract.
- In the incremental profile, a backend lane includes `apps/backend/**` and `spec/openapi/**`; it alone enables backend verification and PostgreSQL integration. A web lane includes `apps/web/**`, including `apps/web/packages/shared/**`. Workflow, Renovate, runtime/Docker/Compose, CI-script, root dependency-manifest, or classifier changes are safety boundaries: they select every affected lane rather than allowing filtering to hide a broken gate.
- The release profile forces every quality lane after trigger-level ignores. It is the one complete CI promotion check, while `main` remains cheap and path-aware.
- Keep CD out of the GitHub workflow refactor. Dokploy is the current deployment authority and deploys `release` changes. Do not add a webhook/token or declare a successful CI run as proof of a deployed release; deployment still requires separate external verification.

## Recommended implementation order

| Order | Task | Priority | Depends on | Reason |
| ---: | --- | --- | --- | --- |
| 1 | CICD-001 | P1 | - | Extract one tested path-selection contract before any dispatcher starts calling it. |
| 2 | CICD-002 | P1 | CICD-001 | Atomically replace the overlapping trigger with separate main and release callers. |
| 3 | CICD-003 | P2 | CICD-002 | Document the decision table and prove the billed remote behavior after a normal change. |
| 4 | CICD-004 | P1 | CICD-003 | Verify the existing Dokploy release-deployment contract without changing its authority or source. |

## CICD-001: Extract the reusable path-aware quality contract

**Status:** DONE
**Priority:** P1
**Depends on:** -

**Exact scope:**

Create an internal, reusable quality workflow and a repository-owned changed-path classifier while leaving the currently active `Quality` dispatcher operational. Move the current backend, PostgreSQL, security, frontend, and Compose jobs without changing their commands or quality thresholds.

**Files:**

- Create `.github/workflows/quality-lanes.yml`.
- Create `scripts/ci/classify-quality-paths.sh`.
- Create `scripts/ci/test-classify-quality-paths.sh`.
- Search anchors: `Enable full verification suite`, `verify-postgres-integration`, and `smoke-stack` in `.github/workflows/quality.yml`.

**Goal:**

One callable workflow owns every expensive job, and one testable classifier owns the boolean lane-selection contract. The existing triggered workflow continues to work until the callers are switched in the next task.

### Outcome

The reusable workflow accepts an explicit `incremental` or `full` profile. Its incremental job graph runs only selected lanes; its full profile selects every lane. The classifier produces the same named `backend`, `frontend`, `security`, and `smoke` outputs used by the current workflow.

### Architectural decision

The classifier is a small shell boundary rather than inline YAML or a duplicated third-party filter configuration. It must accept the event/base/head context required by both `pull_request` and `push`, write only validated boolean outputs to `$GITHUB_OUTPUT`, and keep diff resolution and path policy in one place. `quality-lanes.yml` is called only by repository-local dispatchers; it must not become a public cross-repository API.

### Required changes

1. Extract the current robust base/head diff handling (PR base SHA, normal push range, and first-push fallback) into `classify-quality-paths.sh`; preserve `set -Eeuo pipefail` and fail closed when Git cannot determine the requested commit range.
2. Define and test this matrix: backend/OpenAPI selects backend, PostgreSQL, security, and smoke as applicable; web/shared selects frontend and security but not PostgreSQL; Docker/Compose/CI script changes select smoke and every build input it depends on; workflow or Renovate changes select every affected lane; a file outside every code/runtime filter selects no lane in incremental mode; `full` selects every lane.
3. Add `quality-lanes.yml` with `workflow_call`, a typed profile input, the classifier job, and the existing jobs wired through `needs` and the four outputs. Restore each job's conditional execution and allow `smoke-stack` only when its selected prerequisites either succeed or are legitimately skipped.
4. Preserve the current Maven/Node versions, cache keys, test commands, Trivy/Gitleaks configuration, artifact paths/retention, timeout limits, and Compose/browser contract commands exactly. Do not fold PostgreSQL into the fast backend job or make a skipped quality lane report success without its condition being false.
5. Keep `.github/workflows/quality.yml` unchanged in this commit; the reusable workflow has no independent push/PR trigger, so this extraction cannot create duplicate hosted runs.

### Out of scope

- Changing test coverage, Trivy severity, artifact retention, runtime images, Docker/Compose behavior, application code, or deployment.
- Adding `dorny/paths-filter`, another external action, a matrix fan-out, or a second copy of the quality jobs.
- Changing branch triggers or adding `paths-ignore`; that atomic dispatcher change belongs to CICD-002.

### Acceptance criteria

- `quality-lanes.yml` contains the sole callable implementation of backend, PostgreSQL, security, frontend, and smoke jobs; it has no `push` or `pull_request` trigger.
- The classifier test proves each matrix row, including empty/doc-only input, workflow edits, a frontend-only edit, a backend-only edit, and `full` mode.
- A frontend-only changed-file fixture leaves `backend=false`; therefore neither `verify-backend` nor `verify-postgres-integration` is eligible in the incremental profile.
- A backend-only fixture sets `backend=true`; both backend verification and PostgreSQL integration are eligible, without relying on frontend changes.
- A workflow configuration fixture selects all dependent lanes so a future workflow edit cannot be silently untested.
- Existing smoke prerequisites accept only `success` or intentional `skipped` results for lanes not selected by the classifier.

### Targeted validation

```bash
bash scripts/ci/test-classify-quality-paths.sh
actionlint .github/workflows/quality-lanes.yml
git diff --check
```

### Commit

```bash
git add .github/workflows/quality-lanes.yml scripts/ci/classify-quality-paths.sh scripts/ci/test-classify-quality-paths.sh
git commit -m "refactor(ci): extract reusable quality lanes"
```

## CICD-002: Split branch dispatchers and restore safe trigger ignores

**Status:** DONE
**Priority:** P1
**Depends on:** CICD-001

**Exact scope:**

Atomically replace the current dual-branch `Quality` trigger with two thin callers of the reusable workflow. This task is the only one that changes event routing and trigger-level path ignores.

**Files:**

- Modify `.github/workflows/quality.yml`.
- Create `.github/workflows/release-quality.yml`.
- Search anchor: `on:` and `concurrency:` in `.github/workflows/quality.yml`.
- Search anchor: `workflow_call` in `.github/workflows/quality-lanes.yml`.

**Goal:**

`main` and `release` use different, non-overlapping dispatchers while sharing the same job implementation. Non-code-only changes start no GitHub-hosted runner.

### Outcome

A web-only change to `main` calls the incremental profile and skips backend/PostgreSQL. A code change promoted to `release` receives exactly one full release-quality invocation. Documentation-only changes matched by the ignore list start neither dispatcher.

### Architectural decision

Retain `quality.yml` as the `CI - Main` caller to avoid an unnecessary workflow rename for existing links, but replace its job bodies with one `uses: ./.github/workflows/quality-lanes.yml` job. `release-quality.yml` is a separate caller with the same interface and a `full` input. The caller files own branch/event/concurrency policy only; job commands remain exclusively in `quality-lanes.yml`.

### Required changes

1. Configure `quality.yml` to listen only to `pull_request` with base branch `main` and `push` to `main`; call the reusable workflow with the `incremental` profile. Use a concurrency key that includes the caller workflow and ref, and preserve cancellation of superseded runs on the same ref.
2. Create `release-quality.yml` named `CI - Release`, triggered only by `push` to `release` and `workflow_dispatch`; call the reusable workflow with the `full` profile. Do not add a `pull_request` trigger, because its succeeding release push would re-run the same release policy.
3. Apply the same `paths-ignore` list to each automatic trigger: `docs/**`, `**/*.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`, and `**/.DS_Store`. Keep `workflow_dispatch` available even when the latest commit is documentation-only.
4. Ensure `.github/workflows/**`, `.github/renovate.json`, `scripts/ci/**`, Dockerfiles, Compose files, lockfiles/manifests, `spec/openapi/**`, application static assets, and tests are not in `paths-ignore`; the reusable classifier decides their lane selection.
5. Update caller/reusable permissions and secrets only as needed for the present GITHUB_TOKEN-based scans. Do not add deployment tokens, Dokploy webhooks, secrets, or write permissions.
6. Confirm the names of required checks before enabling branch protection in the future. Because GitHub currently reports both branches as unprotected, do not claim trigger-level ignores are compatible with a required check until branch rules are configured and exercised.

### Out of scope

- Automatic merge, branch-protection policy changes, release creation, image publishing, Dokploy configuration, and production deployment.
- Ignoring all non-application-looking file extensions, including images or static assets that can alter the published frontend.
- Duplicating the reusable workflow jobs in either branch caller.

### Acceptance criteria

- `quality.yml` has no `release` trigger, and `release-quality.yml` has no `main` or `pull_request` trigger.
- Neither caller contains Maven, npm, Playwright, Trivy, Gitleaks, Docker, or smoke job steps; both call the same repository-local reusable workflow.
- A documentation-only automatic event matching only the stated ignore paths queues no workflow; a workflow, dependency, Docker/Compose, test, OpenAPI, web, or backend change still queues the appropriate caller.
- On `main`, a frontend-only change does not make the backend or PostgreSQL jobs runnable; a backend-only change makes both runnable.
- On `release`, every non-ignored event selects backend, PostgreSQL, security, frontend, and smoke regardless of its individual changed path.
- One push to either branch can match at most one caller workflow; no push starts both `CI - Main` and `CI - Release`.

### Targeted validation

```bash
actionlint .github/workflows/quality.yml .github/workflows/release-quality.yml .github/workflows/quality-lanes.yml
bash scripts/ci/test-classify-quality-paths.sh
git diff --check
```

### Commit

```bash
git add .github/workflows/quality.yml .github/workflows/release-quality.yml
git commit -m "refactor(ci): separate main and release dispatchers"
```

## CICD-003: Publish the CI decision table and verify hosted-run savings

**Status:** IN_PROGRESS
**Priority:** P2
**Depends on:** CICD-002

**Exact scope:**

Bring the operations documentation into agreement with the new three-workflow topology and collect remote evidence from ordinary post-merge work. This task changes no CI policy and does not create synthetic production commits merely to obtain a duration.

**Files:**

- Modify `docs/operations/github-automation.md`.
- Modify `README.md` only if its delivery summary no longer accurately describes the workflow topology.
- Search anchors: `The quality workflow first classifies changed paths` in `docs/operations/github-automation.md` and `path-aware GitHub Actions lanes` in `README.md`.

**Goal:**

Maintainers can predict which branch workflow and which lanes will run before pushing, and the claimed savings are backed by GitHub-hosted run data rather than local timings.

### Outcome

The documentation has a compact table for ignored paths, incremental main lanes, full release lanes, and the explicit CD boundary. It records URLs/IDs and durations of representative remote runs after the refactor without claiming they prove deployment.

### Architectural decision

`docs/operations/github-automation.md` is the human-readable policy; `classify-quality-paths.sh` and `quality-lanes.yml` remain executable sources of truth. Do not duplicate Bash regular expressions in the documentation or use README prose as a second configuration source.

### Required changes

1. Replace the obsolete single-workflow description with `CI - Main`, `CI - Release`, and reusable quality lanes; state exactly that main is incremental and release is full after trigger ignores.
2. Include a decision table covering Markdown/docs-only, frontend-only, backend/OpenAPI, runtime/workflow, and release changes. State that backend and PostgreSQL integration are selected together only for the backend lane in the incremental profile.
3. State that local `actionlint`/shell checks prove configuration syntax and selection logic only; remote GitHub Actions runs prove queueing, job skips, runner duration, and actual hosted-minute impact; neither proves Dokploy deployment.
4. After normal eligible changes are merged, record a representative main frontend-only run, a representative main backend-only run, and a release run using their GitHub URLs, selected/skipped job results, and start/end durations. Compare each to baseline run IDs `34709717197` and `34707598194`; label any conclusion as observed sample evidence, not a guaranteed future-minute total.
5. If the first remote run exposes a caller/reusable permissions, status-check, path matching, or skip-dependency error, return to CICD-001 or CICD-002 to fix the root cause; do not mask it by making all jobs unconditional.

### Out of scope

- Modifying application source, quality commands, branch rules, deploy configuration, or GitHub billing settings.
- Claiming production/Dokploy success from GitHub Actions success.
- Publishing internal logs, tokens, credentials, or full GitHub event payloads in documentation.

### Acceptance criteria

- The operations document names the three workflow files and identifies one authoritative executable classifier rather than reproducing filter expressions.
- The documented decision table agrees with all classifier test fixtures.
- At least one actual remote main run demonstrates a skipped expensive lane when its component did not change, and one actual remote release run demonstrates the full profile; their URLs and durations are recorded.
- The documentation distinguishes remote CI evidence from deployment evidence and does not promise a specific free-tier minute saving before enough representative runs exist.

### Targeted validation

```bash
rg -n 'quality-lanes\.yml|CI - Main|CI - Release|Dokploy' docs/operations/github-automation.md
git diff --check
gh run list --repo sashplatonov/habbit-runner --workflow 'CI - Main' --limit 20 --json databaseId,url,createdAt,updatedAt,conclusion,headSha
gh run list --repo sashplatonov/habbit-runner --workflow 'CI - Release' --limit 20 --json databaseId,url,createdAt,updatedAt,conclusion,headSha
```

### Commit

```bash
git add docs/operations/github-automation.md README.md
git commit -m "docs(ci): record branch quality policy"
```

### CHECKPOINT

- completed: Replaced the obsolete single-workflow description, added the
  decision table, and documented the local-versus-remote evidence boundary and
  pre-refactor baseline runs.
- remaining: Record one ordinary post-refactor frontend-only `CI - Main` run,
  one backend-only `CI - Main` run, and one full `CI - Release` run with URLs,
  selected/skipped jobs, and start/end durations; then compare them as observed
  sample evidence.
- changed files: `docs/operations/github-automation.md`,
  `docs/ci-cd-efficiency-backlog.md`, `docs/.backlog-execution-state.md`.
- verification: `gh run list` found no remote workflows named `CI - Main` or
  `CI - Release`; baseline runs `34709717197` and `34707598194` are the old
  `Quality` workflow on SHA `002ec7ff`. `git diff --check` passed.
- confirmed blocker: the refactor commits are local (`release` is ahead of
  `origin/release`); no post-refactor remote run exists. Do not fabricate a
  duration or push solely to create synthetic evidence.
- next exact action: after normal eligible changes are merged and the new
  workflows run remotely, append their evidence, change this status to `DONE`,
  update execution state, run the targeted checks, and commit the completed
  item atomically.

## CICD-004: Verify the Dokploy release deployment contract

**Status:** TODO
**Priority:** P1
**Depends on:** CICD-003

**Exact scope:**

Verify that the existing live Dokploy configuration deploys changes to `release` after the new full release-quality gate is in place. The repository's generated `.dokploy/state.yml` is stale and is read-only evidence only; this task must not attempt to reconcile it manually.

**Files:**

- External Dokploy project `habbit-runner`, Compose application `habbit-runner`.
- Read-only reference `.dokploy/state.yml` (`git.branch`).
- Modify `docs/setup/getting-started.md` and `docs/operations/reliability-rollout.md` after the release deployment behavior is successfully verified.

**Goal:**

The existing `release` deployment source has a verifiable post-deploy health check, without placing deployment credentials in GitHub Actions or editing generated Dokploy state by hand.

### Outcome

Dokploy's live source remains `release`, and the documentation states that policy. A deployment is proven by Dokploy rollout evidence plus the configured public readiness endpoint, separately from CI run results.

### Architectural decision

Dokploy remains the CD authority, with `release` as the confirmed live source. `.dokploy/state.yml` is generated state and stale in this checkout, so it is not a supported mechanism to alter or verify the live project. A GitHub Actions deploy job is prohibited unless a later approved design supplies an authenticated, least-privilege Dokploy integration and rollback contract.

### Required changes

1. Confirm through the Dokploy UI/API that the live Compose application still uses `release`; do not treat `.dokploy/state.yml` as proof because its branch value is stale.
2. Trigger or observe one controlled deployment caused by an eligible `release` change and capture both the Dokploy rollout and release-quality workflow timestamps. Preserve the existing Compose application, external network, environment-variable contract, and database ownership; do not assume CI completion blocks or orders the Dokploy rollout.
3. Inspect the Dokploy rollout status/logs and verify the configured public `GET /api/q/health/ready` endpoint without exposing secrets or response bodies.
4. Update the two deployment documents with the `release` source, the full release-quality gate, rollback instruction, and the distinction between a CI pass and a live deployment.
5. Record the external rollout identifier/URL and health-check result in the delivery handoff; if the rollout fails, use the existing Dokploy rollback procedure and investigate without changing CI quality gates.

### Out of scope

- Editing `.dokploy/state.yml` manually, creating a GitHub deployment token/webhook, changing production secrets, schema/data migration, or loosening health checks.
- Treating local Compose, a GitHub Actions green run, or a DNS response as a complete production verification.

### Acceptance criteria

- Dokploy's live source is confirmed as `release`, and no GitHub Actions workflow contains a deployment credential or deploy command.
- A fresh Dokploy rollout caused by a `release` change reaches the public readiness endpoint successfully; its evidence is recorded separately from CI evidence.
- Documentation identifies the checked-in Dokploy state as non-authoritative when it disagrees with the live setting and does not claim that the release-quality workflow gates Dokploy timing.
- Documentation tells an operator how to use the existing Dokploy rollback procedure without deleting data or environment variables.

### Targeted validation

```bash
docker compose -f docker-compose.dokploy.yml config --quiet
curl -fsS -o /dev/null -w 'deployed ready HTTP %{http_code}\n' https://<configured-domain>/api/q/health/ready
```

### Commit

```bash
git add docs/setup/getting-started.md docs/operations/reliability-rollout.md
git commit -m "docs(deploy): verify release deployment policy"
```
