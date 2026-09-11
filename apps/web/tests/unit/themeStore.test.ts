import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES, type DashboardPreferences, type UserPreferences } from '@habbit-runner/shared';
import type { SaveUserPreferencesRequest } from '$lib/api/theme';

const { fetchUserPreferences, saveUserPreferences } = vi.hoisted(() => ({
  fetchUserPreferences: vi.fn<() => Promise<UserPreferences>>(),
  saveUserPreferences: vi.fn<(preferences: SaveUserPreferencesRequest) => Promise<UserPreferences>>()
}));

vi.mock('$lib/api/theme', () => ({ fetchUserPreferences, saveUserPreferences }));

import { createThemeStore } from '$lib/stores/theme';

const defaultPreferences: DashboardPreferences = {
  version: 1,
  filter: 'pending',
  tags: [],
  sort: 'custom',
  density: 'comfortable',
  themeUsage: {}
};

function serverPreferences(dashboard = defaultPreferences, revision = 1): UserPreferences {
  return {
    theme: 'cloud',
    timezone: 'Europe/Belgrade',
    dashboard,
    workspace: {
      ...DEFAULT_WORKSPACE_PREFERENCES,
      dashboard: { ...DEFAULT_WORKSPACE_PREFERENCES.dashboard, ...dashboard }
    },
    revision
  };
}

function confirmedFromRequest(preferences: SaveUserPreferencesRequest): UserPreferences {
  const dashboard: DashboardPreferences = {
    version: 1,
    filter: preferences.workspace.dashboard.filter,
    tags: [...preferences.workspace.dashboard.tags],
    sort: preferences.workspace.dashboard.sort,
    density: preferences.workspace.dashboard.density,
    themeUsage: Object.fromEntries(preferences.workspace.themeUsage.map((entry) => [entry.theme, entry.count]))
  };
  return serverPreferences(dashboard, (preferences.revision ?? 0) + 1);
}

function preferencesFromWorkspace(workspace: UserPreferences['workspace'], revision: number): UserPreferences {
  return {
    ...serverPreferences({
      ...defaultPreferences,
      filter: workspace.dashboard.filter,
      tags: workspace.dashboard.tags,
      sort: workspace.dashboard.sort,
      density: workspace.dashboard.density,
      themeUsage: Object.fromEntries(workspace.themeUsage.map((entry) => [entry.theme, entry.count]))
    }, revision),
    workspace
  };
}

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
  fetchUserPreferences.mockReset();
  saveUserPreferences.mockReset().mockImplementation(async (preferences) => confirmedFromRequest(preferences));
});

