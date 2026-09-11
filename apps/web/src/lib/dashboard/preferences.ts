import {
  normalizeUserWorkspacePreferences,
  type DashboardPreferences,
  type ProgressWorkspacePreferences,
  type ThemeId,
  type ThemeUsage,
  type UserWorkspacePreferences,
  type WorkspaceDashboardPreferences,
  type WorkspaceNavigation
} from '@habbit-runner/shared';

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  version: 1,
  filter: 'pending',
  tags: [],
  sort: 'custom',
  density: 'comfortable',
  themeUsage: {}
};

const LEGACY_KEYS = {
  filter: 'hr_dashboard_filter_v1',
  density: 'hr_dashboard_density_v1',
  sort: 'hr_dashboard_sort_mode_v1',
  tags: 'hr_dashboard_tags_v1'
} as const;

const PENDING_PREFERENCES_PREFIX = 'hr_dashboard_pending_v1:';
const PENDING_WORKSPACE_PREFIX = 'hr_workspace_pending_v1:';

export type WorkspaceMutation =
  | { kind: 'theme'; value: ThemeId }
  | { kind: 'timezone'; value: string }
  | { kind: 'dashboard'; value: DashboardPreferences }
  | { kind: 'workspace-dashboard'; value: WorkspaceDashboardPreferences }
  | { kind: 'workspace-progress'; value: ProgressWorkspacePreferences }
  | { kind: 'workspace-navigation'; value: WorkspaceNavigation }
  | { kind: 'workspace-theme-usage'; value: ThemeUsage[] }
  | { kind: 'workspace-bootstrap'; value: UserWorkspacePreferences }
  | { kind: 'workspace'; value: UserWorkspacePreferences };

export interface PendingWorkspaceMutation {
  revision: number;
  mutations: WorkspaceMutation[];
}

const MAX_PENDING_MUTATIONS = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJson(key: string): unknown {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  const source = isRecord(value) ? value : {};
  const filter = source.filter;
  const sort = source.sort;
  const density = source.density;
  const tags = Array.isArray(source.tags) ? source.tags : [];
  const usage = isRecord(source.themeUsage) ? source.themeUsage : {};

  return {
    version: 1,
    filter: filter === 'all' || filter === 'done' || filter === 'archived' ? filter : 'pending',
    tags: tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0 && tag.length <= 40)
      .filter((tag, index, allTags) => allTags.indexOf(tag) === index)
      .slice(0, 50),
    sort: sort === 'smart' ? 'smart' : 'custom',
    density: density === 'compact' ? 'compact' : 'comfortable',
    themeUsage: Object.fromEntries(
      Object.entries(usage)
        .filter(([, count]) => Number.isSafeInteger(count) && (count as number) >= 0)
        .map(([theme, count]) => [theme, Math.min(count as number, 1_000_000)])
    )
  };
}

export function toWorkspaceDashboard(value: DashboardPreferences): WorkspaceDashboardPreferences {
  const normalized = normalizeDashboardPreferences(value);
  return {
    filter: normalized.filter,
    searchQuery: '',
    tags: normalized.tags,
    sort: normalized.sort,
    density: normalized.density
  };
}

export function fromWorkspaceDashboard(value: WorkspaceDashboardPreferences, themeUsage: Record<string, number>): DashboardPreferences {
  return {
    version: 1,
    filter: value.filter,
    tags: [...value.tags],
    sort: value.sort,
    density: value.density,
    themeUsage: { ...themeUsage }
  };
}

export function readLegacyDashboardPreferences(): DashboardPreferences {
  return normalizeDashboardPreferences({
    filter: readJson(LEGACY_KEYS.filter),
    density: readJson(LEGACY_KEYS.density),
    sort: readJson(LEGACY_KEYS.sort),
    tags: readJson(LEGACY_KEYS.tags)
  });
}

export function persistLegacyDashboardPreferences(value: DashboardPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(LEGACY_KEYS.filter, JSON.stringify(value.filter));
    window.localStorage.setItem(LEGACY_KEYS.density, JSON.stringify(value.density));
    window.localStorage.setItem(LEGACY_KEYS.sort, JSON.stringify(value.sort));
    window.localStorage.setItem(LEGACY_KEYS.tags, JSON.stringify(value.tags));
  } catch {
    // The account API remains the source of truth when browser storage is unavailable.
  }
}

export function readPendingDashboardPreferences(userId: string | null): DashboardPreferences | null {
  if (!userId || typeof window === 'undefined') {
    return null;
  }
  const value = readJson(`${PENDING_PREFERENCES_PREFIX}${userId}`);
  return value === undefined ? null : normalizeDashboardPreferences(value);
}

