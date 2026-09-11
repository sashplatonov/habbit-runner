# User Workspace State Sync - Review Remediation Backlog

## Goal

Close confirmed data-integrity, recovery, and canonical-state gaps found while reviewing UWS-001 through UWS-006. An incomplete API request must never reset a workspace; a transient client failure must retain every intended change; and users need an accessible recovery path.

## Architectural decisions

- `PreferencesService` and row-locked `PUT /auth/preferences` remain the only server persistence path. Canonical `workspace` and `revision` are an inseparable pair.
- `themeStore` remains the only authenticated browser synchronizer. Its outbox must contain all unsaved typed intent, not just the latest mutation over an older confirmed snapshot.
- The server owns deleted selected-habit cleanup and persists it before returning canonical preferences.
- The protected layout presents global sync recovery. Do not add a second store, endpoint, or browser-local source of truth.
- The legacy full-workspace outbox payload remains a compatibility input, never the representation for new user actions.

## Recommended implementation order

| Order | Task | Priority | Depends on | Reason |
| ---: | --- | --- | --- | --- |
| 1 | UWS-RVW-001 | P0 | - | Prevent a malformed API request from erasing state. |
| 2 | UWS-RVW-002 | P1 | UWS-RVW-001 | Preserve all pending local intent. |
| 3 | UWS-RVW-003 | P1 | UWS-RVW-002 | Provide an accessible recovery control. |
| 4 | UWS-RVW-004 | P2 | UWS-RVW-001 | Persist stale navigation cleanup. |
| 5 | UWS-RVW-005 | P3 | UWS-RVW-001, UWS-RVW-002, UWS-RVW-003, UWS-RVW-004 | Record an accurate completion handoff. |

## UWS-RVW-001: Reject incomplete canonical preference updates

**Status:** DONE
**Priority:** P0
**Depends on:** -

**Exact scope:**

Harden `PUT /auth/preferences` so a request containing only one of `workspace` and `revision` returns `400` and cannot replace stored data with defaults.

**Files:**

- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java`.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java`.
- Modify or create focused resource coverage under `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/resource/`.

**Goal:**

Reject incomplete canonical update shapes before normalization or persistence.

### Outcome

Legacy requests with neither canonical field and canonical requests with both fields remain valid. A matching revision without a workspace, or a workspace without a revision, preserves every existing workspace section and revision.

### Architectural decision

`PreferencesService` owns the cross-field validity rule because it distinguishes documented legacy compatibility from the canonical path. `normalize(null)` must never imply a replace-with-defaults update.

### Required changes

1. Validate that `workspace` and `revision` are either both present or both absent before selecting an update path.
2. Return the existing validation error contract with `400`; retain valid canonical conflict behavior and legacy theme-only compatibility.
3. Add service and resource regression coverage for both incomplete shapes, proving theme, timezone, stored workspace, and revision stay unchanged.

### Out of scope

- Workspace schema, revision algorithm, legacy dashboard migration, and frontend payload changes.

### Acceptance criteria

- `{ theme, revision }` at the current revision returns `400` and cannot reset Dashboard, Progress, navigation, or theme usage.
- `{ theme, workspace }` without revision returns `400` and performs no write.
- A complete valid request increments exactly once; a stale complete request still returns `409` with current preferences.

### Targeted validation

```bash
cd apps/backend && ./mvnw test -Dtest=AuthPersistenceCoverageTest,AuthPreferencesResourceUnitTest
```

### Commit

```bash
git add apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/resource/
git commit -m "fix(preferences): reject incomplete canonical updates"
```

## UWS-RVW-002: Preserve every pending workspace mutation across failures

**Status:** DONE
**Priority:** P1
**Depends on:** UWS-RVW-001

**Exact scope:**

Retain all unsaved, non-overlapping workspace changes when one write fails and the user makes another change before recovery.

**Files:**

- Modify `apps/web/src/lib/stores/theme.ts`.
- Modify `apps/web/src/lib/dashboard/preferences.ts`.
- Modify `apps/web/tests/unit/themeStore.test.ts`.
- Modify `apps/web/tests/unit/workspacePreferencesStore.test.ts`.

