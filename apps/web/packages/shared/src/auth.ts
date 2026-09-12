export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface UserPreferences {
  theme: ThemeId;
  timezone: string | null;
  dashboard: DashboardPreferences;
  workspace: UserWorkspacePreferences;
  revision: number;
}

export interface DashboardPreferences {
  version: number;
  filter: 'pending' | 'all' | 'done' | 'archived';
  tags: string[];
  sort: 'custom' | 'smart';
  density: 'comfortable' | 'compact';
  themeUsage: Record<string, number>;
}

export type ThemeId =
  | 'cloud'
  | 'peach'
  | 'mint'
  | 'lavender'
  | 'paper'
  | 'midnight'
  | 'graphite'
  | 'ember'
  | 'violet'
  | 'matrix'
  | 'arctic'
  | 'aurora'
  | 'dune'
  | 'lagoon'
  | 'sakura';

export type DashboardFilter = 'pending' | 'all' | 'done' | 'archived';
export type DashboardSort = 'custom' | 'smart';
export type DashboardDensity = 'comfortable' | 'compact';
export type ProgressPeriod = '1w' | '4w' | '12w';
export type WorkspaceScreen = 'dashboard' | 'progress' | 'account' | 'habit-detail';

export interface WorkspaceDashboardPreferences {
  filter: DashboardFilter;
  searchQuery: string;
  tags: string[];
  sort: DashboardSort;
  density: DashboardDensity;
}

export interface ProgressWorkspacePreferences {
  period: ProgressPeriod;
}

export interface WorkspaceNavigation {
  screen: WorkspaceScreen;
  selectedHabitId: string | null;
}

export interface ThemeUsage {
  theme: ThemeId;
  count: number;
}

export interface UserWorkspacePreferences {
  version: 1;
  dashboard: WorkspaceDashboardPreferences;
  progress: ProgressWorkspacePreferences;
  navigation: WorkspaceNavigation;
  themeUsage: ThemeUsage[];
}

export const DEFAULT_WORKSPACE_PREFERENCES: UserWorkspacePreferences = {
  version: 1,
  dashboard: {
    filter: 'pending',
    searchQuery: '',
    tags: [],
    sort: 'custom',
    density: 'comfortable'
  },
  progress: { period: '1w' },
  navigation: { screen: 'dashboard', selectedHabitId: null },
  themeUsage: []
};

const THEME_IDS: ReadonlySet<ThemeId> = new Set([
  'cloud', 'peach', 'mint', 'lavender', 'paper', 'midnight', 'graphite', 'ember',
  'violet', 'matrix', 'arctic', 'aurora', 'dune', 'lagoon', 'sakura'
]);

function isObject(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0 && tag.length <= 40)
      .filter((tag, index, tags) => tags.indexOf(tag) === index)
      .slice(0, 50)
    : [];
}

function normalizeThemeUsage(value: unknown): ThemeUsage[] {
  const entries = Array.isArray(value) ? value : [];
  const themeUsage: ThemeUsage[] = [];
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.theme !== 'string' || !THEME_IDS.has(entry.theme as ThemeId)) {
      continue;
    }
    if (!Number.isSafeInteger(entry.count) || (entry.count as number) < 0) {
      continue;
    }
    if (themeUsage.some((item) => item.theme === entry.theme)) {
      continue;
    }
    themeUsage.push({ theme: entry.theme as ThemeId, count: Math.min(entry.count as number, 1_000_000) });
    if (themeUsage.length === 15) {
      break;
    }
  }
  return themeUsage;
}

function normalizeWorkspaceScreen(value: unknown): WorkspaceScreen {
  return value === 'progress' || value === 'account' || value === 'habit-detail' ? value : 'dashboard';
}

function normalizeWorkspaceNavigation(value: { [key: string]: unknown }): WorkspaceNavigation {
  const screen = normalizeWorkspaceScreen(value.screen);
  const selectedHabitId = screen === 'habit-detail' && typeof value.selectedHabitId === 'string'
    && value.selectedHabitId.trim().length > 0 ? value.selectedHabitId : null;
  return { screen: screen === 'habit-detail' && selectedHabitId === null ? 'dashboard' : screen, selectedHabitId };
}

function normalizeWorkspaceDashboard(value: { [key: string]: unknown }): WorkspaceDashboardPreferences {
  const filter = value.filter === 'all' || value.filter === 'done' || value.filter === 'archived' ? value.filter : 'pending';
  const sort = value.sort === 'smart' ? 'smart' : 'custom';
  const density = value.density === 'compact' ? 'compact' : 'comfortable';
  return {
    filter,
    searchQuery: typeof value.searchQuery === 'string' ? value.searchQuery.trim().slice(0, 200) : '',
    tags: normalizeTags(value.tags),
    sort,
    density
  };
}

export function normalizeUserWorkspacePreferences(value: unknown): UserWorkspacePreferences {
  const source = isObject(value) ? value : {};
  const dashboard = isObject(source.dashboard) ? source.dashboard : {};
  const progress = isObject(source.progress) ? source.progress : {};
  const navigation = isObject(source.navigation) ? source.navigation : {};
  const usage = Array.isArray(source.themeUsage) ? source.themeUsage : [];
  const themeUsage = normalizeThemeUsage(usage);

  return {
    version: 1,
    dashboard: normalizeWorkspaceDashboard(dashboard),
    progress: { period: progress.period === '4w' || progress.period === '12w' ? progress.period : '1w' },
    navigation: normalizeWorkspaceNavigation(navigation),
    themeUsage
  };
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = isObject(value) ? value : {};
  const theme = normalizeThemeId(source.theme);
  const workspace = normalizeUserWorkspacePreferences(source.workspace);
  const dashboard = normalizeLegacyDashboard(
    isObject(source.dashboard) ? source.dashboard : workspace.dashboard,
    workspace
  );
  return {
    theme,
    timezone: typeof source.timezone === 'string' ? source.timezone : null,
    dashboard,
    workspace,
    revision: normalizeRevision(source.revision)
  };
}

function normalizeThemeId(value: unknown): ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value as ThemeId) ? value as ThemeId : 'cloud';
}

function normalizeRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeLegacyDashboard(
  value: unknown,
  workspace: UserWorkspacePreferences
): DashboardPreferences {
  const source = isObject(value) ? value : {};
  return {
    version: 1,
    filter: source.filter === 'all' || source.filter === 'done' || source.filter === 'archived' ? source.filter : 'pending',
    tags: normalizeTags(source.tags),
    sort: source.sort === 'smart' ? 'smart' : 'custom',
    density: source.density === 'compact' ? 'compact' : 'comfortable',
    themeUsage: Object.fromEntries(workspace.themeUsage.map((entry) => [entry.theme, entry.count]))
  };
}
