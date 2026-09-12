import { expect, test } from '@playwright/test';

const userId = process.env.E2E_USER_ID ?? '';
const email = process.env.E2E_EMAIL ?? '';
const accessToken = process.env.E2E_ACCESS_TOKEN ?? '';
const refreshToken = process.env.E2E_REFRESH_TOKEN ?? '';
const csrfToken = process.env.E2E_CSRF_TOKEN ?? '';

test.describe('real stack contract', () => {
  test('creates, checks in, persists after reload, and surfaces a stale conflict', async ({ page, context, baseURL }) => {
    test.skip(!userId || !email || !accessToken || !refreshToken || !csrfToken, 'Stack harness credentials are required');

    const origin = new URL(baseURL ?? 'http://localhost:5137');
    await context.addCookies([
      { name: 'habbit_runner_access_token', value: accessToken, domain: origin.hostname, path: '/' },
      { name: 'habbit_runner_refresh_token', value: refreshToken, domain: origin.hostname, path: '/' },
      { name: 'habbit_runner_csrf_token', value: csrfToken, domain: origin.hostname, path: '/' }
    ]);
    await page.addInitScript(({ sessionUserId, sessionEmail }) => {
      localStorage.setItem('habbitRunner.auth.session', JSON.stringify({ userId: sessionUserId, email: sessionEmail }));
    }, { sessionUserId: userId, sessionEmail: email });

    const authenticatedSession = await page.request.get('/api/auth/session');
    expect(authenticatedSession.status()).toBe(200);
    expect(await authenticatedSession.json()).toMatchObject({ userId, email });

    const habitName = `Stack contract ${Date.now()}`;
    await page.goto('/app/habit/new');
    await expect(page.getByRole('heading', { name: 'New habit', exact: true })).toBeVisible();
    await page.locator('[data-editor-tile="identity"]').click();
    await page.getByLabel('Name *').fill(habitName);

    const createResponse = page.waitForResponse((response) =>
      response.url().includes('/api/habits') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Create habit' }).last().click();
    const createdHabit = await (await createResponse).json() as { id: string; version: number };
    expect(createdHabit.id).toBeTruthy();

    await page.goto('/app/dashboard');
    const habitCard = page.locator('article').filter({ hasText: habitName });
    await expect(habitCard).toBeVisible();

    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const checkinResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/checkins/habits/${createdHabit.id}/dates/`) && response.request().method() === 'PUT'
    );
    await habitCard.getByRole('button', { name: /Complete/ }).click();
    expect((await checkinResponse).status()).toBe(200);

    await page.reload();
    const persistedCheckins = await page.request.get('/api/checkins');
    expect(persistedCheckins.ok()).toBeTruthy();
    expect((await persistedCheckins.json()).some((checkin: { habitId: string; date: string }) =>
      checkin.habitId === createdHabit.id && checkin.date === today
    )).toBeTruthy();

    await page.getByRole('button', { name: 'To do habits' }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await habitCard.getByRole('button', { name: new RegExp(habitName) }).first().click();
    await expect(page.getByRole('button', { name: 'Edit habit' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit habit' }).click();

    const currentHabitResponse = await page.request.get('/api/habits');
    expect(currentHabitResponse.ok()).toBeTruthy();
    const currentHabit = (await currentHabitResponse.json() as Array<{ id: string; version: number }>).find((habit) => habit.id === createdHabit.id);
    expect(currentHabit).toBeTruthy();
    const externalUpdate = await page.request.put(`/api/habits/${createdHabit.id}`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { name: `${habitName} external`, version: currentHabit!.version }
    });
    expect(externalUpdate.status()).toBe(200);

    await page.locator('[data-editor-tile="identity"]').click();
    await page.getByLabel('Name *').fill(`${habitName} stale write`);
    const staleResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/habits/${createdHabit.id}`) && response.request().method() === 'PUT'
    );
    await page.getByRole('button', { name: 'Save habit' }).last().click();
    expect((await staleResponse).status()).toBe(409);
    await expect(page.locator('text=This item changed elsewhere. Refresh and try again.')).toBeVisible();
  });
});
