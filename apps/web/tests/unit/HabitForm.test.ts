/* eslint-disable max-lines-per-function */
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import HabitForm from '../../src/lib/components/HabitForm.svelte';
import type { Habit } from '../../src/types/habit';
const BASE_HABIT: Habit = {
  id: 'habit-1',
  name: 'Deep Work',
  description: 'Protect a focused block.',
  color: 'blue',
  icon: '⚡',
  tags: [],
  frequency: 'daily',
  schedule: { type: 'daily' },
  targetStreak: 21,
  dailyTarget: 1,
  completions: {},
  freezeDays: [],
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-04-15T09:00:00.000Z',
  version: 1,
  archived: false,
  sortOrder: 0,
  type: 'positive',
  reminderEnabled: true
};
function createHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    ...BASE_HABIT,
    ...overrides,
    tags: overrides.tags ?? [],
    schedule: overrides.schedule ?? { type: 'daily' },
    completions: overrides.completions ?? {},
    freezeDays: overrides.freezeDays ?? [],
    ...(overrides.customDays ? { customDays: overrides.customDays } : {}),
    ...(overrides.reminderTime ? { reminderTime: overrides.reminderTime } : {})
  };
}
async function openPanel(user: ReturnType<typeof userEvent.setup>, panel: string): Promise<void> {
  if (panel !== 'identity') {
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
  }
  const title = panel === 'habit-type' ? 'Habit type' : `${panel[0].toUpperCase()}${panel.slice(1)}`;
  await user.click(screen.getByRole('button', { name: `Edit ${title}` }));
}
describe('HabitForm', () => {
  it('shows and dismisses the soft-limit warning for over-limit create flows', async () => {
    const user = userEvent.setup();
    render(HabitForm, { props: { mode: 'create', allHabits: [createHabit({ id: '1' }), createHabit({ id: '2' }), createHabit({ id: '3' })], onBack: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined) } });
    expect(screen.getByText('Focus is key')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(screen.queryByText('Focus is key')).toBeNull();
  });
  it('restores legacy tag and custom icon controls on edit', async () => {
    const user = userEvent.setup();
    render(HabitForm, { props: { mode: 'edit', habit: createHabit(), allHabits: [createHabit()], onBack: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined) } });
    await openPanel(user, 'identity');
    const customIconInput = screen.getByLabelText('Custom habit icon') as HTMLInputElement;
    await user.type(customIconInput, '🛰');
    expect(customIconInput.value.length).toBeGreaterThan(0);
    await openPanel(user, 'organization');
    await user.click(screen.getByRole('button', { name: '+health' }));

    expect(screen.getByText('#health')).toBeTruthy();
  });

  it('shows the reference-specific focused-panel context', async () => { const user = userEvent.setup(); render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined) } }); await user.click(screen.getByRole('button', { name: 'Edit Identity' })); expect(screen.getByRole('heading', { level: 1, name: 'Identity' })).toBeTruthy(); expect(screen.getByText('Edit habit · Identity', { exact: true })).toBeTruthy(); }); it('adds, removes, and limits tags with a live dashboard summary and payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });
    await user.click(screen.getByRole('button', { name: 'Edit Organization' }));
    const panel = screen.getByTestId('habit-organization-panel');
    expect(within(panel).getByText('Tags · 0/5')).toBeTruthy();
    const tagInput = screen.getByPlaceholderText('Add tag…') as HTMLInputElement;
    await user.type(tagInput, 'Health!');
    await user.keyboard('{Enter}');
    expect(within(panel).getByText('#health')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('Add tag…'), 'focus,');
    expect(within(panel).getByText('#focus')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove focus' }));
    expect(within(panel).queryByText('#focus')).toBeNull();
    await user.type(screen.getByPlaceholderText('Add tag…'), 'focus');
    await user.keyboard('{Enter}');
    expect(within(panel).getAllByText('#focus').length).toBe(1);
    expect((tagInput as HTMLInputElement).value).toBe('');
    for (const tag of ['running', 'sleep', 'reading']) {
      await user.type(screen.getByPlaceholderText('Add tag…'), tag);
      await user.keyboard('{Enter}');
    }
    expect(within(panel).getByText('Tags · 5/5')).toBeTruthy();
    expect((screen.getByPlaceholderText('Add tag…') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add tag' }).hasAttribute('disabled')).toBe(true);
    expect(within(panel).getAllByRole('button', { name: /\+fitness|\+productivity|\+learning/ }).every((button) => button.hasAttribute('disabled'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Organization' })).getByText('#health · #focus · #running · #sleep · #reading · 5/5 tags')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Tagged habit');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['health', 'focus', 'running', 'sleep', 'reading']
    }));
  });

  it('keeps the identity draft when returning to the dashboard and submits it on save', async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Breath 4-7-8');
    await user.click(screen.getByRole('button', { name: 'Use 🧘 as habit icon' }));
    await user.click(screen.getByRole('button', { name: 'Select Cyan color' }));
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));

    expect(screen.getByText('🧘 Breath 4-7-8 · Cyan')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy();
    expect(screen.getByTestId('preview-behavior').textContent).toContain('Build habit · Daily');
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Breath 4-7-8');
    expect(screen.getByRole('button', { name: 'Use 🧘 as habit icon' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Select Cyan color' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Breath 4-7-8',
      icon: '🧘',
      color: 'cyan'
    }));
  });
  it('keeps invalid-name feedback on the identity panel and refocuses the name field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'edit', habit: createHabit(), allHabits: [createHabit()], onBack: vi.fn(), onSubmit } });

    await openPanel(user, 'identity');
    const nameInput = screen.getByLabelText('Name *') as HTMLInputElement;
    await user.clear(nameInput);
    await user.click(screen.getAllByRole('button', { name: 'Save habit' }).at(-1)!);

    await waitFor(() => {
      expect(document.activeElement?.id).toBe('habit-name');
    });
    expect(screen.getAllByText('Name is required').length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  }); it('routes a dashboard name validation failure to Identity and focuses the name field', async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined); render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } }); await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(document.querySelector('form')?.getAttribute('data-editor-panel')).toBe('identity'); expect(document.activeElement?.id).toBe('habit-name'); });
    expect(screen.getByRole('alert').textContent).toContain('Name is required'); expect(onSubmit).not.toHaveBeenCalled(); }); it('routes an invalid monthly-weeks dashboard save to Schedule without changing the draft', async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } }); await user.click(screen.getByRole('button', { name: 'Edit Identity' })); await user.type(screen.getByLabelText('Name *'), 'Monthly habit'); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Monthly weeks Choose weeks of month' })); await user.click(screen.getByRole('button', { name: 'Toggle week 1 of the month' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!); await waitFor(() => { expect(document.querySelector('form')?.getAttribute('data-editor-panel')).toBe('schedule'); expect(document.activeElement?.getAttribute('aria-label')).toBe('Toggle week 1 of the month'); });
    expect(screen.getAllByRole('alert')[0].textContent).toContain('Select at least one week'); expect(screen.getByRole('heading', { name: 'Monthly weeks' })).toBeTruthy(); expect(screen.getByTestId('monthly-weeks-view')).toBeTruthy(); expect(onSubmit).not.toHaveBeenCalled(); });

  it('keeps the habit-type draft when returning to the dashboard and submits it on save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Habit type' }));
    expect(screen.getByRole('button', { name: 'Avoid habit' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Complete 1 scheduled repetition to mark the day done.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Avoid habit' }));

    expect(screen.getByRole('button', { name: 'Avoid habit' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Build habit' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Mark the day done when the count is still zero: success means one fewer slip.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Habit type' })).getByText('Avoid habit')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit Habit type' }));
    expect(screen.getByRole('button', { name: 'Avoid habit' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'No late scrolling');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'negative'
    }));
  });

  it('keeps the schedule chooser order, active state, and draft transitions without saving', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    const chooser = screen.getByRole('group', { name: 'Schedule type' });
    expect(within(chooser).getAllByRole('button').map((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim()))
      .toEqual([
        'Daily Every day',
        'Days of week Pick weekdays',
        'Weekly quota Target completions per week',
        'Monthly quota Target completions per month',
        'Monthly weeks Choose weeks of month'
      ]);

    expect(screen.getByRole('button', { name: 'Daily Every day' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('A scheduled opportunity is created every calendar day.')).toBeTruthy(); expect(screen.getByText('Changing the schedule affects future opportunities only. Existing history stays unchanged.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Days of week Pick weekdays' }));
    expect(screen.getByRole('heading', { name: 'Days of week' })).toBeTruthy();
    expect(screen.getByLabelText('Toggle Monday for the schedule').getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(screen.getByRole('button', { name: 'Days of week Pick weekdays' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Daily Every day' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Schedule' })).getByText('Every Mon, Tue, Wed, Thu, Fri')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    expect(screen.getByRole('button', { name: 'Days of week Pick weekdays' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Weekday reading');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { type: 'weekly_days', weekdays: [1, 2, 3, 4, 5] }
    }));
  });

  it('shows the daily summary with metrics and rule but no editable schedule controls', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Daily Every day' }));
    expect(screen.getByRole('heading', { name: 'Daily schedule' })).toBeTruthy();
    const dailySummary = screen.getByTestId('daily-summary');
    expect(within(dailySummary).getByText('Every day')).toBeTruthy(); expect(within(dailySummary).getByText('Monday through Sunday')).toBeTruthy();
    expect(within(dailySummary).getByText('scheduled days / week')).toBeTruthy(); expect(within(dailySummary).getByText('opportunity frequency')).toBeTruthy();
    expect(within(dailySummary).getByText('A scheduled opportunity is created every calendar day.')).toBeTruthy();
    expect(within(dailySummary).getByText('Existing history remains unchanged.')).toBeTruthy();

    expect(screen.queryByLabelText(/Toggle .* for the schedule/)).toBeNull();
    expect(screen.queryByLabelText('Times per week')).toBeNull();
    expect(screen.queryByLabelText('Times per month')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Days of week Pick weekdays' }));
    expect(screen.getByLabelText('Toggle Monday for the schedule')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Daily Every day' }));
    expect(screen.getByTestId('daily-summary')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('selects weekdays with count, pattern, and rule summaries while preserving validation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Days of week Pick weekdays' }));
    const weekdays = screen.getByTestId('schedule-weekdays-view');

    expect(within(weekdays).getByText(/^(5)$/)).toBeTruthy();
    expect(within(weekdays).getByText('Mon · Tue · Wed · Thu · Fri')).toBeTruthy();
    expect(within(weekdays).getByText('Only Monday, Tuesday, Wednesday, Thursday and Friday count as scheduled days.')).toBeTruthy();
    expect(within(weekdays).getByText('Other weekdays are not treated as missed opportunities.')).toBeTruthy();
    const buttons = [1, 2, 3, 4, 5, 6, 0].map((day) => screen.getByLabelText(`Toggle ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]} for the schedule`));
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(5);

    await user.click(screen.getByLabelText('Toggle Tuesday for the schedule'));
    await user.click(screen.getByLabelText('Toggle Thursday for the schedule'));
    await user.click(screen.getByLabelText('Toggle Friday for the schedule'));
    expect(within(weekdays).getByText('2')).toBeTruthy();
    expect(within(weekdays).getByText('Mon · Wed')).toBeTruthy();
    expect(within(weekdays).getByText('Only Monday and Wednesday count as scheduled days.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Schedule' })).getByText('Every Mon, Wed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Mon Wednesday');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { type: 'weekly_days', weekdays: [1, 3] },
      frequency: 'custom',
      customDays: [1, 3]
    }));
  });

  it('bounds the weekly quota counter and reflects target and flexible-timing summaries before save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Weekly quota Target completions per week' }));
    const view = screen.getByTestId('weekly-quota-view');

    expect(within(view).getByText('2 / week')).toBeTruthy();
    expect(within(view).getByText('Flexible days')).toBeTruthy();
    expect(within(view).getByText('The week is on target after 2 completions.')).toBeTruthy();
    expect(within(view).getByText('No individual weekday is automatically considered missed.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Increase weekly quota' }));
    await user.click(screen.getByRole('button', { name: 'Increase weekly quota' }));
    await user.click(screen.getByRole('button', { name: 'Increase weekly quota' }));
    await user.click(screen.getByRole('button', { name: 'Decrease weekly quota' }));
    await user.click(screen.getByRole('button', { name: 'Decrease weekly quota' }));
    expect(within(view).getByText('3 / week')).toBeTruthy();
    expect(within(view).getByText('The week is on target after 3 completions.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Decrease weekly quota' }));
    await user.click(screen.getByRole('button', { name: 'Decrease weekly quota' }));
    expect(within(view).getByText('1 / week')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decrease weekly quota' }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Schedule' })).getByText('1x a week')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Weekly quota Target completions per week' }));
    expect(screen.getByLabelText('Weekly quota: 1 completions per week')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Weekly quota habit');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { type: 'weekly_quota', timesPerWeek: 1 }
    }));
  });

  it('bounds the monthly quota counter and reflects target summaries before save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Monthly quota Target completions per month' }));
    const view = screen.getByTestId('monthly-quota-view');

    expect(within(view).getByText('3 / month')).toBeTruthy(); expect(within(view).getByText('Flexible timing')).toBeTruthy();
    expect(within(view).getByText('Progress is measured against the monthly quota rather than calendar-day attendance.')).toBeTruthy();

    for (let step = 0; step < 30; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Increase monthly quota' }));
    }
    expect(within(view).getByText('31 / month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase monthly quota' }).hasAttribute('disabled')).toBe(true);
    for (let step = 0; step < 30; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Decrease monthly quota' }));
    }
    expect(within(view).getByText('1 / month')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Decrease monthly quota' }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Schedule' })).getByText('1x a month')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Monthly quota Target completions per month' }));
    expect(screen.getByLabelText('Monthly quota: 1 completions per month')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Monthly quota habit');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { type: 'monthly_quota', timesPerMonth: 1 }
    }));
  }, 15_000);

  it('preserves advanced monthly-week schedules on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'edit', habit: createHabit({ id: 'habit-42', frequency: 'daily', schedule: { type: 'monthly_weeks', weeksOfMonth: [1, 'last'], weekdays: [1, 5] }, reminderTime: '08:30', reminderEnabled: true }), allHabits: [createHabit({ id: 'habit-42' })], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getAllByRole('button', { name: 'Save habit' }).at(-1)!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      frequency: 'custom',
      customDays: [1, 5],
      schedule: { type: 'monthly_weeks', weeksOfMonth: [1, 'last'], weekdays: [1, 5] },
      reminderTime: '08:30',
      reminderEnabled: true
    }));
  });

  it('sets, disables, and clears the reminder time with truthful copy and null payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'edit', habit: createHabit({ id: 'habit-7', reminderTime: '08:30', reminderEnabled: true }), allHabits: [createHabit({ id: 'habit-7' })], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Reminder' }));
    const panel = screen.getByTestId('habit-reminder-panel'); expect(within(panel).getByText('Daily at 08:30')).toBeTruthy();
    expect(within(panel).getByText('Reminder currently enabled')).toBeTruthy();
    expect(within(panel).getByText(/Enable notifications in app or system settings/)).toBeTruthy();
    const summary = within(panel).getByTestId('habit-reminder-summary'); const notice = within(panel).getByTestId('habit-reminder-notice'); expect(summary.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(within(summary).getByRole('button', { name: 'Reminders enabled' }).getAttribute('aria-pressed')).toBe('true');
    // Toggle off: state summary flips truthfully.
    await user.click(screen.getByRole('button', { name: 'Reminders enabled' }));
    expect(within(panel).getByText('Reminder currently disabled')).toBeTruthy(); expect(within(panel).getByText(/Notifications are disabled/)).toBeTruthy();
    expect(within(summary).getByRole('button', { name: 'Reminders disabled' }).getAttribute('aria-pressed')).toBe('false');
    // Clear the time: null submission per the existing contract.
    const timeInput = screen.getByLabelText('Reminder time') as HTMLInputElement;
    await user.clear(timeInput);
    expect(within(panel).getByText('No reminder time configured')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Reminder' })).getByText('Reminders disabled')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole('button', { name: 'Save habit' }).at(-1)!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reminderTime: null, reminderEnabled: false }));
  });

  it('selects month weeks with the combined rule and validates both groups independently', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Monthly weeks Choose weeks of month' }));
    const view = screen.getByTestId('monthly-weeks-view');

    expect(within(view).getByText('Schedule Monday, Tuesday, Wednesday, Thursday and Friday during week 1 of each month.')).toBeTruthy(); expect(within(view).getByText('If a month has a 5th week, it is ignored unless selected.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Toggle last week of the month' }));
    for (const dayName of ['Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await user.click(screen.getByLabelText(`Toggle ${dayName} in the selected weeks`));
    }
    expect(within(view).getByText('Schedule Monday during week 1 and the last week of each month.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Toggle Monday in the selected weeks' }));
    expect(within(view).getByText('Select at least one weekday inside the selected weeks.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' })); await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
    await user.type(screen.getByLabelText('Name *'), 'Month weeks habit');
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => {
      expect(screen.getByText('Select at least one weekday')).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    await user.click(screen.getByRole('button', { name: 'Edit Schedule' }));
    await user.click(screen.getByRole('button', { name: 'Monthly weeks Choose weeks of month' }));
    await user.click(screen.getByRole('button', { name: 'Toggle Monday in the selected weeks' }));
    expect(within(screen.getByTestId('monthly-weeks-view')).getByText('Schedule Monday during week 1 and the last week of each month.')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { type: 'monthly_weeks', weeksOfMonth: [1, 'last'], weekdays: [1] },
      frequency: 'custom',
      customDays: [1]
    }));
  });

  it('synchronizes goal range and number controls and renders the resulting rule', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(HabitForm, { props: { mode: 'edit', habit: createHabit(), allHabits: [createHabit()], onBack: vi.fn(), onSubmit } });

    await user.click(screen.getByRole('button', { name: 'Edit Goal' }));
    const rule = screen.getByTestId('habit-goal-rule-card');
    expect(screen.getByText('1 completed repetition = scheduled day complete.')).toBeTruthy();
    expect(within(rule).getByText('Streak milestone: 21 days.')).toBeTruthy();

    const dailyNumber = screen.getByLabelText('Daily target value') as HTMLInputElement;
    const streakNumber = screen.getByLabelText('Target streak value') as HTMLInputElement;
    await user.clear(dailyNumber);
    await user.type(dailyNumber, '3');
    await user.clear(streakNumber);
    await user.type(streakNumber, '60');
    expect(within(screen.getByTestId('habit-goal-panel')).getByText('3× / day')).toBeTruthy();
    expect(within(screen.getByTestId('habit-goal-panel')).getByText('3 done')).toBeTruthy();
    expect(within(rule).getByText('3 completed repetitions = scheduled day complete.')).toBeTruthy();
    expect(within(rule).getByText('Streak milestone: 60 days.')).toBeTruthy();

    expect((screen.getByRole('slider', { name: 'Daily target' }) as HTMLInputElement).value).toBe('3');
    expect((screen.getByRole('slider', { name: 'Target streak' }) as HTMLInputElement).value).toBe('60');

    await user.clear(streakNumber);
    await user.type(streakNumber, '999');
    expect(within(rule).getByText('Streak milestone: 365 days.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to habit editor dashboard' }));
    expect(within(screen.getByRole('button', { name: 'Edit Goal' })).getByText('3x/day, streak 365 days')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Save habit' }).at(-1)!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ dailyTarget: 3, targetStreak: 365 }));
  });

  describe('emoji handling', () => {
    it('accepts a simple emoji as custom icon', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

      await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
      const customIconInput = screen.getByLabelText('Custom habit icon') as HTMLInputElement;
      await user.type(customIconInput, '🎯');

      await user.type(screen.getByLabelText('Name *'), 'Test Habit');
      await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);

      await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });

      const submittedIcon = onSubmit.mock.calls[0][0].icon;
      expect(submittedIcon).toBeTruthy();
      expect(typeof submittedIcon).toBe('string');
    });

    it('accepts a compound emoji (writing hand with variation selector) as custom icon', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

      await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
      const customIconInput = screen.getByLabelText('Custom habit icon') as HTMLInputElement;
      await user.type(customIconInput, '📝');

      await user.type(screen.getByLabelText('Name *'), 'Writing Habit');
      await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);

      await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });

      const submittedIcon = onSubmit.mock.calls[0][0].icon;
      expect(submittedIcon).toBeTruthy();
      expect(typeof submittedIcon).toBe('string');
    });

    it('accepts a flag emoji (regional indicator pair) as custom icon', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

      await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
      const customIconInput = screen.getByLabelText('Custom habit icon') as HTMLInputElement;
      await user.type(customIconInput, '🇺🇸');

      expect(customIconInput.value).toBe('🇺🇸');

      await user.type(screen.getByLabelText('Name *'), 'USA Habit');
      await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);

      await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        icon: '🇺🇸'
      }));
    });

    it('replaces icon when a preset icon is clicked after typing a custom one', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      render(HabitForm, { props: { mode: 'create', allHabits: [], onBack: vi.fn(), onSubmit } });

      await user.click(screen.getByRole('button', { name: 'Edit Identity' }));
      const customIconInput = screen.getByLabelText('Custom habit icon') as HTMLInputElement;
      await user.type(customIconInput, '🎯');

      await user.click(screen.getByRole('button', { name: 'Use ⚡ as habit icon' }));

      expect(customIconInput.value).toBe('');

      await user.type(screen.getByLabelText('Name *'), 'Test Habit');
      await user.click(screen.getAllByRole('button', { name: 'Create habit' }).at(-1)!);

      await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1); });

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        icon: '⚡'
      }));
    });
  }); });