describe('themeStore dashboard preference persistence', () => {
  it('keeps a view change made during hydration and saves it after login sync is ready', async () => {
    let resolvePreferences: ((value: UserPreferences) => void) | undefined;
    fetchUserPreferences.mockReturnValue(new Promise((resolve) => { resolvePreferences = resolve; }));
    const store = createThemeStore();

    const initialization = store.initialize(true);
    await vi.waitFor(() => expect(fetchUserPreferences).toHaveBeenCalledTimes(1));

    await store.setDashboardPreferences({ ...defaultPreferences, sort: 'smart', density: 'compact' });
    resolvePreferences?.(serverPreferences());
    await initialization;

    expect(get(store).dashboard).toMatchObject({ sort: 'smart', density: 'compact' });
    expect(saveUserPreferences).toHaveBeenCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ sort: 'smart', density: 'compact' })
      })
    }));
  });

  it('restores server-confirmed list settings after a fresh login with no browser state', async () => {
    let serverDashboard = defaultPreferences;
    window.localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: 'user-1' }));
    fetchUserPreferences.mockImplementation(async () => serverPreferences(serverDashboard));
    saveUserPreferences.mockImplementation(async (preferences) => {
      serverDashboard = {
        ...serverDashboard,
        sort: preferences.workspace.dashboard.sort,
        density: preferences.workspace.dashboard.density
      };
      return confirmedFromRequest(preferences);
    });

    const firstLogin = createThemeStore();
    await firstLogin.initialize(true);
    await firstLogin.setDashboardPreferences({ ...defaultPreferences, sort: 'smart', density: 'compact' });

    window.localStorage.clear();
    window.localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: 'user-1' }));
    const secondLogin = createThemeStore();
    await secondLogin.initialize(true);

    expect(get(secondLogin).dashboard).toMatchObject({ sort: 'smart', density: 'compact' });
  });

  it('replays an unconfirmed setting change after logging in again', async () => {
    window.localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: 'user-1' }));
    fetchUserPreferences.mockResolvedValue(serverPreferences());
    saveUserPreferences.mockRejectedValueOnce(new Error('Temporary API failure'));

    const firstLogin = createThemeStore();
    await firstLogin.initialize(true);
    await firstLogin.setDashboardPreferences({ ...defaultPreferences, sort: 'smart', density: 'compact' });
    await firstLogin.setAuthenticated(false);

    saveUserPreferences.mockImplementation(async (preferences) => confirmedFromRequest(preferences));
    const secondLogin = createThemeStore();
    await secondLogin.initialize(true);

    expect(saveUserPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ sort: 'smart', density: 'compact' })
      })
    }));
    expect(get(secondLogin).dashboard).toMatchObject({ sort: 'smart', density: 'compact' });
  });

  it('retains a failed dashboard mutation when a later progress mutation succeeds', async () => {
    fetchUserPreferences.mockResolvedValue(serverPreferences());
    saveUserPreferences
      .mockRejectedValueOnce(new Error('Temporary API failure'))
      .mockImplementation(async (request) => ({
        ...preferencesFromWorkspace(request.workspace, (request.revision ?? 0) + 1),
        theme: request.theme,
        timezone: request.timezone
      }));
    const store = createThemeStore();

    await store.initialize(true);
    await store.setDashboardPreferences({ ...defaultPreferences, sort: 'smart' });
    await store.setProgressPeriod('12w');

    expect(saveUserPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ sort: 'smart' }),
        progress: { period: '12w' }
      })
    }));
    expect(get(store).workspace).toMatchObject({
      dashboard: { sort: 'smart' }, progress: { period: '12w' }
    });
  });

  it('rebases every pending mutation after a conflict and retains remote sections', async () => {
    const initial = serverPreferences();
    const remoteWorkspace = {
      ...initial.workspace,
      dashboard: { ...initial.workspace.dashboard, searchQuery: 'remote query' }
    };
    const remote = preferencesFromWorkspace(remoteWorkspace, 2);
    fetchUserPreferences.mockResolvedValue(initial);
    saveUserPreferences
      .mockRejectedValueOnce(new Error('Temporary API failure'))
      .mockRejectedValueOnce(Object.assign(new Error('Preferences conflict'), {
        name: 'PreferencesConflictError', current: remote
      }))
      .mockImplementation(async (request) => preferencesFromWorkspace(request.workspace, (request.revision ?? 0) + 1));
    const store = createThemeStore();

    await store.initialize(true);
    await store.setDashboardPreferences({ ...defaultPreferences, sort: 'smart' });
    await store.setProgressPeriod('12w');

    expect(saveUserPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      revision: 2,
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ searchQuery: 'remote query', sort: 'smart' }),
        progress: { period: '12w' }
      })
    }));
    expect(get(store).workspace).toMatchObject({
      dashboard: { searchQuery: 'remote query', sort: 'smart' }, progress: { period: '12w' }
    });
  });

  it('replays all pending mutations for the authenticated user after reload', async () => {
    window.localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: 'user-1' }));
    fetchUserPreferences.mockResolvedValue(serverPreferences());
    saveUserPreferences
      .mockRejectedValueOnce(new Error('Dashboard unavailable'))
      .mockRejectedValueOnce(new Error('Progress unavailable'))
      .mockImplementation(async (request) => preferencesFromWorkspace(request.workspace, (request.revision ?? 0) + 1));
    const firstLogin = createThemeStore();

    await firstLogin.initialize(true);
    await firstLogin.setDashboardPreferences({ ...defaultPreferences, sort: 'smart' });
    await firstLogin.setProgressPeriod('12w');
    await firstLogin.setAuthenticated(false);

    const secondLogin = createThemeStore();
    await secondLogin.initialize(true);

    expect(saveUserPreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ sort: 'smart' }),
        progress: { period: '12w' }
      })
    }));
  });

  it('rebases a progress change over an independent remote dashboard change after a conflict', async () => {
    const initial = serverPreferences();
    const remoteWorkspace = {
      ...initial.workspace,
      dashboard: { ...initial.workspace.dashboard, searchQuery: 'device-a' }
    };
    const remote = preferencesFromWorkspace(remoteWorkspace, 2);
    fetchUserPreferences.mockResolvedValue(initial);
    saveUserPreferences.mockRejectedValueOnce(Object.assign(new Error('Preferences conflict'), {
      name: 'PreferencesConflictError', current: remote
    })).mockImplementationOnce(async (request) => preferencesFromWorkspace(request.workspace, 3));
    const store = createThemeStore();

    await store.initialize(true);
    await store.setProgressPeriod('12w');

    expect(saveUserPreferences).toHaveBeenNthCalledWith(2, expect.objectContaining({
      revision: 2,
      workspace: expect.objectContaining({
        dashboard: expect.objectContaining({ searchQuery: 'device-a' }),
        progress: { period: '12w' }
      })
    }));
    expect(get(store).workspace).toMatchObject({
      dashboard: { searchQuery: 'device-a' }, progress: { period: '12w' }
    });
  });
});
