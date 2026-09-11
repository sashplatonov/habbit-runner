# User Workspace State Sync - Implementation Backlog

## Goal

Make the authenticated user's current workspace portable between devices. The selected theme, primary screen, selected habit when it is safe to restore, Dashboard filters/search/tags/sort/density, and Progress period must be stored in the user's backend profile and restored on another authenticated device. Browser storage may only be a short-lived retry outbox; it must not be the authenticated source of truth.

## Architectural decisions

- `GET`/`PUT /auth/preferences` remains the single profile-preferences API. It will evolve from the current `theme + timezone + dashboard` contract to a versioned, typed `UserWorkspacePreferences` contract; do not add a parallel settings endpoint or a client-only store.
- `users.workspacePreferences` is the canonical persisted JSON document. It is serialized only at the backend persistence boundary and represented in Java and TypeScript by named, closed types; it must not contain `Map<String, Object>`, arbitrary path strings, or index-based values. The existing `users.theme` and `users.timezone` columns remain their established owners.
- The workspace document has separately typed Dashboard, Progress, navigation, and theme-usage sections. Closed values are enums/literal unions with stable wire values; user-created tags and an optional selected habit ID are bounded scalar values. `WorkspaceScreen` only permits real restorable authenticated screens, and a selected habit must belong to the requesting user.
- Concurrent devices use an optimistic `workspacePreferencesRevision`, carried by the response and update request. The backend locks the user's row, rejects a stale authenticated update with `409`, and returns or makes available the current canonical profile. The web store reloads, reapplies the single intended mutation, and retries once; it must never silently overwrite a newer remote workspace.
- `dashboardPreferences` and its current API projection are read-only compatibility inputs during the transition. On the first canonical write, the service converts that stored server value into `workspace.dashboard`; it does not discard existing settings. The old browser keys are imported only when the server workspace has never been initialized, then removed. They never override an initialized server workspace.
- Explicit Dashboard query parameters remain shareable navigation inputs. After validation, they become the canonical workspace values; otherwise URLs mirror the canonical state. Transient UI (open menus/dialogs/tooltips, focus, scroll position, drag/swipe state, toasts, unsaved habit-editor drafts, auth tokens, and error/loading state) is deliberately excluded.
- The frontend has one authenticated workspace-preferences store. Page components consume and mutate that store; they must not each implement local persistence, hydration, conflict handling, or a second URL/state normalizer.

## Recommended implementation order

| Order | Task | Priority | Depends on | Reason |
| ---: | --- | --- | --- | --- |
| 1 | UWS-001 | P1 | - | Define one closed cross-stack vocabulary before persistence is changed. |
| 2 | UWS-002 | P1 | UWS-001 | Add a reversible storage destination and concurrency revision without dropping legacy data. |
| 3 | UWS-003 | P1 | UWS-001, UWS-002 | Expose authenticated, normalized, conflict-safe server ownership. |
| 4 | UWS-004 | P1 | UWS-003 | Replace browser preference hydration with one canonical client synchronizer. |
| 5 | UWS-005 | P1 | UWS-004 | Connect every currently restorable screen control and navigation selection to that synchronizer. |
| 6 | UWS-006 | P1 | UWS-005 | Prove reload, second-device, conflict, ownership, and responsive behavior end to end. |

## UWS-001: Define the typed workspace preference contract

**Status:** DONE
**Priority:** P1
**Depends on:** -

**Exact scope:**

Define the durable workspace state that the current authenticated UI actually exposes: theme usage ranking, Dashboard filter/search/tags/sort/density, Progress period, last primary screen, and an optional selected habit. Establish stable wire values and defaults in both shared TypeScript and backend Java without changing storage or endpoint behavior yet.

**Files:**