**Goal:**

A transient write failure followed by another preference action cannot silently discard the earlier local intent from the server-confirmed profile or retry outbox.

### Outcome

The synchronizer persists a complete rebasable pending intent, applies it to the newest confirmed/conflict response for every retry, and clears only changes confirmed by the server.

### Architectural decision

Keep one queue and one per-user outbox, but represent all outstanding section mutations (or an equivalent normalized desired state with safe rebase metadata). Do not restore normal full-snapshot writes or create page-level queues.

### Required changes

1. Replace the overwritten single `pending` mutation with a bounded typed representation of every unsaved Dashboard, Progress, navigation, theme usage, theme, and timezone intent.
2. Calculate subsequent queued requests from pending intent and the newest confirmed profile, not an obsolete `confirmed` snapshot after a failure.
3. Rebase complete pending intent once on `409` and retain it after a retry failure; preserve parsing of existing single-mutation outbox records when safe.
4. Add failed-Dashboard-then-Progress and the same sequence with a conflict regressions; final state must contain both local changes and unrelated remote data.

### Out of scope

- Live subscriptions, background sync, new backend endpoints, and workspace schema changes.

### Acceptance criteria

- A failed Dashboard mutation then a successful Progress mutation leaves both changes in the confirmed workspace.
- A `409` after that sequence preserves both local sections and an independent remote section.
- Reload replays all recoverable pending changes for the authenticated user only.

### Targeted validation

```bash
cd apps/web && npm run test -- tests/unit/themeStore.test.ts tests/unit/workspacePreferencesStore.test.ts && npm run check:types
```

### Commit

```bash
git add apps/web/src/lib/stores/theme.ts apps/web/src/lib/dashboard/preferences.ts apps/web/tests/unit/themeStore.test.ts apps/web/tests/unit/workspacePreferencesStore.test.ts
git commit -m "fix(workspace): retain pending preference mutations"
```

## UWS-RVW-003: Show preference-sync failures and provide accessible retry

**Status:** DONE
**Priority:** P1
**Depends on:** UWS-RVW-002

**Exact scope:**

Expose authenticated synchronization errors in the protected UI and let the user retry retained pending intent without changing the selected workspace state.

**Files:**

- Modify `apps/web/src/lib/stores/theme.ts`.
- Modify `apps/web/src/routes/app/(protected)/+layout.svelte` or its current authenticated layout owner.
- Modify or create focused tests under `apps/web/tests/unit/`.
- Modify `apps/web/tests/e2e/workspace-preferences.spec.ts` only if its route harness can prove visible retry deterministically.

**Goal:**

An authenticated user can see that a preference change remains pending and retry it through the canonical store.

### Outcome

The protected app renders concise live status and a keyboard-operable Retry control. The error clears only after server confirmation.

### Architectural decision

The protected layout is the sole global presentation owner; the store provides one explicit retry operation that reuses queue/outbox conflict handling. Do not add page-specific toasts or localStorage recovery.

### Required changes

1. Add a typed retry operation that is a no-op without pending intent and otherwise reuses the canonical conflict/rebase path.
2. Render `syncError` only for authenticated sessions with an equivalent of `role=status` and an accessible Retry button.
3. Preserve optimistic workspace state while retrying; cover keyboard activation, repeated clicks, no-pending behavior, and failure then successful retry.

### Out of scope

- Notification-center redesign, PWA background sync, and infinite automatic retries.

### Acceptance criteria

- A failed authenticated save yields a visible, screen-reader-announced status and accessible Retry action.
- Retry is keyboard-operable and meets a 44px touch-target minimum where directly touched.
- The control resends retained intent and disappears only after confirmed success; anonymous/showcase use shows neither control nor error.

### Targeted validation

```bash
cd apps/web && npm run test -- tests/unit/themeStore.test.ts tests/unit/workspacePreferencesStore.test.ts && npm run check:types
cd apps/web && npm run test:e2e -- tests/e2e/workspace-preferences.spec.ts --project=desktop
```

