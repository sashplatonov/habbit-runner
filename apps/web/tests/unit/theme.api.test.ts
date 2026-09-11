import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveUserPreferences } from '$lib/api/theme';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@habbit-runner/shared';

describe('theme preferences API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the server-confirmed dashboard preferences from a successful update', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      theme: 'cloud',
      timezone: 'Europe/Belgrade',
      dashboard: {
        version: 1,
        filter: 'pending',
        tags: [],
        sort: 'smart',
        density: 'compact',
        themeUsage: {}
      },
      workspace: DEFAULT_WORKSPACE_PREFERENCES,
      revision: 4
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const confirmed = await saveUserPreferences({
      theme: 'cloud',
      timezone: 'Europe/Belgrade',
      dashboard: {
        version: 1,
        filter: 'pending',
        tags: [],
        sort: 'smart',
        density: 'compact',
        themeUsage: {}
      },
      workspace: DEFAULT_WORKSPACE_PREFERENCES,
      revision: 3
    });

    expect(confirmed.dashboard).toMatchObject({ sort: 'smart', density: 'compact' });
  });
});
