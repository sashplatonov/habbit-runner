<script lang="ts">
  import { resolve } from '$app/paths';
  import { AlertCircle, CheckCircle2, Info } from 'lucide-svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
  import ProgressHistory from '$lib/components/stats/ProgressHistory.svelte';
  import ProgressHabitRow from '$lib/components/stats/ProgressHabitRow.svelte';
  import StatsInfoTooltip from '$lib/components/stats/StatsInfoTooltip.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import Surface from '$lib/components/ui/Surface.svelte';
  import { getAppRuntime } from '$lib/app/runtime';
  import { buildModernStatsSnapshot, type StatsWindowId } from '$lib/stats/modernStats';
  import { themeStore } from '$lib/stores/theme';

  const runtime = getAppRuntime();
  const habitsStore = runtime.habitsStore;
  const appResolve = runtime.resolve;

  const windowOptions = [
    { id: '1w', label: 'This week' },
    { id: '4w', label: '4 weeks' },
    { id: '12w', label: '12 weeks' }
  ] as const;

  let windowId = $state<StatsWindowId>('1w');
  let restoredPeriod = $state(false);

  $effect(() => {
    if ($themeStore.serverSyncReady && !restoredPeriod) {
      windowId = $themeStore.workspace.progress.period;
      restoredPeriod = true;
    }
  });

  const activeHabits = $derived($habitsStore.allHabits.filter((habit) => !habit.archived));
  const snapshot = $derived.by(() => buildModernStatsSnapshot(activeHabits, windowId));
  const emptyState = $derived(activeHabits.length === 0);
  const summaryRate = $derived(snapshot.summary.completionRate);
  const currentWeekRate = $derived.by(() => {
    const completed = snapshot.currentWeek.reduce((sum, day) => sum + day.completedDays, 0);
    const scheduled = snapshot.currentWeek.reduce((sum, day) => sum + day.scheduledDays, 0);
    return scheduled > 0 ? Math.round((completed / scheduled) * 100) : null;
  });
  const deltaLabel = $derived(
    snapshot.summary.delta === null
      ? 'Unavailable'
      : `${snapshot.summary.delta > 0 ? '+' : ''}${snapshot.summary.delta} pp`
  );
</script>

<svelte:head>
  <title>Progress - Habit Runner</title>
</svelte:head>

