import { get, writable, type Readable } from 'svelte/store';
import type { DashboardPreferences } from '@habbit-runner/shared';
import {
  DEFAULT_DASHBOARD_PREFERENCES,
  normalizeDashboardPreferences,
  readLegacyDashboardPreferences
} from '$lib/dashboard/preferences';

export interface DashboardPreferencesStore extends Readable<DashboardPreferences> {
  hydrate: (value: unknown) => DashboardPreferences;
  useLegacyFallback: () => DashboardPreferences;
  update: (value: DashboardPreferences) => DashboardPreferences;
  reset: () => DashboardPreferences;
}

export function createDashboardPreferencesStore(): DashboardPreferencesStore {
  const store = writable<DashboardPreferences>({ ...DEFAULT_DASHBOARD_PREFERENCES });

  return {
    subscribe: store.subscribe,
    hydrate(value) {
      const normalized = normalizeDashboardPreferences(value);
      store.set(normalized);
      return normalized;
    },
    useLegacyFallback() {
      const fallback = readLegacyDashboardPreferences();
      store.set(fallback);
      return fallback;
    },
    update(value) {
      const normalized = normalizeDashboardPreferences(value);
      store.set(normalized);
      return normalized;
    },
    reset() {
      const defaults = { ...DEFAULT_DASHBOARD_PREFERENCES, themeUsage: {} };
      store.set(defaults);
      return get(store);
    }
  };
}

export const dashboardPreferencesStore = createDashboardPreferencesStore();
