# GitHub Automation

<a name="top"></a>

## 📋 Table of Contents

- [Current state](#current-state)
- [Quality decision table](#quality-decision-table)
- [Remote evidence](#remote-evidence)
- [Renovate](#renovate)
- [Security scanning](#security-scanning)

---

## 🧭 Current state <a name="current-state"></a>

The current checkout includes:
- `.github/renovate.json`
- `.github/workflows/quality.yml` (`CI - Main`), which dispatches the
  incremental profile for `main` pushes and pull requests targeting `main`
- `.github/workflows/release-quality.yml` (`CI - Release`), which dispatches
  the full profile for `release` pushes and manual runs
- `.github/workflows/quality-lanes.yml`, the single reusable implementation of
  backend verify, PostgreSQL integration, frontend verification, Trivy security
  scans, and the bounded Compose smoke job

The current checkout now treats Trivy as an active CI gate rather than a manual-only check.

`CI - Main` is incremental after its trigger-level documentation ignores. `CI - Release` is
full after its trigger-level documentation ignores. Both callers use the same authoritative
changed-path classifier in `scripts/ci/classify-quality-paths.sh`; this document describes its
policy but does not duplicate its matching expressions.

All jobs keep the existing cancellation, timeout, Maven/npm caches, and three-day failure-artifact
retention. Local checks validate the decision table, but actual GitHub-hosted minute savings must
be measured from fresh pushed workflow runs.

The Compose smoke job runs [`scripts/ci/smoke-stack.sh`](../../scripts/ci/smoke-stack.sh)
after the build and test jobs. The script uses `.env.example`, builds both images,
waits for PostgreSQL/Flyway and container health, checks API liveness/readiness,
checks the web container and its `/api` proxy, and always removes the stack and
database volume with a shell trap. The OpenAPI snapshot drift check remains in
the backend verification job and is a prerequisite of the smoke job.

Local smoke verification:

```bash
./scripts/ci/smoke-stack.sh
```

## Dashboard delivery contract

Dashboard view preferences are account-owned through `GET/PUT /auth/preferences`.
The Flyway change is additive; rollback is to deploy the previous application
version and, if required, remove only the new `dashboardPreferences` column in a
forward migration after confirming no newer application is still writing it.
Legacy clients that send only theme and timezone continue to receive the existing
defaults. Search text remains URL state and is intentionally not persisted.

Momentum visuals are derived at read time: a flame means a current scheduled
streak, while an ice state means a positive, non-archived habit has missed at least
seven scheduled non-frozen days since its latest successful completion. Frozen,
negative, archived, and not-yet-due habits do not receive ice. This policy is
shared by dashboard cards and compact rows.

The decision table below is the source of truth for the expected topology. Local
runs prove build and behavior only; GitHub Actions minute savings require fresh
pushed workflow runs and their URLs and durations.

## Quality decision table <a name="quality-decision-table"></a>

| Change or event | Automatic workflow | Selected profile and lanes |
|---|---|---|
| Markdown/docs-only, `LICENSE`, issue/PR templates, or `.DS_Store` | None | Trigger ignored; no hosted minutes |
| Frontend or shared package | `CI - Main` | Incremental: frontend and security; backend, PostgreSQL, and smoke skipped |
| Backend, migration, or OpenAPI | `CI - Main` | Incremental: backend, PostgreSQL integration, security, and smoke; frontend skipped |
| Runtime, Docker/Compose, CI script, dependency manifest, or workflow/Renovate configuration | `CI - Main` | Incremental: all quality lanes selected by the safety boundary |
| Any non-ignored `release` push or manual release dispatch | `CI - Release` | Full: backend, PostgreSQL integration, security, frontend, and smoke |

In the incremental profile, backend verification and PostgreSQL integration are
selected together only when the backend lane is selected. A release run always
uses the full profile regardless of which runtime path changed. A single push
cannot start both branch callers.

## Remote evidence <a name="remote-evidence"></a>

Local `actionlint` and shell checks prove workflow syntax and selection logic
only. Remote GitHub Actions runs prove event queueing, job skips, runner
duration, and the observed hosted-minute impact. Neither type of check proves
Dokploy deployment; deployment evidence must be collected separately.

The pre-refactor baseline is recorded here for comparison:

| Baseline run | Workflow | SHA | Observed window | Job result summary |
|---|---|---|---|---|
| [34709717197](https://github.com/sashplatonov/habit-runner/actions/runs/34709717197) | `Quality` on `main` | `002ec7ff` | 17:56:48–18:07:16 UTC (10m 28s) | frontend, security, smoke passed; backend and PostgreSQL skipped |
| [34707598194](https://github.com/sashplatonov/habit-runner/actions/runs/34707598194) | `Quality` on `release` | `002ec7ff` | 17:13:52–17:24:48 UTC (10m 56s) | frontend, security, smoke passed; backend and PostgreSQL skipped |

Post-refactor samples are pending ordinary remote work: one frontend-only
`CI - Main` run, one backend-only `CI - Main` run, and one full `CI - Release`
run. The remote repository currently has no runs under those new workflow
names, so no hosted-minute saving conclusion is claimed yet. Once available,
record each URL, selected/skipped job results, and start/end timestamps here;
any comparison is observed sample evidence, not a guaranteed future-minute
total.

[↑ Back to top](#top)

---

## 🤖 Renovate <a name="renovate"></a>

Renovate configuration lives in `.github/renovate.json`.

Current behavior:
- extends `config:recommended`;
- uses timezone `Europe/Belgrade`;
- schedules updates after 06:00 on Monday;
- labels Renovate PRs with `dependencies`;
- groups npm patch/minor/digest updates together;
- groups Docker-related updates together.

Manual validation:

```bash
npx renovate --dry-run --token="$GITHUB_TOKEN"
```

Review expectation:
- validate frontend commands from `apps/web`;
- validate backend Maven commands from `apps/backend`;
- update docs when dependency changes alter commands, config names, or runtime behavior.

[↑ Back to top](#top)

---

## 🛡️ Security scanning <a name="security-scanning"></a>

Trivy now runs in GitHub Actions for both application trees.

Manual examples:

```bash
trivy fs --scanners vuln .
trivy image habbit-runner-web:latest
trivy image habbit-runner-api:latest
```

The workflow scans:
- `apps/web` for frontend code, lockfiles, and Dockerfile misconfigurations;
- `apps/backend` for backend code, secrets, and Dockerfile misconfigurations while skipping `pom.xml` to avoid network-dependent Maven resolution.

If you extend the automated scanning later, update this doc together with:
- workflow files in `.github/workflows`;
- rollout or remediation instructions;
- any required secrets or SARIF upload steps.

[↑ Back to top](#top)