- Modify `apps/web/packages/shared/src/auth.ts` and `apps/web/packages/shared/src/index.ts`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardPreferences.java`.
- Create `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UserWorkspacePreferences.java`.
- Create `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardFilter.java`, `DashboardSort.java`, `DashboardDensity.java`, `ProgressPeriod.java`, `WorkspaceScreen.java`, `WorkspaceNavigation.java`, `ProgressWorkspacePreferences.java`, and `ThemeUsage.java`. Do not create nested Java types.
- Create `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/support/ThemeId.java` and modify `ThemeCatalog.java` to use its stable wire values.
- Modify `apps/web/tests/unit/dashboardPreferences.test.ts` and `apps/web/tests/unit/themeStore.test.ts`.

**Goal:**

Both stacks recognize exactly the same valid persisted workspace values, defaults, size limits, and wire names before any user record is migrated.

### Outcome

The contract can represent the existing Dashboard and Progress controls plus restorable navigation without an untyped catch-all payload. Invalid values have deterministic defaults or a documented validation error path.

### Architectural decision

Keep one TypeScript contract in `packages/shared/src/auth.ts` and one set of named backend DTO/enum types at the API boundary. Preserve current theme wire strings and existing Dashboard wire values so deployed clients can transition safely; do not encode route URLs, browser storage keys, or arbitrary component IDs as persisted data.

### Required changes

1. Define `UserWorkspacePreferences` with a schema version, typed Dashboard state, typed Progress state, typed navigation state, and ordered typed theme-usage entries; use immutable collections and defensive copies in Java.
2. Model Dashboard's current `filter`, `searchQuery`, `tags`, `sort`, and `density`; model Progress's current `1w`/`4w`/`12w` segment; model Dashboard, Progress, Account, and owned habit-detail navigation explicitly. Exclude new/edit habit routes because drafts must not sync.
3. Use stable literal unions in the shared package and top-level Java enums/value types for closed selections. Bound free text and collections (including tag count/length and search length) and require a UUID-shaped selected habit ID only for a habit-detail screen.
4. Replace the current string-keyed `themeUsage` map in the new contract with an ordered typed entry collection, while retaining an adapter for the current `rankThemesByUsage` consumer until UWS-004 changes it.
5. Add focused contract/normalization tests for defaults, invalid enum values, duplicate tags/theme usage entries, collection limits, invalid selected-habit combinations, and stable JSON wire values.

### Out of scope

- Database migrations, API behavior, page wiring, and browser-storage removal.
- Persisting overlays, editor drafts, scroll/focus, transient feedback, public/showcase state, or arbitrary routes.
- Adding new user-visible controls or changing Dashboard/Progress layout.

### Acceptance criteria

- The shared TypeScript API exposes one typed workspace model with no `any`, `Record<string, unknown>`, or free-form route field.
- Java production code contains only top-level types for the new persisted workspace domain and no `Map<String, Object>`/`Object[]` representation.
- Every currently selectable Dashboard filter/sort/density, Progress period, navigation screen, and supported theme has a stable valid wire value and a default.
- Tags, search text, theme-usage entries, and selected habit IDs are bounded and invalid values cannot be normalized into a different user's selection.

### Targeted validation

```bash
cd apps/web && npm run test -- tests/unit/dashboardPreferences.test.ts tests/unit/themeStore.test.ts && npm run check:shared
cd apps/backend && ./mvnw test -Dtest=AuthPersistenceCoverageTest,AuthServiceUnitCoverageTest
```

### Commit

```bash
git add apps/web/packages/shared/src/auth.ts apps/web/packages/shared/src/index.ts apps/web/tests/unit/dashboardPreferences.test.ts apps/web/tests/unit/themeStore.test.ts apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardPreferences.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UserWorkspacePreferences.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardFilter.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardSort.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/DashboardDensity.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/ProgressPeriod.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/WorkspaceScreen.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/WorkspaceNavigation.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/ProgressWorkspacePreferences.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/ThemeUsage.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/support/ThemeId.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/support/ThemeCatalog.java
git commit -m "feat(preferences): define typed workspace state"
```

## UWS-002: Add canonical workspace storage and revision migration

**Status:** DONE
**Priority:** P1
**Depends on:** UWS-001

**Exact scope:**

Add a forward-only Flyway migration and `UserEntity` mapping for the canonical workspace document and its optimistic-concurrency revision. Retain the existing `dashboardPreferences` column and values as a transition source.

**Files:**

- Create `apps/backend/src/main/resources/db/migration/V17__add_user_workspace_preferences.sql`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/model/UserEntity.java`.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/integration/FlywayMigrationIT.java`.

**Goal:**

Every user row has durable storage for a typed workspace payload and a revision number, without losing currently saved Dashboard preferences.

### Outcome

Fresh databases initialize a safe empty/default workspace and revision zero; upgraded databases retain `dashboardPreferences` unchanged so UWS-003 can convert it lazily and safely.

### Architectural decision

Use a dedicated `workspacePreferences` text column only as the serialized persistence boundary for `UserWorkspacePreferences`, plus a non-null numeric revision. Do not overload `theme`, `timezone`, `dashboardPreferences`, a browser key, or a generic settings table; do not drop or rewrite legacy data in this migration.

### Required changes

1. Add non-null `workspacePreferences` with an empty/default payload and non-null `workspacePreferencesRevision` with default `0`, using names compatible with the existing quoted-column convention.
2. Map both fields in `UserEntity` with safe defaults appropriate to a newly created user; preserve existing theme/timezone/dashboard mappings exactly.
3. Extend the Flyway integration assertion to prove both new column types/defaults and continued presence of `dashboardPreferences` after an upgrade.
4. Keep the migration portable for the repository's test database and PostgreSQL; use no destructive `DROP`, `RENAME`, or data-deletion statements.

### Out of scope

- Parsing, backfilling, or serving workspace JSON.
- Removing `dashboardPreferences`, changing REST responses, or changing frontend code.
- Any Docker/environment configuration change.

### Acceptance criteria

- Applying Flyway to a new schema creates both workspace columns with non-null defaults.
- Applying Flyway over an existing schema preserves the legacy Dashboard column and its values.
- A newly persisted `UserEntity` has an empty canonical workspace and revision `0` without changing its theme behavior.

### Targeted validation

```bash
cd apps/backend && ./mvnw test -Dtest=FlywayMigrationIT
```

### Commit

```bash
git add apps/backend/src/main/resources/db/migration/V17__add_user_workspace_preferences.sql apps/backend/src/main/java/com/sashplatonov/habbit/runner/model/UserEntity.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/integration/FlywayMigrationIT.java
git commit -m "feat(preferences): add workspace storage revision"
```

## UWS-003: Serve and update canonical workspace preferences safely

**Status:** DONE
**Priority:** P1
**Depends on:** UWS-001, UWS-002

**Exact scope:**

Extend the existing authenticated preferences service and resource to load, normalize, lazily migrate, validate, and conditionally update canonical workspace preferences for the current user.

**Files:**

- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UserPreferencesResponse.java`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UpdatePreferencesRequest.java`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/resource/AuthPreferencesResource.java`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/resource/AuthThemeResource.java`.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java`.
- Create `apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/WorkspacePreferencesCodec.java` and `WorkspacePreferencesNormalizer.java`; delete `DashboardPreferencesNormalizer.java` after all callers use the new typed normalizer.
- Modify `apps/backend/src/main/java/com/sashplatonov/habbit/runner/repository/UserRepository.java` and reuse `HabitRepository.findByIdAndUserId` for selected-habit ownership validation.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java`, `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java`, `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/resource/AuthPreferencesResourceUnitTest.java`, and the test preference-service doubles in the same package.

**Goal:**

Authenticated clients receive one canonical, server-normalized workspace and can update it without writing over a newer state from another device.

### Outcome

`GET /auth/preferences` returns theme, timezone, workspace, and revision. A valid conditional update persists a normalized replacement and increments the revision; a stale update receives a documented `409` result and no write occurs.

### Architectural decision

`PreferencesService` remains the orchestration and transaction boundary, while `UserRepository.findRequiredByIdForUpdate` serializes the conditional write. A named codec owns JSON conversion at the entity boundary; `HabitRepository` only verifies the selected habit's ownership. Keep legacy `dashboard` request/response support as a compatibility projection for one transition release, but derive it from the canonical workspace and never make it a second source of truth.

### Required changes

1. Add `workspace` and `revision` to the response and request contract, keeping the established theme/timezone fields. Accept the legacy Dashboard request shape only as a conversion input when a canonical workspace is absent; document the deprecation in OpenAPI descriptions rather than silently creating two persisted copies.
2. Read canonical workspace first. If it is uninitialized, convert the stored `dashboardPreferences` value into `workspace.dashboard`, use defaults for new sections, persist it atomically, and return the new revision. Malformed historic JSON must fall back safely and be logged without exposing it to the client.
3. Normalize and validate every request through the closed UWS-001 types. Reject malformed/unsupported canonical payloads with `400`; never accept unknown fields through `@JsonIgnoreProperties`, free-form maps, or unbounded collections.
4. Require the submitted revision for canonical clients; under the user-row lock, compare it to the stored revision, increment only on a successful write, and return `409 PREFERENCES_CONFLICT` with a current canonical representation or an unambiguous recovery contract on mismatch. Legacy clients may use the explicitly documented compatibility path only during the transition.
5. Verify `HABIT_DETAIL` selection with `HabitRepository.findByIdAndUserId`; reject a missing or foreign habit without revealing its existence. Clear an obsolete selected habit when reading a now-deleted one, falling back to Dashboard deterministically.
6. Preserve `AuthThemeResource` theme-only behavior and existing theme wire values, but route it through the same canonical response/update logic so it cannot erase workspace state.
7. Add unit/integration coverage for defaults, V12 legacy-server migration, invalid payloads, missing user, auth guard, selected-habit ownership, revision conflicts, successful revision increment, and theme-only backward compatibility.

### Out of scope

- Browser store implementation and route/UI changes.
- Removing the compatibility projection or dropping the legacy column.
- Broadcasting live changes through WebSockets; a refetch on the next initialization or conflict is sufficient for this scope.

### Acceptance criteria

- An authenticated user can `GET` a fully typed normalized workspace and its revision; another user's workspace is never observable or mutable.
- A valid conditional `PUT` returns the persisted canonical payload and a revision greater than the submitted revision.
- Two updates based on the same revision result in exactly one success; the second returns `409` and leaves the first user's persisted state intact.
- Existing rows containing only `dashboardPreferences` retain their filter/tags/sort/density after their first preferences read.
- A selected habit that is missing or belongs to another user cannot be persisted or restored.
- Legacy theme-only requests keep the already stored workspace unchanged during the stated transition.

### Targeted validation

```bash
cd apps/backend && ./mvnw test -Dtest=AuthPersistenceCoverageTest,AuthServiceUnitCoverageTest,AuthDataAccessTest,AuthPreferencesResourceUnitTest
```

### Commit

```bash
git add apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UserPreferencesResponse.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/dto/UpdatePreferencesRequest.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/resource/AuthPreferencesResource.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/resource/AuthThemeResource.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/PreferencesService.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/WorkspacePreferencesCodec.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/WorkspacePreferencesNormalizer.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/auth/service/DashboardPreferencesNormalizer.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/repository/UserRepository.java apps/backend/src/main/java/com/sashplatonov/habbit/runner/repository/HabitRepository.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/AuthPersistenceCoverageTest.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/resource/AuthPreferencesResourceUnitTest.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/ResourcePreferencesService.java apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/TestPreferencesService.java
git commit -m "feat(preferences): synchronize canonical workspace profile"
```

## UWS-004: Replace authenticated browser preference state with one server-synced store

**Status:** DONE
**Priority:** P1
**Depends on:** UWS-003

**Exact scope:**

Refactor the theme/dashboard preference clients and stores into one authenticated workspace-preferences store that hydrates server state once, exposes typed mutations, resolves a conflict, and treats browser storage only as a bounded failed-write outbox and one-time legacy import.

**Files:**

- Modify `apps/web/src/lib/api/theme.ts` or rename it to a preference API module only if every existing import is updated in this task.
- Modify `apps/web/src/lib/stores/theme.ts` and `apps/web/src/lib/stores/dashboardPreferences.ts`.
- Modify `apps/web/src/lib/dashboard/preferences.ts`.
- Modify `apps/web/src/lib/components/ThemePicker.svelte`.
- Modify `apps/web/packages/shared/src/auth.ts` if UWS-003 revealed an API-wire adjustment.
- Modify `apps/web/tests/unit/theme.api.test.ts`, `apps/web/tests/unit/themeStore.test.ts`, and `apps/web/tests/unit/dashboardPreferences.test.ts`.
- Create `apps/web/tests/unit/workspacePreferencesStore.test.ts` if the current test files cannot express conflict/rebase behavior clearly.

**Goal:**

The authenticated browser initializes from the backend profile and every supported workspace change uses the same typed mutation, retry, and confirmation path.

### Outcome

After authentication, the store displays the server-confirmed workspace (without local preference flash), accepts an intentional local change immediately, saves it conditionally, and safely resolves one stale-revision conflict without losing unrelated remote fields.

### Architectural decision

Evolve the existing `themeStore` rather than adding an independent Dashboard or route store. Keep `applyTheme` for immediate rendering, but make the authenticated snapshot's theme/workspace/revision the UI model. A per-user local outbox contains only an unconfirmed typed mutation/revision for retry; it is cleared only by the matching server confirmation and never initializes an already established profile.

### Required changes

1. Update API parsing and saving for `workspace` plus `revision`; validate JSON at the TypeScript boundary with the UWS-001 normalizer before exposing it to components.
2. Replace `DashboardPreferencesStore` legacy read/write behavior with selectors/mutations backed by the canonical workspace store. Remove steady-state writes to `hr_dashboard_*` and `habit-theme` for authenticated users.
3. During the first post-upgrade authenticated initialization only, import valid old browser Dashboard/theme data when the server reports an uninitialized workspace; submit it through the conditional API, then remove the legacy keys. Never let old local data replace a non-default server workspace from another device.
4. Serialize mutations in one queue. On `409`, fetch the current profile, reapply the single intended typed change to that profile, retry once with the returned revision, and surface a retryable error if the second write cannot complete. Do not use last-writer-wins or silently discard a field changed remotely.
5. Preserve anonymous/showcase behavior in memory only and preserve current theme rendering when storage is unavailable. A failed authenticated write may be retained solely as a per-user retry outbox; reloads otherwise start from the server.
6. Cover initial hydration, server confirmation, legacy import/removal, temporary failure/retry, stale revision rebase, second failure UI state, account isolation, and theme-usage ordering.

### Out of scope

- Connecting individual pages/routes to the new mutations.
- Modifying the backend API or database.
- Persisting public/showcase state, auth session tokens, or unsaved editor forms.

### Acceptance criteria

- An authenticated first paint uses a loading/safe state until the canonical workspace is available; it does not render `localStorage` Dashboard state as authoritative.
- Changing theme, a Dashboard preference, or Progress/navigation state through the store sends the full typed workspace and expected revision, then retains the server-confirmed response.
- A stale update rebases the intended local change on current remote state and does not erase a separately changed remote section.
- `localStorage` contains no steady-state authenticated `hr_dashboard_*` or `habit-theme` source of truth after successful migration; any pending outbox is user-scoped and removed after confirmation.
- Store and API tests have no unchecked casts, lint suppression, or acceptance of unknown workspace keys.

### Targeted validation

```bash
cd apps/web && npm run test -- tests/unit/theme.api.test.ts tests/unit/themeStore.test.ts tests/unit/dashboardPreferences.test.ts tests/unit/workspacePreferencesStore.test.ts && npm run check:types
```

### Commit

```bash
git add apps/web/src/lib/api/theme.ts apps/web/src/lib/stores/theme.ts apps/web/src/lib/stores/dashboardPreferences.ts apps/web/src/lib/dashboard/preferences.ts apps/web/src/lib/components/ThemePicker.svelte apps/web/packages/shared/src/auth.ts apps/web/tests/unit/theme.api.test.ts apps/web/tests/unit/themeStore.test.ts apps/web/tests/unit/dashboardPreferences.test.ts apps/web/tests/unit/workspacePreferencesStore.test.ts
git commit -m "feat(web): synchronize workspace preferences store"
```

## UWS-005: Restore navigation and screen selections from the workspace profile

**Status:** TODO
**Priority:** P1
**Depends on:** UWS-004

**Exact scope:**

Wire the existing protected routes and controls to the canonical store: Dashboard controls, Progress period tabs, theme picker, and stable authenticated navigation. Restore the stored primary screen after login and safely route to a selected owned habit detail when present.

**Files:**

- Modify `apps/web/src/routes/+page.svelte`.
- Modify `apps/web/src/routes/app/(protected)/+layout.svelte`.
- Modify `apps/web/src/routes/app/(protected)/dashboard/+page.svelte`.
- Modify `apps/web/src/routes/app/(protected)/stats/+page.svelte`.
- Modify `apps/web/src/lib/dashboard/urlState.ts`.
- Modify `apps/web/src/lib/components/SidebarNav.svelte`, `apps/web/src/lib/components/BottomNav.svelte`, and `apps/web/src/lib/components/MobileMoreSheet.svelte` only where navigation must record canonical selection.
- Modify `apps/web/src/routes/app/(protected)/habit/[id]/+page.svelte` if it is the appropriate existing lifecycle point for selected-habit restoration/clearing.
- Modify `apps/web/tests/unit/dashboardUrlState.test.ts`, `apps/web/tests/unit/dashboardControls.test.ts`, and `apps/web/tests/unit/router.test.ts`.

**Goal:**

Opening the application on another device restores the user's last safe screen and the same visible Dashboard/Progress selections, rather than defaulting to Dashboard plus browser-local state.

### Outcome

Dashboard controls read/write the workspace store, Progress's segmented period is restored, and root authentication navigates once to a validated stored destination with a Dashboard fallback.

### Architectural decision

The protected layout is the single lifecycle owner that records stable authenticated navigation after a confirmed store hydration. The root entry asks that same store for a one-time resolved destination before redirecting, preventing competing `GET /auth/preferences` fetches and redirect loops. Individual pages only select their named state sections; they do not parse/persist browser storage.

### Required changes

1. Remove Dashboard's `lsGet`, `lsSet`, `LS_*` constants, and direct preference effects. Initialize filter/search/tags/sort/density from the hydrated workspace section and submit each intentional control change through the typed store.
2. Retain query-string sharing: validate an explicitly supplied Dashboard query once, write it into the canonical state, and otherwise mirror the canonical values in the URL through the existing URL helper. Bound search and tags exactly as the shared contract requires.
3. Initialize `stats/+page.svelte` from `workspace.progress.period` and persist keyboard/pointer segmented-control changes through the store without changing its existing semantics or responsive geometry.
4. Record Dashboard, Progress, Account, and habit-detail navigation only after route data is valid. Restore a selected habit detail only from a server-authorized workspace selection; if it is absent/deleted, clear it and take the user to Dashboard.
5. Change the authenticated root redirect from its hard-coded Dashboard destination to the resolved canonical destination. Do not restore new/edit routes, dialogs/sheets, URL hashes, unsaved forms, or public/showcase routes.
6. Maintain current desktop sidebar and mobile bottom navigation semantics, visible focus, and 44px targets. The screen restoration must not create a redirect loop, horizontal overflow, duplicate preferences request, or a Dashboard flash before the target is known.

### Out of scope

- New navigation destinations or account-page tabs.
- Persisting ephemeral popovers, filter-panel disclosure, scroll position, drafts, or drag state.
- Backend conflict/storage changes and end-to-end multi-device proof.

### Acceptance criteria

- On an authenticated reload with a stored Dashboard state, filter, search, tags, sort, and density match the server profile without reading `hr_dashboard_*` values.
- A user who chose `4w` in Progress sees `4w` selected after reload and on a second device; buttons remain keyboard-operable and retain visible focus.
- A user whose canonical last screen is Progress, Account, Dashboard, or an owned habit detail reaches that destination from the root entry; invalid/deleted selection falls back to Dashboard exactly once.
- At 320px and at desktop width, restored Dashboard filters, Progress period, and navigation remain in the viewport with no document horizontal overflow and touch controls remain at least 44px where interactive.
- An explicit valid Dashboard share URL becomes the user's canonical Dashboard selection after load; an absent query does not replace server state with browser-local defaults.

### Targeted validation

```bash
cd apps/web && npm run test -- tests/unit/dashboardUrlState.test.ts tests/unit/dashboardControls.test.ts tests/unit/router.test.ts && npm run check:types
```

### Commit

```bash
git add apps/web/src/routes/+page.svelte apps/web/src/routes/app/\(protected\)/+layout.svelte apps/web/src/routes/app/\(protected\)/dashboard/+page.svelte apps/web/src/routes/app/\(protected\)/stats/+page.svelte apps/web/src/routes/app/\(protected\)/habit/\[id\]/+page.svelte apps/web/src/lib/dashboard/urlState.ts apps/web/src/lib/components/SidebarNav.svelte apps/web/src/lib/components/BottomNav.svelte apps/web/src/lib/components/MobileMoreSheet.svelte apps/web/tests/unit/dashboardUrlState.test.ts apps/web/tests/unit/dashboardControls.test.ts apps/web/tests/unit/router.test.ts
git commit -m "feat(workspace): restore synchronized screen state"
```

## UWS-006: Prove cross-device workspace restoration and regressions

**Status:** TODO
**Priority:** P1
**Depends on:** UWS-005

**Exact scope:**

Add integration and browser evidence that one authenticated user's canonical workspace is restored across independent browser contexts, survives reload/login, resolves conflicts without data loss, and remains inaccessible to another user.

**Files:**

- Create `apps/web/tests/e2e/workspace-preferences.spec.ts`.
- Modify `apps/web/tests/e2e/habit-journey.spec.ts` only for shared authenticated fixtures/helpers.
- Modify `apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java` and/or create a focused preferences integration test in the same package if UWS-003 coverage cannot exercise real resource responses.
- Modify `apps/web/tests/unit/themeStore.test.ts` only if a race discovered by the browser flow requires a focused regression test.

**Goal:**

Demonstrate the real user outcome: state selected on one device arrives on another device from the database, with no hidden dependence on that device's browser storage.

### Outcome

Two isolated authenticated contexts for the same account converge on one server-confirmed workspace; a separate account cannot observe it, and narrow/desktop browsers render the restored state safely.

### Architectural decision

Use independent Playwright browser contexts with isolated storage to model separate devices. The test must observe authenticated preference requests/responses and visible control state, not merely inspect a local store or set `localStorage` directly. Backend tests remain responsible for resource ownership and conditional-write status semantics.

### Required changes

1. In context A, select a non-default theme, Dashboard filter/search/tag/sort/density, Progress period, and a restorable screen; verify the successful `PUT /auth/preferences` response contains the canonical workspace and revision.
2. Start context B with no copied browser storage, authenticate as the same user, and prove the stored destination and visible controls restore after the server read. Repeat a reload in B.
3. Exercise two same-revision updates from separate contexts (or API requests): prove the later client resolves the conflict/rebases its intended section and both independent changes survive in the final server workspace.
4. Authenticate a second user and verify defaults/no access to the first user's workspace or selected habit. Cover a deleted selected habit fallback if the existing fixture helpers can perform that deletion safely.
5. Run the restored Dashboard and Progress assertions at 320px and desktop widths, checking no horizontal document overflow, reachable controls, keyboard operation, and focused selection semantics.
6. Run the full relevant frontend/backend gates after the focused tests; distinguish their local result from remote CI, deployment, PWA offline, and physical-device proof.

### Out of scope

- WebSocket live updates, offline PWA synchronization, production deployment, or physical-device validation.
- Changes to product behavior unless a test exposes a concrete defect; any defect gets its own task/commit rather than being folded into this proof task.

### Acceptance criteria

- A clean second browser context restores the same canonical theme, Dashboard settings, Progress tab, and destination selected in the first context.
- The test fails if it depends on copied `localStorage`, a local store snapshot, or a non-authenticated API response.
- A stale conditional update cannot erase a newer remote workspace section; final persisted state contains both intentional non-overlapping changes.
- A different authenticated user cannot restore or submit another user's selected habit/workspace.
- At 320px and desktop width, restored controls have no horizontal overflow, retain keyboard focus behavior, and expose their selected state semantically.

### Targeted validation

```bash
cd apps/web && npm run test:e2e -- tests/e2e/workspace-preferences.spec.ts
cd apps/web && npm run check
cd apps/backend && ./mvnw test
```

### Commit

```bash
git add apps/web/tests/e2e/workspace-preferences.spec.ts apps/web/tests/e2e/habit-journey.spec.ts apps/web/tests/unit/themeStore.test.ts apps/backend/src/test/java/com/sashplatonov/habbit/runner/auth/security/AuthDataAccessTest.java
git commit -m "test(workspace): cover cross-device preference sync"
```
