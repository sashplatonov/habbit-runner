import { expect, test, type Page, type Route } from '@playwright/test';
const habit = {
  id: 'e2e-habit',
  name: 'Read for ten minutes',
  description: 'E2E habit',
  color: 'blue',
  icon: '📚',
  frequency: 'DAILY',
  customDays: [],
  schedule: null,
  targetStreak: 7,
  dailyTarget: 1,
  tags: [],
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
const secondHabit = {
  ...habit, id: 'e2e-second-habit', name: 'Stretch for five minutes', icon: '🧘'
};
const scheduledSummaryHabits = [
  { ...habit, id: 'summary-daily', name: 'Daily reading', createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z' },
  { ...habit, id: 'summary-weekday', name: 'Friday stretch', icon: '🧘', schedule: { type: 'weekly_days', weekdays: [5] }, frequency: 'CUSTOM', customDays: [5], createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z', sortOrder: 2 },
  { ...habit, id: 'summary-quota', name: 'Weekly quota', schedule: { type: 'weekly_quota', timesPerWeek: 2, weekdays: [1, 3, 5] }, frequency: 'CUSTOM', customDays: [1, 3, 5], createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z', sortOrder: 3 },
  { ...habit, id: 'summary-unscheduled', name: 'Thursday only', schedule: { type: 'weekly_days', weekdays: [4] }, frequency: 'CUSTOM', customDays: [4], createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z', sortOrder: 4 }
];
const progressHabits = [
  { ...habit, id: 'progress-attention', name: 'Attention habit', createdAt: '2026-04-01T10:00:00Z' },
  { ...habit, id: 'progress-strong', name: 'Strong habit', createdAt: '2026-04-01T10:00:00Z', icon: '💪' }
  ];
function progressCheckins(): unknown[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date('2026-07-10T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    return {
      id: `progress-strong-${index}`,
      userId: 'e2e-user',
      habitId: 'progress-strong',
      date: date.toISOString().slice(0, 10),
      done: true,
      count: 1
    };
  });
}
async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
async function mockBackend(page: Page, habits: readonly Record<string, unknown>[] = [habit, secondHabit], initialCheckins: unknown[] = []): Promise<void> {
  let currentHabits = [...habits];
  const checkins = new Map(
    initialCheckins.map((checkin) => {
      const value = checkin as { habitId: string; date: string };
      return [`${value.habitId}:${value.date}`, checkin];
    })
  );
  await page.route(/\/(?:api\/)?auth\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes('/auth/session') || pathname.includes('/auth/preferences')) {
      await json(route, pathname.includes('/auth/session')
        ? { userId: 'e2e-user', email: 'e2e@example.test' }
        : { themeId: 'default' });
      return;
    }
    if (pathname.endsWith('/auth/logout')) {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.continue();
  });
  await page.route(/\/(?:api\/)?habits(?:\/|$)/, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/habits') && request.method() === 'GET') {
      await json(route, currentHabits);
    } else if (pathname.endsWith('/habits') && request.method() === 'POST') {
      const payload = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      const created = { ...habit, ...payload, id: 'e2e-created', name: payload['name'] ?? habit.name };
      currentHabits = [...currentHabits.filter((value) => value.id !== created.id), created];
      await json(route, created);
    } else if (pathname.includes('/habits/') && request.method() === 'PUT') {
      const updated = { ...habit, id: 'e2e-created', name: 'Read for twenty minutes', version: 2 };
      currentHabits = [...currentHabits.filter((value) => value.id !== updated.id), updated];
      await json(route, updated);
    } else if (pathname.includes('/habits/') && request.method() === 'DELETE') {
      const habitId = decodeURIComponent(pathname.split('/').at(-1) ?? '');
      currentHabits = currentHabits.filter((value) => value.id !== habitId);
      await route.fulfill({ status: 204 });
    } else {
      await route.continue();
    }
  });
  await page.route(/\/(?:api\/)?checkins(?:\/|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/checkins/page')) {
        await json(route, { items: [...checkins.values()], nextCursor: null });
        return;
      }
      await json(route, [...checkins.values()]);
    } else if (route.request().method() === 'PUT') {
      const url = new URL(route.request().url());
      const match = url.pathname.match(/\/habits\/([^/]+)\/dates\/([^/]+)$/);
      const payload = JSON.parse(route.request().postData() ?? '{}') as { done?: boolean; count?: number };
      const habitId = decodeURIComponent(match?.[1] ?? '');
      const date = decodeURIComponent(match?.[2] ?? '');
      const checkin = { id: `e2e-checkin-${habitId}-${date}`, userId: 'e2e-user', habitId, date, done: payload.done ?? false, count: payload.count ?? 0, createdAt: '2026-08-28T10:00:00Z', updatedAt: '2026-08-28T10:00:00Z', version: 1 };
      checkins.set(`${habitId}:${date}`, checkin);
      await json(route, { ...checkin });
    } else {
      await route.fulfill({ status: 204 });
    }
  });
}

