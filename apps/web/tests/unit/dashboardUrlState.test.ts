import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReplaceState } = vi.hoisted(() => ({ mockReplaceState: vi.fn() }));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ replaceState: mockReplaceState }));

import { readDashboardStateFromURL, updateDashboardURL } from '$lib/dashboard/urlState';

describe('dashboard URL state', () => {
  beforeEach(() => {
    mockReplaceState.mockReset();
    window.history.replaceState({}, '', '/showcase?filter=done&tags=focus');
  });

  it('uses shallow history replacement when a dashboard filter changes', () => {
    updateDashboardURL({ filter: 'all' });

    expect(mockReplaceState).toHaveBeenCalledWith('/showcase?filter=all&tags=focus', {});
  });

  it('removes an explicitly reset default filter from the URL', () => {
    updateDashboardURL({ filter: undefined });

    expect(mockReplaceState).toHaveBeenCalledWith('/showcase?tags=focus', {});
  });

  it('accepts only supported values and bounds URL-provided dashboard state', () => {
    const tags = Array.from({ length: 52 }, (_, index) => `tag-${index}`).join(',');
    window.history.replaceState(
      {},
      '',
      `/showcase?filter=unknown&search=${'x'.repeat(201)}&tags=${tags}&sort=bad&density=compact`
    );

    expect(readDashboardStateFromURL()).toEqual({
      tags: Array.from({ length: 50 }, (_, index) => `tag-${index}`).join(','),
      density: 'compact'
    });
  });
});
