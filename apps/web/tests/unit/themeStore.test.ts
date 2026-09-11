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
});
