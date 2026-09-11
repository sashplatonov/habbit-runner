import { API_BASE_URL } from '@/lib/core/config';
import { authenticatedFetch } from '@/lib/auth/session';
import type {
  DashboardPreferences,
  ThemeId,
  UserPreferences,
  UserWorkspacePreferences
} from '@habbit-runner/shared';
import { normalizeUserPreferences } from '@habbit-runner/shared';

export interface SaveUserPreferencesRequest {
  theme: ThemeId;
  timezone: string;
  workspace: UserWorkspacePreferences;
  revision?: number;
  dashboard?: DashboardPreferences;
}

export class PreferencesConflictError extends Error {
  readonly current: UserPreferences;

  constructor(current: UserPreferences) {
    super('Preferences changed on another device');
    this.name = 'PreferencesConflictError';
    this.current = current;
  }
}

async function readPreferences(response: Response): Promise<UserPreferences> {
  return normalizeUserPreferences(await response.json() as unknown);
}

export async function fetchUserPreferences(): Promise<UserPreferences> {
  const response = await authenticatedFetch(`${API_BASE_URL}/auth/preferences`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Preferences fetch failed: ${response.status}`);
  }
  return readPreferences(response);
}

export async function saveUserPreferences(request: SaveUserPreferencesRequest): Promise<UserPreferences> {
  const response = await authenticatedFetch(`${API_BASE_URL}/auth/preferences`, {
    method: 'PUT',
    body: JSON.stringify(request)
  });
  if (response.status === 409) {
    throw new PreferencesConflictError(await readPreferences(response));
  }
  if (!response.ok) {
    throw new Error(`Preferences save failed: ${response.status}`);
  }
  return readPreferences(response);
}

export async function fetchUserTheme(): Promise<ThemeId | null> {
  const preferences = await fetchUserPreferences();
  return preferences.theme;
}

export async function saveUserTheme(theme: ThemeId): Promise<void> {
  const current = await fetchUserPreferences();
  await saveUserPreferences({
    theme,
    timezone: current.timezone ?? '',
    workspace: current.workspace,
    revision: current.revision
  });
}
