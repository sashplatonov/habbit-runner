import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

type ThemeId = 'cloud' | 'matrix';
type Workspace = {
  version: 1;
  dashboard: {
    filter: 'pending' | 'all' | 'done' | 'archived';
    searchQuery: string;
    tags: string[];
    sort: 'custom' | 'smart';
    density: 'comfortable' | 'compact';
  };
  progress: { period: '1w' | '4w' | '12w' };
  navigation: { screen: 'dashboard' | 'progress' | 'account' | 'habit-detail'; selectedHabitId: string | null };
  themeUsage: Array<{ theme: ThemeId; count: number }>;
};

type UserState = {
  userId: string;
  email: string;
  theme: ThemeId;
  revision: number;
  workspace: Workspace;
};

const habitId = '123e4567-e89b-12d3-a456-426614174000';
const habit = {
  id: habitId,
  name: 'Read for ten minutes',
  description: 'Workspace restoration habit',
  color: 'blue',
  icon: '📚',
  frequency: 'DAILY',
  customDays: [],
  schedule: null,
  targetStreak: 7,
  dailyTarget: 1,
  tags: ['focus'],
  archived: false,
  createdAt: '2026-08-08T10:00:00Z',
  updatedAt: '2026-08-08T10:00:00Z',
  version: 1,
  sortOrder: 1,
  reminderTime: null,
  reminderEnabled: true,
  type: 'positive',
  freezeDays: []
};

function defaultWorkspace(): Workspace {
  return {
    version: 1,
    dashboard: { filter: 'pending', searchQuery: '', tags: [], sort: 'custom', density: 'comfortable' },
    progress: { period: '1w' },
    navigation: { screen: 'dashboard', selectedHabitId: null },
    themeUsage: []
  };
}

function createUser(userId: string, email: string): UserState {
  return { userId, email, theme: 'cloud', revision: 0, workspace: defaultWorkspace() };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function preferences(state: UserState): Record<string, unknown> {
  return {
    theme: state.theme,
    timezone: 'Europe/Belgrade',
    dashboard: {
      version: 1,
      ...state.workspace.dashboard,
      themeUsage: Object.fromEntries(state.workspace.themeUsage.map((entry) => [entry.theme, entry.count]))
    },
    workspace: state.workspace,
    revision: state.revision
  };
}

async function handlePreferenceUpdate(route: Route, state: UserState, ownedHabit: boolean, failures: { remaining: number }): Promise<void> {
  const payload = JSON.parse(route.request().postData() ?? '{}') as {
    theme?: ThemeId;
    workspace?: Workspace;
    revision?: number;
  };
  if (failures.remaining > 0 && payload.workspace?.dashboard.sort === 'smart') {
    failures.remaining -= 1;
    await json(route, { message: 'Temporary preference failure' }, 503);
    return;
  }
  if (payload.revision !== state.revision) {
    await json(route, preferences(state), 409);
    return;
  }
  const selectedHabitId = payload.workspace?.navigation.selectedHabitId;
  if (selectedHabitId && (!ownedHabit || selectedHabitId !== habitId)) {
    await json(route, { message: 'Selected habit is not available' }, 400);
    return;
  }
  state.theme = payload.theme ?? state.theme;
  state.workspace = payload.workspace ?? state.workspace;
  state.revision += 1;
  await json(route, preferences(state));
}

async function installBackend(context: BrowserContext, state: UserState, ownedHabit: boolean, preferenceFailures = 0): Promise<void> {
  const failures = { remaining: preferenceFailures };
  await context.route(/\/api\/auth\//, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/auth/session')) {
      await json(route, { userId: state.userId, email: state.email });
      return;
    }
    if (pathname.endsWith('/auth/preferences') && request.method() === 'GET') {
      await json(route, preferences(state));
      return;
    }
    if (pathname.endsWith('/auth/preferences') && request.method() === 'PUT') {
      await handlePreferenceUpdate(route, state, ownedHabit, failures);
      return;
    }
    await route.continue();
  });

  await context.route(/\/api\/habits(?:\/|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/habits/page')) {
        await json(route, { items: ownedHabit ? [habit] : [], nextCursor: null });
      } else if (pathname.endsWith('/habits')) {
        await json(route, ownedHabit ? [habit] : []);
      } else {
        await route.continue();
      }
      return;
    }
    await route.continue();
  });

  await context.route(/\/api\/checkins(?:\/|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      const pathname = new URL(route.request().url()).pathname;
      await json(route, pathname.endsWith('/checkins/page') ? { items: [], nextCursor: null } : []);
      return;
    }
    await route.continue();
  });
}

