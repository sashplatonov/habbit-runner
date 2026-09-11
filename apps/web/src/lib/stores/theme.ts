import { get, writable, type Readable, type Writable } from 'svelte/store';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeUserWorkspacePreferences,
  normalizeUserPreferences,
  type DashboardPreferences,
  type ThemeId as SharedThemeId,
  type UserPreferences,
  type UserWorkspacePreferences,
  type ProgressPeriod,
  type WorkspaceDashboardPreferences,
  type WorkspaceScreen
} from '@habbit-runner/shared';
import * as preferencesApi from '$lib/api/theme';
import type { SaveUserPreferencesRequest } from '$lib/api/theme';
import {
  fromWorkspaceDashboard,
  readLegacyDashboardPreferences,
  readPendingWorkspaceMutation,
  persistPendingWorkspaceMutation,
  clearPendingWorkspaceMutation,
  removeLegacyDashboardPreferences,
  toWorkspaceDashboard,
  type PendingWorkspaceMutation,
  type WorkspaceMutation
} from '$lib/dashboard/preferences';
import { logClientError } from '$lib/logging/clientLogger';
import { readAuthSession } from '$lib/auth/session';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme, type ThemeId } from '$lib/theme/themes';
import { getBrowserTimeZone, getCurrentUserTimeZone, setCurrentUserTimeZone } from '$lib/time/userTimezone';

export interface ThemeStoreSnapshot {
  theme: ThemeId;
  currentTheme: Theme;
  timezone: string;
  workspace: UserWorkspacePreferences;
  revision: number;
  serverSyncReady: boolean;
  isAuthenticated: boolean;
  dashboard: DashboardPreferences;
  syncError: string | null;
}

export interface ThemeStore extends Readable<ThemeStoreSnapshot> {
  initialize: (isAuthenticated?: boolean) => Promise<void>;
  setTheme: (theme: ThemeId) => Promise<void>;
  setTimezone: (timezone: string) => Promise<void>;
  setDashboardPreferences: (preferences: DashboardPreferences) => Promise<void>;
  setDashboardWorkspace: (dashboard: WorkspaceDashboardPreferences) => Promise<void>;
  setProgressPeriod: (period: ProgressPeriod) => Promise<void>;
  setNavigation: (screen: WorkspaceScreen, selectedHabitId?: string | null) => Promise<void>;
  recordThemeSelection: (themeId: ThemeId) => Promise<void>;
  setAuthenticated: (isAuthenticated: boolean) => Promise<void>;
}

function currentUserId(): string | null {
  return readAuthSession()?.userId ?? null;
}