{#if emptyState}
  <div class="px-4 py-10 sm:px-6">
    <EmptyState
      title="No progress data yet"
      description="Add a habit and complete scheduled opportunities. Progress will appear here once scheduled history is available."
    >
      {#snippet icon()}
        <Info size={34} />
      {/snippet}
      {#snippet action()}
        <a
          class="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          href={resolve(appResolve('/app/(protected)/habit/new', {}), {})}
        >
          Add habit
        </a>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="overflow-x-clip px-4 py-3 sm:px-6 sm:py-5 lg:px-8">
    <div class="mx-auto flex max-w-3xl flex-col gap-3 sm:gap-4">
      <header class="flex flex-col gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold tracking-tight text-foreground">Progress</h1>
          <p class="mt-0.5 text-xs text-muted">See what is working and what is slipping</p>
        </div>
        <SegmentedControl
          options={windowOptions}
          value={windowId}
          ariaLabel="Progress period"
          class="w-full justify-between"
          onChange={(next) => {
            windowId = next as StatsWindowId;
            void themeStore.setProgressPeriod(windowId);
          }}
        />
      </header>

      <Surface as="section" padding="md" class="p-4 sm:p-5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <p id="progress-summary-title" class="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted">{snapshot.windowLabel}</p>
              <StatsInfoTooltip label="This week" content="Habits ranked as weak, declining, or repeatedly missed inside this period." />
            </div>
          </div>
          <span class="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
            {snapshot.summary.delta !== null && snapshot.summary.delta > 0 ? '↗ Improving' : snapshot.summary.delta !== null && snapshot.summary.delta < 0 ? '↘ Slipping' : '→ Steady'}
          </span>
        </div>

        <div class="mt-3 grid grid-cols-[1fr_auto] items-end gap-4">
          <div>
            <div class="flex items-baseline gap-2">
              <p class="tabular-nums text-4xl font-semibold tracking-tight text-foreground">{summaryRate === null ? '—' : `${summaryRate}%`}</p>
              <span class={snapshot.summary.delta === null ? 'text-muted' : snapshot.summary.delta >= 0 ? 'text-accent' : 'text-danger'}>{deltaLabel}</span>
            </div>
            <p class="mt-0.5 text-xs text-muted">vs previous {windowId === '1w' ? 'week' : 'period'}</p>
          </div>
          <div class="text-right text-xs text-muted">
            <p class="tabular-nums text-lg font-semibold text-foreground">{snapshot.summary.completed}/{snapshot.summary.scheduled}</p>
            <p>completed</p>
          </div>
        </div>

        <div class="mt-3">
          <ProgressBar value={summaryRate ?? 0} />
        </div>

        <div class="mt-3 border-t border-border/70 pt-3">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span><strong class="font-semibold text-foreground">{activeHabits.length}</strong> habits</span>
            <StatsInfoTooltip label="Habits" content="Active habits included in the selected period." />
            <span><strong class="font-semibold text-foreground">{snapshot.needsAttention.length}</strong> attention</span>
            <StatsInfoTooltip label="Attention" content="Habits with low completion, a negative change, or a recent run of missed opportunities." />
            <span><strong class="font-semibold text-foreground">{snapshot.strong.length > 0 ? `${snapshot.strong[0].completionRate}%` : '—'}</strong> best</span>
            <StatsInfoTooltip label="Best" content="The highest completion rate among the strong habits in this period." align="end" />
          </div>
        </div>
      </Surface>

      <Surface as="section" padding="md" class="p-3 sm:p-4">
        <div class="flex items-start justify-between gap-3 px-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-attention/25 bg-attention/10 text-attention"><AlertCircle size={16} aria-hidden="true" /></span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h2 id="needs-attention-title" class="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Needs attention</h2>
                <StatsInfoTooltip label="Needs attention" content="Habits with low completion, a negative change, or a recent run of missed scheduled opportunities." />
              </div>
              <p class="text-xs text-muted">This week · one-line heatmap</p>
            </div>
          </div>
          <span class="pt-1 text-xs text-muted">risk ↓</span>
        </div>
        {#if snapshot.needsAttention.length > 0}
          <div class="mt-3 divide-y divide-border/60">
            {#each snapshot.needsAttention as model (model.id)}
              <ProgressHabitRow
                model={model}
                detailHref={appResolve('/app/(protected)/habit/[id]', { id: model.id })}
                section="Needs attention"
              />
            {/each}
          </div>
        {:else}
          <p class="mt-3 rounded-xl border border-border bg-bg-secondary px-3 py-3 text-sm text-muted">No habits currently meet the attention criteria.</p>
        {/if}
      </Surface>

      <Surface as="section" padding="md" class="p-3 sm:p-4">
        <div class="flex items-start justify-between gap-3 px-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent"><CheckCircle2 size={16} aria-hidden="true" /></span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h2 id="strong-title" class="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Strong</h2>
                <StatsInfoTooltip label="Strong" content="Habits with high completion, positive change, or evidence of recovery after missed opportunities." />
              </div>
              <p class="text-xs text-muted">This week · one-line heatmap</p>
            </div>
          </div>
          <span class="pt-1 text-xs text-muted">best first</span>
        </div>
        {#if snapshot.strong.length > 0}
          <div class="mt-3 divide-y divide-border/60">
            {#each snapshot.strong as model (model.id)}
              <ProgressHabitRow
                model={model}
                detailHref={appResolve('/app/(protected)/habit/[id]', { id: model.id })}
                section="Strong"
              />
            {/each}
          </div>
        {:else}
          <p class="mt-3 rounded-xl border border-border bg-bg-secondary px-3 py-3 text-sm text-muted">No habits currently meet the strong criteria.</p>
        {/if}
      </Surface>

      <ProgressHistory
        historyDays={snapshot.historyDays}
        currentWeek={snapshot.currentWeek}
        currentWeekRate={currentWeekRate}
      />
    </div>
  </div>
{/if}