export function persistPendingDashboardPreferences(userId: string | null, value: DashboardPreferences): void {
  if (!userId || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      `${PENDING_PREFERENCES_PREFIX}${userId}`,
      JSON.stringify(normalizeDashboardPreferences(value))
    );
  } catch {
    // The active session still retries the write even when browser storage is unavailable.
  }
}

export function clearPendingDashboardPreferences(userId: string | null): void {
  if (!userId || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(`${PENDING_PREFERENCES_PREFIX}${userId}`);
  } catch {
    // A stale outbox entry is harmless because preference updates are idempotent.
  }
}

export function readPendingWorkspaceMutation(userId: string | null): PendingWorkspaceMutation | null {
  if (!userId || typeof window === 'undefined') {
    return null;
  }
  const value = readJson(`${PENDING_WORKSPACE_PREFIX}${userId}`);
  if (!isRecord(value) || typeof value.revision !== 'number') {
    return null;
  }
  const values = Array.isArray(value.mutations)
    ? value.mutations
    : isRecord(value.mutation) ? [value.mutation] : [];
  const mutations = values
    .filter(isRecord)
    .map(parseWorkspaceMutation)
    .filter((mutation): mutation is WorkspaceMutation => mutation !== null)
    .slice(0, MAX_PENDING_MUTATIONS);
  return mutations.length > 0 ? { revision: value.revision, mutations } : null;
}

function parseWorkspaceMutation(value: Record<string, unknown>): WorkspaceMutation | null {
  return typeof value.kind === 'string' ? workspaceMutationParsers[value.kind]?.(value.value) ?? null : null;
}

const workspaceMutationParsers: Record<string, (value: unknown) => WorkspaceMutation | null> = {
  theme: (value) => {
    const theme = typeof value === 'string'
      ? normalizeUserWorkspacePreferences({ themeUsage: [{ theme: value, count: 0 }] }).themeUsage[0]?.theme
      : undefined;
    return theme ? { kind: 'theme', value: theme } : null;
  },
  timezone: (value) => typeof value === 'string' ? { kind: 'timezone', value } : null,
  dashboard: (value) => isRecord(value) ? { kind: 'dashboard', value: normalizeDashboardPreferences(value) } : null,
  'workspace-dashboard': (value) => isRecord(value)
    ? { kind: 'workspace-dashboard', value: normalizeUserWorkspacePreferences({ dashboard: value }).dashboard }
    : null,
  'workspace-progress': (value) => isRecord(value)
    ? { kind: 'workspace-progress', value: normalizeUserWorkspacePreferences({ progress: value }).progress }
    : null,
  'workspace-navigation': (value) => isRecord(value)
    ? { kind: 'workspace-navigation', value: normalizeUserWorkspacePreferences({ navigation: value }).navigation }
    : null,
  'workspace-theme-usage': (value) => Array.isArray(value)
    ? { kind: 'workspace-theme-usage', value: normalizeUserWorkspacePreferences({ themeUsage: value }).themeUsage }
    : null,
  'workspace-bootstrap': (value) => ({ kind: 'workspace-bootstrap', value: normalizeUserWorkspacePreferences(value) }),
  workspace: (value) => ({ kind: 'workspace', value: normalizeUserWorkspacePreferences(value) })
};

export function persistPendingWorkspaceMutation(userId: string | null, value: PendingWorkspaceMutation): void {
  if (!userId || typeof window === 'undefined') {return;}
  try {
    window.localStorage.setItem(`${PENDING_WORKSPACE_PREFIX}${userId}`, JSON.stringify({
      revision: value.revision,
      mutations: value.mutations.slice(-MAX_PENDING_MUTATIONS)
    }));
  } catch {
    // The active session still retains the mutation in memory.
  }
}

export function clearPendingWorkspaceMutation(userId: string | null): void {
  if (!userId || typeof window === 'undefined') {return;}
  try {
    window.localStorage.removeItem(`${PENDING_WORKSPACE_PREFIX}${userId}`);
  } catch {
    // A failed cleanup does not affect the confirmed server state.
  }
}

export function removeLegacyDashboardPreferences(): void {
  if (typeof window === 'undefined') {return;}
  Object.values(LEGACY_KEYS).forEach((key) => window.localStorage.removeItem(key));
  window.localStorage.removeItem('habit-theme');
  window.localStorage.removeItem('habit-theme-usage');
}