async function seedSession(page: Page, state: UserState): Promise<void> {
  await page.addInitScript(({ userId, email }) => {
    localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId, email }));
  }, { userId: state.userId, email: state.email });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('workspace preferences', () => {
  test('shows an accessible authenticated retry and clears it after confirmation', async ({ browser }) => {
    const state = createUser('sync-retry-user', 'sync-retry@example.test');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await installBackend(context, state, true, 1);
    const page = await context.newPage();
    await seedSession(page, state);
    try {
      await page.goto('/app/dashboard');
      await expect(page.getByRole('button', { name: 'Add habit' }).first()).toBeVisible();
      await page.getByRole('button', { name: /To do habits|All habits/ }).click();
      await page.getByRole('button', { name: 'Toggle smart sort' }).click();

      const retry = page.getByRole('button', { name: 'Retry preference synchronization' });
      await expect(retry).toBeVisible();
      await expect(retry.locator('xpath=..')).toHaveAttribute('role', 'status');
      await expect(page.getByRole('button', { name: 'Toggle smart sort' })).toHaveAttribute('aria-pressed', 'true');
      expect(await retry.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44;
      })).toBe(true);

      await retry.focus();
      await retry.press('Enter');
      await expect(retry).toBeHidden();
      expect(state.workspace.dashboard.sort).toBe('smart');
    } finally {
      await context.close();
    }
  });

});