### Commit

```bash
git add apps/web/src/lib/stores/theme.ts apps/web/src/routes/app/\(protected\)/+layout.svelte apps/web/tests/unit/ apps/web/tests/e2e/workspace-preferences.spec.ts
git commit -m "fix(workspace): expose preference sync recovery"
```

## UWS-RVW-004: Persist deleted selected-habit cleanup

**Status:** DONE
**Priority:** P2
**Depends on:** UWS-RVW-001

**Exact scope:**

Persist normalized navigation when a preferences read discovers that selected habit no longer exists or is no longer owned by the user.

**Files:**

- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java`.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java`.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java` if it owns the selected-habit fixture.

**Goal:**

The database and every later device agree that a deleted selected habit was cleared, rather than only masking it in one response.

### Outcome

The first authenticated read after deletion returns Dashboard navigation, writes the normalized workspace under the existing transaction/lock, and increments revision once.

### Architectural decision

`PreferencesService.getUserPreferences` already owns canonical migration under the row lock, so reuse it for cleanup. Do not make the frontend infer deletion or add a background cleanup job.

### Required changes

1. Detect a changed result from `clearMissingSelectedHabit` and persist workspace/revision before building the response.
2. Preserve existing safe Dashboard fallback and never clear an owned existing habit.
3. Add integration coverage that deletes a selected habit, verifies the first response and stored entity normalize, then proves a second read does not increment revision again.

### Out of scope

- Habit deletion behavior, route UI, and cleanup for inactive users.

### Acceptance criteria

- After deletion, `GET /auth/preferences` returns Dashboard with no selected ID and persists that same canonical state.
- Cleanup advances revision exactly once; a following read leaves it unchanged.
- Existing owned detail restoration remains valid and foreign IDs remain rejected on update.

### Targeted validation

```bash
cd apps/backend && ./mvnw test -Dtest=AuthPersistenceCoverageTest,AuthDataAccessTest
```

### Commit

```bash
git add apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java
git commit -m "fix(preferences): persist deleted habit cleanup"
```

## UWS-RVW-005: Record the completed remediation handoff accurately

**Status:** TODO
**Priority:** P3
**Depends on:** UWS-RVW-001, UWS-RVW-002, UWS-RVW-003, UWS-RVW-004

**Exact scope:**

Replace the stale `pending` commit marker in the workspace-sync execution state after all remediation tasks are verified and committed.

**Files:**

- Modify `docs/.backlog-execution-state.md`.
- Modify `docs/user-workspace-state-sync-review-backlog.md`.

**Goal:**

The persistent handoff identifies the final verified remediation commit and no longer reports `pending`.

### Outcome

Future executors can identify actual completed work, verification, and blockers from the compact state file.

### Architectural decision

Treat execution state as an operational handoff. Record the final remediation reference in a separate `chore(backlog)` handoff commit, following repository history.

### Required changes

1. Mark each review task `DONE` only after its own committed verification.
2. After UWS-RVW-004, update execution state with the actual remediation reference, `next_item: none`, real blockers, and verification summary.
3. Keep state under 30 lines without implementation history.

### Out of scope

- Rewriting UWS-001 through UWS-006 history, product-code changes, and release work.

### Acceptance criteria

- The execution state contains no `commit_hash: pending` after the remediation handoff.
- Review task statuses match committed verification state and the handoff states only actual blockers.

### Targeted validation

```bash
git diff --check
```

### Commit

```bash
git add docs/.backlog-execution-state.md docs/user-workspace-state-sync-review-backlog.md
git commit -m "chore(backlog): record workspace sync remediation"
```

## Rejected observations

- The legacy full-workspace outbox cannot safely rebase after a conflict, but current code uses it only for compatibility/bootstrap paths and explicitly declines that retry. There is no confirmed current path that creates it, so no separate task is added.
- Passing local tests and desktop E2E are not production PWA, remote CI, deployment, or physical-device proof.