const EDITOR_VIEWPORTS = [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }] as const;

async function expectViewportsClean(page: Page, open: () => Promise<void>): Promise<void> {
  for (const viewport of EDITOR_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await open();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
}
async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: 'e2e-user', email: 'e2e@example.test' }));
  });
}
async function openHabitDetails(page: Page): Promise<void> {
  const editButton = page.getByRole('button', { name: 'Edit habit' });
  const habitCard = page.getByRole('article', { name: /⚡ Read for ten minutes/ }).getByRole('button').filter({ hasText: 'Read for ten minutes' });
  await expect.poll(async () => {
    if (await editButton.isVisible()) {
      return 'detail';
    }
    if (await habitCard.isVisible()) {
      return 'dashboard';
    }
    return 'loading';
  }, { timeout: 10_000 }).toMatch(/detail|dashboard/);
  if (await editButton.isVisible()) {
    return;
  }
  await habitCard.click();
  await expect(page).toHaveURL(/\/app\/habit\/[^/]+$/);
  await expect(editButton).toBeVisible();
}
async function openHabitIdentity(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Edit Identity' }).click();
}
function trackHabitMutations(page: Page, mutations: string[]): void {
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.includes('/habits')) {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
}

async function expectOneRowHeatmap(container: ReturnType<Page['locator']>): Promise<void> {
  const row = container.locator('[data-heatmap-row]');
  await expect(row).toBeVisible();
  const cells = row.locator('[data-heatmap-cell]');
  await expect(cells).toHaveCount(30);

  const rowBox = await row.boundingBox();
  const firstBox = await cells.first().boundingBox();
  const lastBox = await cells.last().boundingBox();
  expect(rowBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  expect(firstBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
  // CSS grid tracks can accumulate subpixel rounding at the final cell edge.
  expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 2);
  expect(Math.abs(firstBox!.y - lastBox!.y)).toBeLessThanOrEqual(3);
  expect(Math.abs(firstBox!.width - firstBox!.height)).toBeLessThanOrEqual(1);
  expect(firstBox!.width).toBeLessThanOrEqual(9);
  expect(firstBox!.x).toBeLessThan(lastBox!.x);
}
// The density toggle is an inline icon control in the shared toolbar.
async function setDashboardDensity(page: Page, density: 'comfortable' | 'compact'): Promise<void> {
  const filterToggle = page.locator('button[aria-controls="dashboard-filter-panel"]');
  if (await filterToggle.getAttribute('aria-expanded') === 'false') {
    await filterToggle.click();
  }
  const densityButton = page.getByRole('button', { name: 'Toggle view density' });
  await densityButton.click();
  await expect(densityButton).toHaveAttribute('aria-pressed', density === 'compact' ? 'true' : 'false');
}
// eslint-disable-next-line max-lines-per-function
test.describe.serial('critical habit journey', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockBackend(page); });

  test('creates, checks in, edits, reviews progress, and deletes a habit', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page.getByRole('button', { name: 'Add habit' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add habit' }).first().click();
    await openHabitIdentity(page);
    await page.getByLabel('Name *').fill('Read for ten minutes');
    await page.getByRole('button', { name: 'Create habit' }).last().click();
    await expect(page).toHaveURL(/\/app\/dashboard|\/app\/habit\//);

    await openHabitDetails(page);
    await expect(page.getByText(/Read for ten minutes/).first()).toBeVisible();

    await page.goto('/app/stats');
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

    await page.goto('/app/dashboard');
    await openHabitDetails(page);
    await page.getByRole('button', { name: 'Edit habit' }).click();
    await openHabitIdentity(page);
    await page.getByLabel('Name *').fill('Read for twenty minutes');
    await page.getByRole('button', { name: 'Save habit' }).last().click();
    const deleteHabitButton = page.getByRole('button', { name: /^Delete/ });
    await expect(deleteHabitButton).toBeVisible();

    await deleteHabitButton.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
  });
  test('renders the compact editor dashboard without saving draft navigation', async ({ page }) => {
    const mutations: string[] = [];
    trackHabitMutations(page, mutations);

    await page.goto('/app/habit/new');
    await expect(page.locator('[data-editor-dashboard]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(page.locator('[data-editor-dashboard] [data-testid="preview-behavior"]')).toContainText('Build habit · Daily');
    await expect(page.locator('[data-editor-tile]')).toHaveCount(6);
    expect(await page.locator('[data-editor-tile]').evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-editor-tile')))).toEqual(['identity', 'habit-type', 'schedule', 'goal', 'reminder', 'organization']);
    for (const [tile, panel] of [['Edit Goal', 'habit-goal-panel'], ['Edit Reminder', 'habit-reminder-panel'], ['Edit Organization', 'habit-organization-panel']] as const) {
      await page.getByRole('button', { name: tile }).click();
      await expect(page.locator(`[data-testid="${panel}"]`)).toBeVisible();
      await page.getByRole('button', { name: 'Back to habit editor dashboard' }).click();
    }
    await expect(page.locator('[data-editor-dashboard]')).toBeVisible();
    for (const viewport of EDITOR_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/app/habit/new');
      await expect(page.locator('[data-editor-dashboard]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (viewport.width < 640) {
        const footer = page.locator('[class~="fixed"]').last();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const [footerBox, contentBox] = await Promise.all([footer.boundingBox(), page.getByText('Notification behavior').boundingBox()]);
        expect(footerBox).not.toBeNull();
        expect(contentBox).not.toBeNull();
        expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(footerBox!.y);
      }
    }
    expect(mutations).toEqual([]);
  }); test('routes dashboard validation to Identity at compact widths without saving', async ({ page }) => { const mutations: string[] = []; trackHabitMutations(page, mutations); for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }] as const) { await page.setViewportSize(viewport); await page.goto('/app/habit/new'); await page.getByRole('button', { name: 'Create habit' }).last().click(); await expect(page.locator('form')).toHaveAttribute('data-editor-panel', 'identity'); await expect(page.getByRole('alert')).toContainText('Name is required'); await expect(page.locator('#habit-name')).toBeFocused(); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); const [fieldBox, footerBox] = await Promise.all([page.locator('#habit-name').boundingBox(), page.locator('[class~="fixed"]').last().boundingBox()]); expect(fieldBox).not.toBeNull(); expect(footerBox).not.toBeNull(); expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(footerBox!.y); } expect(mutations).toEqual([]); });
  test('edits habit type on the focused panel without saving before Save', async ({ page }) => {
    const mutations: string[] = [];
    trackHabitMutations(page, mutations);
    const openHabitTypePanel = async () => {
      await page.goto('/app/habit/new');
      await page.locator('[data-editor-tile="habit-type"]').click();
      await expect(page.locator('[data-editor-habit-type]')).toBeVisible();
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await openHabitTypePanel();
    await expect(page.locator('form')).toHaveAttribute('data-editor-panel', 'habit-type');
    await expect(page.getByRole('button', { name: 'Build habit' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-editor-habit-type-rule]')).toHaveText('Build habit');

    await page.getByRole('button', { name: 'Avoid habit' }).click();
    await expect(page.getByRole('button', { name: 'Avoid habit' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Build habit' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-editor-habit-type-rule]')).toHaveText('Avoid habit');
    await page.getByRole('button', { name: 'Back to habit editor dashboard' }).click();
    await expect(page.getByRole('button', { name: 'Edit Habit type' })).toContainText('Avoid habit');
    expect(mutations).toEqual([]);
    await page.locator('[data-editor-tile="habit-type"]').click();
    const optionHeights = await page.locator('[data-habit-type-option]').evaluateAll((options) => options.map((o) => (o as HTMLElement).offsetHeight));
    expect(Math.min(...optionHeights)).toBeGreaterThanOrEqual(44);

    await expectViewportsClean(page, openHabitTypePanel);
  });
  test('shows reference-specific context on every focused editor panel', async ({ page }) => {
    const panels = [['identity', 'Edit Identity', 'Identity', 'Edit habit · Identity'], ['habit-type', 'Edit Habit type', 'Habit type', 'Edit habit · Behavior'], ['schedule', 'Edit Schedule', 'Schedule', 'Edit habit · Schedule'], ['goal', 'Edit Goal', 'Goal', 'Edit habit · Goal'], ['reminder', 'Edit Reminder', 'Reminder', 'Edit habit · Reminder'], ['organization', 'Edit Organization', 'Organization', 'Edit habit · Tags']] as const;
    for (const [tile, action, title, subtitle] of panels) { await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/app/habit/new'); await page.locator(`[data-editor-tile="${tile}"]`).click(); await expect(page.locator('form')).toHaveAttribute('data-editor-panel', tile); await expect(page.locator('h1')).toHaveText(title); await expect(page.getByText(subtitle, { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Back to habit editor dashboard' }).click(); await expect(page.getByRole('button', { name: action })).toBeVisible(); }
  }); test('opens each schedule variant as a focused screen and preserves the draft across Back levels', async ({ page }) => {
    const mutations: string[] = [];
    trackHabitMutations(page, mutations);
    const variants = [
      ['Daily Every day', 'Daily schedule', 'Schedule · Daily', 'daily-summary'],
      ['Days of week Pick weekdays', 'Days of week', 'Schedule · Pick weekdays', 'schedule-weekdays-view'],
      ['Weekly quota Target completions per week', 'Weekly quota', 'Schedule · Flexible weekly target', 'weekly-quota-view'],
      ['Monthly quota Target completions per month', 'Monthly quota', 'Schedule · Flexible monthly target', 'monthly-quota-view'],
      ['Monthly weeks Choose weeks of month', 'Monthly weeks', 'Schedule · Weeks of month', 'monthly-weeks-view']
    ] as const;
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }] as const) {
      await page.setViewportSize(viewport);
      await page.goto('/app/habit/new');
      await page.locator('[data-editor-tile="schedule"]').click();
      const chooser = page.getByRole('group', { name: 'Schedule type' });
      await expect(chooser.getByRole('button')).toHaveCount(5);
      for (const [option, title, subtitle, detailTestId] of variants) {
        await chooser.getByRole('button', { name: option }).click();
        await expect(page.getByRole('heading', { name: title })).toBeVisible();
        await expect(page.getByText(subtitle, { exact: true })).toBeVisible();
        await expect(page.getByTestId(detailTestId)).toBeVisible();
        await expect(page.getByRole('group', { name: 'Schedule type' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Back to habit editor dashboard' }).click();
        await expect(page.getByRole('group', { name: 'Schedule type' })).toBeVisible();
        await expect(chooser.getByRole('button', { name: option })).toHaveAttribute('aria-pressed', 'true');
      }
      await page.getByRole('button', { name: 'Back to habit editor dashboard' }).click();
      await expect(page.locator('[data-editor-tile="schedule"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(mutations).toEqual([]);
  });
  test('keeps reminder controls in reference order and reachable', async ({ page }) => { for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }] as const) { await page.setViewportSize(viewport); await page.goto('/app/habit/new'); await page.locator('[data-editor-tile="reminder"]').click(); const summary = page.getByTestId('habit-reminder-summary'); const notice = page.getByTestId('habit-reminder-notice'); await expect(summary).toBeVisible(); await expect(notice).toBeVisible(); expect(await summary.evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await notice.elementHandle())).toBe(true); await expect(page.getByRole('button', { name: 'Reminders enabled' })).toHaveAttribute('aria-pressed', 'true'); await page.getByRole('button', { name: 'Reminders enabled' }).click(); await expect(page.getByRole('button', { name: 'Reminders disabled' })).toHaveAttribute('aria-pressed', 'false'); await page.getByLabel('Reminder time').fill(''); await expect(summary).toContainText('No reminder time configured'); await notice.scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); if (viewport.width < 640) { const [noticeBox, footerBox] = await Promise.all([notice.boundingBox(), page.locator('[class~="fixed"]').last().boundingBox()]); expect(noticeBox).not.toBeNull(); expect(footerBox).not.toBeNull(); expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(footerBox!.y); } } });
  test('shows safe validation state', async ({ page }) => {
    await page.route(/\/(?:api\/)?habits$/, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.stringify({ type: 'https://habbit-runner.dev/errors/validation', title: 'Constraint Violation', status: 400, detail: 'create.name must not be blank', errorCode: 'VALIDATION_FAILED' });
        await route.fulfill({ status: 400, contentType: 'application/json', body });
        return;
      }
      await route.continue();
    });
    await page.goto('/app/habit/new');
    await openHabitIdentity(page);
    await page.getByLabel('Name *').fill('Conflict proof');
    await page.getByRole('button', { name: 'Create habit' }).last().click();
    await expect(page.getByText('Check the highlighted fields and try again.')).toBeVisible();
  });
  test('keeps dashboard heatmaps usable in compact and comfortable layouts', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/dashboard');
    await setDashboardDensity(page, 'compact');
    const rows = page.locator('li[data-habit-id]');
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expectOneRowHeatmap(row);
      await expect(row.getByRole('img', { name: /last 30 days/ })).toBeVisible();
      await expect(row.getByRole('button', { name: /Complete/ })).toBeVisible();
    }
    await expect(rows.first().getByRole('button', { name: /Read for ten minutes, not completed/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 740 });
    await setDashboardDensity(page, 'comfortable');
    const tiles = page.locator('article[aria-label*="completed"], article[aria-label*="not completed"]');
    await expect(tiles).toHaveCount(2);
    for (const tile of await tiles.all()) {
      const heatmap = tile.getByRole('img', { name: /last 30 days/ });
      await expect(heatmap).toBeVisible();
      await expectOneRowHeatmap(tile);
      const tileBox = await tile.boundingBox(); const heatmapBox = await heatmap.boundingBox();      expect(tileBox).not.toBeNull();
      expect(heatmapBox).not.toBeNull();
      expect(heatmapBox!.x).toBeGreaterThanOrEqual(tileBox!.x);
      expect(heatmapBox!.x + heatmapBox!.width).toBeLessThanOrEqual(tileBox!.x + tileBox!.width);
      await expect(tile.getByRole('button', { name: /Complete/ })).toBeVisible();
      await expect(tile.locator('button').filter({ hasText: /Read for ten minutes|Stretch for five minutes/ })).toBeVisible();
    }
  });

  test('keeps description feedback usable at compact mobile and desktop widths', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/app/habit/new');

      await openHabitIdentity(page);
      const description = page.getByLabel(/Description/);
      await description.fill('x'.repeat(8000));

      await expect(page.getByText('8000 / 8000 characters')).toBeVisible();
      await expect(page.getByText('0 remaining')).toBeVisible();
      await expect(description).toHaveAttribute('maxlength', '8000');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('shows safe conflict state', async ({ page }) => {
    await page.goto('/app/dashboard');
    await openHabitDetails(page);
    await page.getByRole('button', { name: 'Edit habit' }).click();
    await openHabitIdentity(page);
    await page.route(/\/(?:api\/)?habits\//, async (route) => {
      if (route.request().method() === 'PUT') {
        const body = JSON.stringify({ type: 'https://habbit-runner.dev/errors/conflict', title: 'Conflict', status: 409, detail: 'stale version', errorCode: 'RESOURCE_VERSION_CONFLICT' });
        await route.fulfill({ status: 409, contentType: 'application/json', body });
        return;
      }
      await route.continue();
    });
    await page.getByLabel('Name *').fill('Conflict proof updated');
    await page.getByRole('button', { name: 'Save habit' }).last().click();
    await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  });
});

