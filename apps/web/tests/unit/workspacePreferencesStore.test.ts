import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES, type UserPreferences } from '@habbit-runner/shared';

const { fetchUserPreferences, saveUserPreferences } = vi.hoisted(() => ({
  fetchUserPreferences: vi.fn(),
  saveUserPreferences: vi.fn()
}));

vi.mock('$lib/api/theme', () => ({ fetchUserPreferences, saveUserPreferences }));

import { createThemeStore } from '$lib/stores/theme';

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    theme: 'cloud',
    timezone: 'Europe/Belgrade',
    dashboard: {
      version: 1, filter: 'pending', tags: [], sort: 'custom', density: 'comfortable', themeUsage: {}
    },
    workspace: DEFAULT_WORKSPACE_PREFERENCES,
    revision: 4,
    ...overrides
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
  saveUserPreferences.mockReset();
});

describe('canonical workspace preference store', () => {
  it('imports legacy browser values only for an uninitialized server profile', async () => {
    window.localStorage.setItem('habit-theme', 'matrix');
    window.localStorage.setItem('hr_dashboard_sort_mode_v1', JSON.stringify('smart'));
    const remote = preferences({ revision: 0 });
    fetchUserPreferences.mockResolvedValue(remote);
    saveUserPreferences.mockImplementation(async (request: { theme: UserPreferences['theme']; workspace: UserPreferences['workspace']; revision: number }) => ({
      ...remote,
      theme: request.theme,
      workspace: request.workspace,
      revision: request.revision + 1
    }));

    const store = createThemeStore();
    await store.initialize(true);

    expect(get(store).theme).toBe('matrix');
    expect(get(store).dashboard.sort).toBe('smart');
    expect(saveUserPreferences).toHaveBeenCalledWith(expect.objectContaining({ revision: 0 }));
    expect(window.localStorage.getItem('habit-theme')).toBeNull();
    expect(window.localStorage.getItem('hr_dashboard_sort_mode_v1')).toBeNull();
  });

  it('rebases one dashboard mutation over a newer remote dashboard field', async () => {
    const remote = preferences({
      workspace: {
        ...DEFAULT_WORKSPACE_PREFERENCES,
        dashboard: { ...DEFAULT_WORKSPACE_PREFERENCES.dashboard, searchQuery: 'remote query' }
      }
    });
    fetchUserPreferences.mockResolvedValue(remote);
    const conflict = Object.assign(new Error('conflict'), { name: 'PreferencesConflictError', current: remote });
    saveUserPreferences
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (request: { workspace: UserPreferences['workspace']; revision: number }) => ({
        ...remote,
        workspace: request.workspace,
        revision: request.revision + 1
      }));

    const store = createThemeStore();
    await store.initialize(true);
    await store.setDashboardPreferences({ ...get(store).dashboard, sort: 'smart' });

    expect(saveUserPreferences).toHaveBeenCalledTimes(2);
    expect(saveUserPreferences.mock.calls[1][0].workspace.dashboard).toMatchObject({
      searchQuery: 'remote query',
      sort: 'smart'
    });
    expect(get(store).syncError).toBeNull();
  });
});