function isLocalTheme(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

function themeId(value: SharedThemeId): ThemeId {
  return isLocalTheme(value) ? value : DEFAULT_THEME_ID;
}

function usageRecord(workspace: UserWorkspacePreferences): Record<string, number> {
  return Object.fromEntries(workspace.themeUsage.map((entry) => [entry.theme, entry.count]));
}

function workspaceWithUsage(workspace: UserWorkspacePreferences, usage: Record<string, number>): UserWorkspacePreferences {
  return normalizeUserWorkspacePreferences({ ...workspace, themeUsage: Object.entries(usage).map(([theme, count]) => ({ theme, count })) });
}

function dashboardFor(workspace: UserWorkspacePreferences): DashboardPreferences {
  return fromWorkspaceDashboard(workspace.dashboard, usageRecord(workspace));
}

interface SnapshotInput {
  theme: ThemeId;
  timezone: string;
  workspace: UserWorkspacePreferences;
  revision: number;
  serverSyncReady: boolean;
  isAuthenticated: boolean;
  syncError?: string | null;
}

function snapshot(input: SnapshotInput): ThemeStoreSnapshot {
  return {
    ...input,
    currentTheme: getTheme(input.theme),
    dashboard: dashboardFor(input.workspace),
    syncError: input.syncError ?? null
  };
}

export function applyTheme(theme: ThemeId, _persist = false): void {
  if (typeof document === 'undefined') {return;}
  const metadata = getTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', metadata.themeColor);
}

function applyMutation(base: UserWorkspacePreferences, mutation: WorkspaceMutation): UserWorkspacePreferences {
  switch (mutation.kind) {
    case 'theme':
    case 'timezone':
      return base;
    case 'workspace':
    case 'workspace-bootstrap':
      return normalizeUserWorkspacePreferences(mutation.value);
    case 'dashboard': {
      const dashboard = toWorkspaceDashboard(mutation.value);
      return normalizeUserWorkspacePreferences({
        ...base,
        dashboard: { ...base.dashboard, ...dashboard, searchQuery: base.dashboard.searchQuery }
      });
    }
    case 'workspace-dashboard':
      return normalizeUserWorkspacePreferences({ ...base, dashboard: mutation.value });
    case 'workspace-progress':
      return normalizeUserWorkspacePreferences({ ...base, progress: mutation.value });
    case 'workspace-navigation':
      return normalizeUserWorkspacePreferences({ ...base, navigation: mutation.value });
    case 'workspace-theme-usage':
      return normalizeUserWorkspacePreferences({ ...base, themeUsage: mutation.value });
  }
}

function legacyTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem('habit-theme');
    return value && isLocalTheme(value) ? value : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function importedWorkspace(remote: UserPreferences): { theme: ThemeId; workspace: UserWorkspacePreferences } {
  const legacyDashboard = readLegacyDashboardPreferences();
  const importedUsage = Object.entries(legacyDashboard.themeUsage)
    .filter(([theme, count]) => THEMES.some((candidate) => candidate.id === theme) && Number.isSafeInteger(count) && count >= 0)
    .map(([theme, count]) => ({ theme, count }));
  const workspace = normalizeUserWorkspacePreferences({
    ...remote.workspace,
    dashboard: toWorkspaceDashboard(legacyDashboard),
    themeUsage: importedUsage.length > 0 ? importedUsage : remote.workspace.themeUsage
  });
  return { theme: legacyTheme(), workspace };
}

export function createThemeStore(): ThemeStore {
  const store = writable(snapshot({ theme: DEFAULT_THEME_ID, timezone: getBrowserTimeZone(), workspace: DEFAULT_WORKSPACE_PREFERENCES, revision: 0, serverSyncReady: false, isAuthenticated: false }));
  let initialized = false;
  const sync = createPreferenceSynchronizer(store);
  async function mutate(mutation: WorkspaceMutation, nextTheme?: ThemeId): Promise<void> {
    const current = get(store);
    const theme = nextTheme ?? current.theme;
    const workspace = applyMutation(current.workspace, mutation);
    applyTheme(theme);
    store.set(snapshot({ theme, timezone: current.timezone, workspace, revision: current.revision,
      serverSyncReady: current.serverSyncReady, isAuthenticated: current.isAuthenticated }));
    if (current.isAuthenticated) {
      sync.remember(mutation, current.revision);
      if (current.serverSyncReady) {await sync.enqueue(mutation, current.revision);}
    }
  }

  return {
    subscribe: store.subscribe,
    async initialize(isAuthenticated = false) {
      initialized = true;
      const timezone = isAuthenticated ? getCurrentUserTimeZone() : getBrowserTimeZone();
      store.set(snapshot({ theme: DEFAULT_THEME_ID, timezone, workspace: DEFAULT_WORKSPACE_PREFERENCES,
        revision: 0, serverSyncReady: !isAuthenticated, isAuthenticated }));
      applyTheme(DEFAULT_THEME_ID);
      if (isAuthenticated) {await sync.hydrate();}
    },
    async setTheme(theme) {
      await mutate({ kind: 'theme', value: theme }, theme);
    },
    async setTimezone(timezone) {
      const current = get(store);
      const next = setCurrentUserTimeZone(timezone);
      store.set(snapshot({ theme: current.theme, timezone: next, workspace: current.workspace,
        revision: current.revision, serverSyncReady: current.serverSyncReady, isAuthenticated: current.isAuthenticated }));
      if (current.isAuthenticated && current.serverSyncReady) {
        sync.setTimezone(next);
        await sync.enqueue({ kind: 'timezone', value: next }, current.revision);
      }
    },
    async setDashboardPreferences(preferences) {
      await mutate({ kind: 'dashboard', value: preferences });
    },
    async setDashboardWorkspace(dashboard) {
      await mutate({ kind: 'workspace-dashboard', value: dashboard });
    },
    async setProgressPeriod(period) {
      await mutate({ kind: 'workspace-progress', value: { period } });
    },
    async setNavigation(screen, selectedHabitId = null) {
      await mutate({ kind: 'workspace-navigation', value: {
        screen, selectedHabitId: screen === 'habit-detail' ? selectedHabitId : null
      } });
    },
    async recordThemeSelection(theme) {
      const current = get(store);
      const usage = usageRecord(current.workspace);
      usage[theme] = (usage[theme] ?? 0) + 1;
      await mutate({ kind: 'workspace-theme-usage', value: workspaceWithUsage(current.workspace, usage).themeUsage });
    },
    async setAuthenticated(isAuthenticated) {
      if (!initialized) {return this.initialize(isAuthenticated);}
      if (!isAuthenticated) {
        store.set(snapshot({ theme: DEFAULT_THEME_ID, timezone: getBrowserTimeZone(),
          workspace: DEFAULT_WORKSPACE_PREFERENCES, revision: 0, serverSyncReady: false, isAuthenticated: false }));
        applyTheme(DEFAULT_THEME_ID);
        return;
      }
      if (get(store).isAuthenticated && get(store).serverSyncReady) {
        return;
      }
      store.update((current) => ({ ...current, isAuthenticated: true, serverSyncReady: false, syncError: null }));
      await sync.hydrate();
    }
  };
}

function createPreferenceSynchronizer(store: Writable<ThemeStoreSnapshot>) {
  let hydrating = false;
  let confirmed: UserPreferences | null = null;
  let queue = Promise.resolve();
  let pending: PendingWorkspaceMutation | null = null;

  function setConfirmed(value: UserPreferences): void {
    const normalized = normalizeUserPreferences(value);
    confirmed = normalized;
    const current = get(store);
    const nextTheme = themeId(normalized.theme);
    setCurrentUserTimeZone(normalized.timezone ?? current.timezone);
    applyTheme(nextTheme);
    store.set(snapshot({ theme: nextTheme, timezone: normalized.timezone ?? current.timezone,
      workspace: normalized.workspace, revision: normalized.revision, serverSyncReady: true, isAuthenticated: true }));
  }

  function requestFor(value: UserPreferences, mutation: WorkspaceMutation, revision: number): SaveUserPreferencesRequest {
    return { theme: mutation.kind === 'theme' ? mutation.value : value.theme,
      timezone: mutation.kind === 'timezone' ? mutation.value : value.timezone ?? '',
      workspace: applyMutation(value.workspace, mutation), revision };
  }

  async function writeMutation(mutation: WorkspaceMutation, originalRevision: number): Promise<void> {
    if (!confirmed) { return; }
    try {
      setConfirmed(await preferencesApi.saveUserPreferences(requestFor(confirmed, mutation, originalRevision)));
      pending = null;
      clearPendingWorkspaceMutation(currentUserId());
    } catch (error) {
      if (isPreferencesConflict(error)) {
        if (!canRebase(mutation)) {
          setConfirmed(error.current);
          pending = null;
          clearPendingWorkspaceMutation(currentUserId());
          store.update((current) => ({ ...current, syncError: 'Preferences changed on another device' }));
          return;
        }
        try {
          setConfirmed(await preferencesApi.saveUserPreferences(requestFor(error.current, mutation, error.current.revision)));
          pending = null;
          clearPendingWorkspaceMutation(currentUserId());
          return;
        } catch (retryError) {
          pending = { revision: error.current.revision, mutation };
          persistPendingWorkspaceMutation(currentUserId(), pending);
          store.update((current) => ({ ...current, syncError: retryError instanceof Error ? retryError.message : 'Preference retry failed' }));
          return;
        }
      }
      pending = { revision: originalRevision, mutation };
      persistPendingWorkspaceMutation(currentUserId(), pending);
      logClientError('theme.persist_failed', 'Failed to synchronize user preferences', {
        error: error instanceof Error ? error.message : String(error)
      });
      store.update((current) => ({ ...current, syncError: error instanceof Error ? error.message : 'Preference save failed' }));
    }
  }

  function enqueue(mutation: WorkspaceMutation, revision: number): Promise<void> {
    queue = queue.catch(() => undefined).then(() => writeMutation(mutation, revision));
    return queue;
  }

  async function hydrate(): Promise<void> {
    if (hydrating) { return; }
    hydrating = true;
    store.update((current) => ({ ...current, serverSyncReady: false, syncError: null }));
    try {
      const remote = await preferencesApi.fetchUserPreferences();
      if (remote.revision === 0) {
        const imported = importedWorkspace(remote);
        setConfirmed({ ...remote, theme: imported.theme, workspace: imported.workspace });
        await enqueue({ kind: 'workspace-bootstrap', value: imported.workspace }, remote.revision);
        if (!pending) { removeLegacyDashboardPreferences(); }
      } else {
        setConfirmed(remote);
      }
      pending ??= readPendingWorkspaceMutation(currentUserId());
      if (pending) { await enqueue(pending.mutation, remote.revision); }
    } catch (error) {
      logClientError('theme.hydrate_failed', 'Failed to synchronize user preferences', {
        error: error instanceof Error ? error.message : String(error)
      });
      store.update((current) => ({ ...current, serverSyncReady: true, syncError: 'Preferences could not be loaded' }));
    } finally {
      hydrating = false;
    }
  }

  function remember(mutation: WorkspaceMutation, revision: number): void {
    pending = { revision, mutation };
    persistPendingWorkspaceMutation(currentUserId(), pending);
  }

  function setTimezone(timezone: string): void {
    if (confirmed) {
      confirmed = { ...confirmed, timezone };
    }
  }

  return { enqueue, hydrate, remember, setTimezone };
}

export const themeStore = createThemeStore();

function isPreferencesConflict(error: unknown): error is { current: UserPreferences } {
  return error instanceof Error && error.name === 'PreferencesConflictError' && 'current' in error;
}

function canRebase(mutation: WorkspaceMutation): boolean {
  return mutation.kind !== 'workspace' && mutation.kind !== 'workspace-bootstrap';
}