test.describe.serial('scheduled dashboard summary', () => {
  test.use({ timezoneId: 'UTC' });

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await mockBackend(page, scheduledSummaryHabits, [
      { id: 'summary-daily-aug-28', habitId: 'summary-daily', date: '2026-08-28', done: true, count: 1 },
      { id: 'summary-daily-aug-27', habitId: 'summary-daily', date: '2026-08-27', done: true, count: 1 },
      { id: 'summary-quota-aug-24', habitId: 'summary-quota', date: '2026-08-24', done: true, count: 1 }
    ]);
  });

  test('proves scheduled summary behavior and responsive geometry', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-28T12:00:00Z') });

    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/app/dashboard');

      const summary = page.getByRole('region', { name: 'Scheduled completion summary' });
      await expect(summary).toBeVisible();
      if (viewport.width > 560) {
        await expect(summary.locator('[data-layout="desktop"]')).toBeVisible();
        await expect(summary.locator('[data-layout="mobile"]')).toBeHidden();
      } else {
        await expect(summary.locator('[data-layout="desktop"]')).toBeHidden();
        await expect(summary.locator('[data-layout="mobile"]')).toBeVisible();
      }
      await expect(summary.locator('[data-layout="desktop"] [role="img"][aria-label="30-day scheduled completion heatmap"]')).toHaveCount(1);
      await expect(summary.locator('[data-layout="desktop"] [aria-label^="2026-"]')).toHaveCount(30);
      await expect(summary.locator('[data-layout="desktop"] [aria-label^="Scheduled habit "]')).toHaveCount(3);
      await expect(summary.getByText('1/3')).toHaveCount(2);
      await expect(summary.locator('[data-layout="desktop"]').getByText('33%', { exact: true })).toHaveCount(2);
      await expect(summary.locator('[data-layout="mobile"]').getByText('33%', { exact: true })).toHaveCount(1);

      if (viewport.width <= 560) {
        await expect(summary.locator('[data-layout="mobile"] > div')).toHaveCount(3);
        await expect(summary.getByLabel('Heatmap brightness legend')).toBeHidden();
        await expect(summary.locator('[data-layout="mobile"] [aria-label^="2026-"]')).toHaveCount(30);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.getByRole('button', { name: 'Add habit' }).first()).toBeVisible();
      } else {
        await expect(summary.getByLabel('Heatmap brightness legend')).toBeVisible();
        const filterToggle = page.locator('button[aria-controls="dashboard-filter-panel"]');
        await filterToggle.click();
        const summaryBox = await summary.boundingBox();
        const densityToggle = page.getByRole('button', { name: 'Toggle view density' });
        const toolbarBox = await densityToggle.boundingBox();
        expect(summaryBox).not.toBeNull();
        expect(toolbarBox).not.toBeNull();
        expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(toolbarBox!.y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/dashboard');
    await page.getByRole('button', { name: /Complete.*Friday stretch/ }).click();
    await expect(page.getByRole('img', { name: /Today: 2 of 3 scheduled habits completed, 67%/ })).toBeVisible();
    await expect(page.locator('[data-layout="desktop"] [aria-label="Scheduled habit 2: completed"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add habit' }).first()).toBeVisible();
  });

  test('uses the saved user timezone for today\'s summary date', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('habit-user-timezone', 'America/Los_Angeles');
    });
    await page.clock.install({ time: new Date('2026-08-28T12:00:00Z') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/app/dashboard');

    const summary = page.getByRole('region', { name: 'Scheduled completion summary' });
    await expect(summary.locator('[data-layout="desktop"] [aria-label="2026-08-28: 1 of 3 scheduled habits completed"]')).toHaveCount(1);
  });
});