test.describe('workspace preference canonical state', () => {
  test('restores canonical state across isolated contexts, reloads, conflicts, ownership, and viewports', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name === 'telegram-webview', 'Telegram launch flow is covered by the Telegram-specific E2E suite.');
    const sharedUser = createUser('workspace-user', 'workspace@example.test'); const otherUser = createUser('other-user', 'other@example.test');
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const contextOther = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await installBackend(contextA, sharedUser, true);
    await installBackend(contextB, sharedUser, true);
    await installBackend(contextOther, otherUser, false);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageOther = await contextOther.newPage();
    await seedSession(pageA, sharedUser);
    await seedSession(pageB, sharedUser);
    await seedSession(pageOther, otherUser);
    try {
      await pageA.goto('/app/dashboard');
      await expect(pageA.getByRole('button', { name: 'Add habit' }).first()).toBeVisible();
      await pageA.getByRole('button', { name: /To do habits|All habits/ }).click();
      await pageA.getByRole('button', { name: 'All', exact: true }).click();
      await pageA.getByRole('searchbox', { name: 'Search habits' }).fill('Read');
      await pageA.getByRole('button', { name: 'Toggle smart sort' }).click();
      await pageA.getByRole('button', { name: 'Toggle view density' }).click();
      await pageA.getByRole('button', { name: '#focus' }).click();
      await pageA.getByRole('button', { name: 'Choose color theme' }).click();
      await pageA.getByRole('button', { name: 'Switch to Matrix Terminal theme' }).click();

      await pageA.goto('/app/stats');
      await expect(pageA.getByRole('heading', { name: 'Progress' })).toBeVisible();
      await pageA.getByRole('button', { name: '4 weeks' }).click();
      await expect.poll(() => sharedUser.workspace.navigation.screen).toBe('progress');

      expect(sharedUser.workspace.navigation).toMatchObject({ screen: 'progress', selectedHabitId: null });
      expect(sharedUser.theme).toBe('matrix');
      expect(sharedUser.workspace.dashboard).toMatchObject({
        filter: 'all', searchQuery: 'Read', tags: ['focus'], sort: 'smart', density: 'compact'
      });
      expect(sharedUser.workspace.progress.period).toBe('4w');

      await pageB.goto('/');
      await expect(pageB).toHaveURL(/\/app\/stats$/);
      await expect(pageB.getByRole('heading', { name: 'Progress' })).toBeVisible();
      await expect(pageB.locator('html')).toHaveAttribute('data-theme', 'matrix');

      await pageB.goto('/app/dashboard');
      await pageB.getByRole('button', { name: 'All habits' }).click();
      await expect(pageB.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(pageB.getByRole('searchbox', { name: 'Search habits' })).toHaveValue('Read');
      await expect(pageB.getByRole('button', { name: 'Toggle smart sort' })).toHaveAttribute('aria-pressed', 'true');
      await expect(pageB.getByRole('button', { name: 'Toggle view density' })).toHaveAttribute('aria-pressed', 'true');
      await expect(pageB.getByRole('button', { name: '#focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await pageB.reload();
      await expect(pageB.getByRole('button', { name: 'All habits' })).toBeVisible();
      await pageB.goto('/app/stats'); await expect(pageB.getByRole('button', { name: '4 weeks' })).toHaveAttribute('aria-pressed', 'true');

      for (const viewport of [{ width: 320, height: 740 }, { width: 1280, height: 900 }] as const) {
        await pageB.setViewportSize(viewport);
        await pageB.goto('/app/dashboard');
        await expect(pageB.getByRole('button', { name: 'All habits' })).toBeVisible();
        await expectNoHorizontalOverflow(pageB);
        await pageB.getByRole('button', { name: 'All habits' }).press('Enter');
        await expect(pageB.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await pageB.goto('/app/stats');
        await expect(pageB.getByRole('button', { name: '4 weeks' })).toHaveAttribute('aria-pressed', 'true');
        await expectNoHorizontalOverflow(pageB);
      }

      const staleRevision = sharedUser.revision;
      const staleWorkspace = structuredClone(sharedUser.workspace);
      const firstDeviceUpdate = await pageA.evaluate(async ({ workspace, revision }) => {
        const response = await fetch('/api/auth/preferences', {
          method: 'PUT',
          body: JSON.stringify({ theme: 'matrix', timezone: 'Europe/Belgrade', workspace, revision })
        });
        return { status: response.status, body: await response.json() };
      }, {
        workspace: { ...staleWorkspace, dashboard: { ...staleWorkspace.dashboard, searchQuery: 'device-a' } },
        revision: staleRevision
      });
      expect(firstDeviceUpdate.status).toBe(200);

      const conflictResponse = pageB.waitForResponse((response) => response.url().includes('/api/auth/preferences')
        && response.request().method() === 'PUT' && response.status() === 409);
      await pageB.getByRole('button', { name: '12 weeks' }).click();
      await conflictResponse;
      await expect.poll(() => sharedUser.workspace.dashboard.searchQuery).toBe('device-a');
      await expect.poll(() => sharedUser.workspace.progress.period).toBe('12w');

      await pageOther.goto('/');
      await expect(pageOther).toHaveURL(/\/app\/dashboard$/);
      await expect(pageOther.getByRole('heading', { name: 'Habit Runner is ready' })).toBeVisible();
      expect(sharedUser.workspace.navigation.selectedHabitId).toBeNull();
      expect(otherUser.workspace.navigation.selectedHabitId).toBeNull();
      const otherAttempt = await pageOther.evaluate(async ({ workspace, revision }) => {
        const response = await fetch('/api/auth/preferences', {
          method: 'PUT',
          body: JSON.stringify({ theme: 'cloud', timezone: 'Europe/Belgrade', workspace, revision })
        });
        return response.status;
      }, {
        workspace: { ...otherUser.workspace, navigation: { screen: 'habit-detail', selectedHabitId: habitId } },
        revision: otherUser.revision
      });
      expect(otherAttempt).toBe(400);
      expect(otherUser.workspace.navigation.selectedHabitId).toBeNull();

    } finally {
      await contextA.close();
      await contextB.close();
      await contextOther.close();
    }
  });
});