test.describe('authenticated progress analytics', () => {
  test.use({ timezoneId: 'UTC' });

  test('keeps sections, history, controls, tooltips, and strip geometry aligned', async ({ page }) => {
    await seedSession(page);
    await mockBackend(page, progressHabits, progressCheckins());
    await page.clock.install({ time: new Date('2026-07-16T12:00:00Z') });

    const progressPeriods = [
      ['This week', 7],
      ['4 weeks', 28],
      ['12 weeks', 84]
    ] as const;
    for (const [windowLabel, cellCount] of progressPeriods) {
      await page.setViewportSize({ width: windowLabel === '12 weeks' ? 1280 : 320, height: 900 });
      await page.goto('/app/stats');
      await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Strong' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

      const period = page.getByRole('group', { name: 'Progress period' });
      const tab = period.getByRole('button', { name: windowLabel });
      if (windowLabel !== 'This week') {
        await tab.click();
      }
      await expect(tab).toHaveAttribute('aria-pressed', 'true');
      await tab.focus();
      await expect(tab).toBeFocused();

      const rows = page.locator('article[aria-label*="habit"]');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const strip = row.locator('[role="list"][aria-label$="activity"]');
        await expect(strip).toHaveCount(1);
        await expect(strip.locator('[role="listitem"]')).toHaveCount(cellCount);
        const stripBox = await strip.boundingBox();
        const rowBox = await row.boundingBox();
        expect(stripBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
        expect(stripBox!.x + stripBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }

      const history = page.getByRole('list', { name: '12-week completion history' });
      await expect(history.locator('[role="listitem"]')).toHaveCount(84);
      const guide = page.getByRole('button', { name: 'More information: History' });
      await guide.press('Enter');
      await expect(page.getByRole('tooltip')).toBeVisible();
      await guide.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(guide).toBeFocused();
    }
  }); });
