<script lang="ts">
  type ConfettiFn = typeof import('canvas-confetti');

  // canvas-confetti is browser-only. Load it lazily to avoid SSR import errors.
  let confetti: ConfettiFn | null = null;

  async function getConfetti() {
    if (confetti) {
      return confetti;
    }

    const mod = await import('canvas-confetti') as ConfettiFn & { default?: ConfettiFn };
    confetti = mod.default ?? mod;
    return confetti;
  }
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    GripVertical, SnowflakeIcon, Moon
  } from 'lucide-svelte';
  import DashboardToolbar from '$lib/components/dashboard/DashboardToolbar.svelte';
  import MiniHeatmap from '$lib/components/MiniHeatmap.svelte';
  import HabitStreakPill from '$lib/components/habits/HabitStreakPill.svelte';
  import HabitTile from '$lib/components/HabitTile.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import PageLoadingSpinner from '$lib/components/PageLoadingSpinner.svelte';
  import RemindersPanel from '$lib/components/RemindersPanel.svelte';
  import DescriptionTooltip from '$lib/components/DescriptionTooltip.svelte';
  import type { OnboardingTemplate } from '$lib/components/onboarding';
  import { readDashboardStateFromURL, updateDashboardURL } from '$lib/dashboard/urlState';
  import { formatAppDate } from '@/lib/i18n';
  import {
    calculateScheduledCompletionRate,
    calculateScheduledStreak,
    getScheduleStatusForDate,
    isMandatoryToday
  } from '$lib/habits/schedule';
  import { buildCelebrationParticles, getCelebrationLabel, type CelebrationParticle } from '$lib/habits/completionCelebration';
  import { formatDate } from '$lib/habits/habitStats';
  import { getAppRuntime } from '$lib/app/runtime';
  import { themeStore } from '$lib/stores/theme';
  import type { HabitsStore } from '$lib/stores/habits';
  import { getCurrentUserTimeZone } from '$lib/time/userTimezone';
  import { buildScheduledCompletionSummary } from '$lib/dashboard/scheduledCompletionSummary';
  import ScheduledCompletionSummary from '$lib/components/dashboard/ScheduledCompletionSummary.svelte';
  import { HABIT_COLOR_THEMES } from '$lib/theme/habit-colors';
  import { isPhaseTransition } from '$lib/habits/phases';
  import { computeTileHint } from '$lib/habits/tileHint';
  import { getDashboardMomentumStatus } from '$lib/habits/dashboardMomentumStatus';
  import { sortHabits } from '$lib/habits/dashboardSort';
  import type { Habit } from '@/types/habit';

  // ─── Types ────────────────────────────────────────────────────────────────────
  type DashboardFilter = 'pending' | 'all' | 'done' | 'archived';
  type SortMode = 'custom' | 'smart';
  type ViewDensity = 'comfortable' | 'compact';
  type DropHint = { habitId: string; position: 'above' | 'below' };
  type SwipeDirection = 'left' | 'right' | null;

  // ─── State ────────────────────────────────────────────────────────────────────
  const runtime = getAppRuntime();
  const habitsStore = runtime.habitsStore as unknown as HabitsStore;

  let addingTemplate   = $state<string | null>(null);
  // Initialize from the URL only until the authenticated workspace has hydrated.
  const urlState = readDashboardStateFromURL();
  let filter           = $state<DashboardFilter>(urlState.filter ?? 'pending');
  let searchQuery      = $state(urlState.search ?? '');
  let sortMode         = $state<SortMode>(urlState.sort ?? 'custom');
  let viewDensity      = $state<ViewDensity>(urlState.density ?? 'comfortable');
  let selectedTags     = $state<string[]>(urlState.tags ? urlState.tags.split(',') : []);
  let restoredFromWorkspace = $state(runtime.isDemo);
  let shouldAnimateListEntrance = $state(true);

  let animatingHabitId = $state<string | null>(null);
  let animParticles    = $state<CelebrationParticle[]>([]);
  let animLabel        = $state('');
  let particleCounter  = 0;

  let dragId     = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dropHint   = $state<DropHint | null>(null);

  let swipeOffset      = $state(0);
  let swipeDirection   = $state<SwipeDirection>(null);
  let isSwipingGesture = $state(false);
  let touchDragId      = $state<string | null>(null);

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeAxisLocked: boolean | null = null;
  let swipeTriggered = false;
  let touchDragGhost: HTMLDivElement | null = null;
  let touchDragOriginY = 0;
  let touchDragOriginTop = 0;

  $effect(() => {
    if (!$themeStore.serverSyncReady || restoredFromWorkspace) { return; }
    const workspace = $themeStore.workspace.dashboard;
    filter = urlState.filter ?? workspace.filter;
    searchQuery = urlState.search ?? workspace.searchQuery;
    sortMode = urlState.sort ?? workspace.sort;
    viewDensity = urlState.density ?? workspace.density;
    selectedTags = urlState.tags ? urlState.tags.split(',') : [...workspace.tags];
    restoredFromWorkspace = true;
    if (urlState.filter || urlState.search || urlState.tags || urlState.sort || urlState.density) {
      void themeStore.setDashboardWorkspace({ ...workspace, filter, searchQuery, tags: selectedTags, sort: sortMode, density: viewDensity });
    }
  });

  // ─── Sync to URL ────────────────────────────────────────────────────
  $effect(() => {
    if (!restoredFromWorkspace) { return; }
    updateDashboardURL({
      filter: filter === 'pending' ? undefined : filter,
      search: searchQuery || undefined,
      tags: selectedTags.length > 0 ? selectedTags.join(',') : undefined,
      sort: sortMode === 'custom' ? undefined : sortMode,
      density: viewDensity === 'comfortable' ? undefined : viewDensity
    });
  });

  // ─── Derived: dates ───────────────────────────────────────────────────────────
  const todayDate = $derived.by(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); });
  const todayKey  = $derived(formatDate(todayDate));
  const dateStr   = $derived(formatAppDate(todayDate, { weekday: 'long', month: 'short', day: 'numeric' }));

  function isHabitCompletedToday(habit: Habit, dateKey: string) {
    if (habit.type === 'negative') {
      return (habit.completions[dateKey] ?? 0) === 0;
    }
    return (habit.completions[dateKey] ?? 0) >= Math.max(1, habit.dailyTarget ?? 1);
  }

  // ─── Derived: habit lists ─────────────────────────────────────────────────────
  const activeHabits = $derived($habitsStore.habits);

  const timeZone = getCurrentUserTimeZone();

  const scheduledToday = $derived(activeHabits.filter((h) => isMandatoryToday(h, todayDate)));

  const pendingCount = $derived(
    scheduledToday.filter((h) => !isHabitCompletedToday(h, todayKey)).length
  );

  const scheduledCompletionSummary = $derived(
    buildScheduledCompletionSummary(activeHabits, new Date(), timeZone)
  );

  const allTags = $derived.by(() => {
    const seen: string[] = [];
    const tagSource = filter === 'archived' ? $habitsStore.allHabits.filter((h) => h.archived) : activeHabits;
    tagSource.forEach((h) => h.tags.forEach((t) => { if (!seen.includes(t)) { seen.push(t); } }));
    return seen.sort();
  });

  const filteredHabits = $derived.by(() => {
    let list: Habit[];
    if (filter === 'archived') {
      list = $habitsStore.allHabits.filter((h) => h.archived);
    } else {
      list = activeHabits.filter((h) => {
        if (filter === 'pending') {
          return !isHabitCompletedToday(h, todayKey);
        }
        if (filter === 'done') {
          return isHabitCompletedToday(h, todayKey);
        }
        return true;
      });
    }
    if (selectedTags.length > 0) {
      list = list.filter((h) => h.tags.some((t) => selectedTags.includes(t)));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (h) => h.name.toLowerCase().includes(q) || h.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => sortHabits(a, b, sortMode, todayDate));
  });

  const groupedHabits = $derived.by(() => {
    if (selectedTags.length === 0) {
      return [{ tag: null as string | null, habits: filteredHabits }];
    }
    return selectedTags
      .map((tag) => ({ tag, habits: filteredHabits.filter((h) => h.tags.includes(tag)) }))
      .filter((g) => g.habits.length > 0);
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function detectHorizontalSwipe(dx: number, dy: number): boolean | null {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      return true;
    }
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      return false;
    }
    return null;
  }

  function clampSwipeOffset(dx: number): number {
    return Math.max(-160, Math.min(160, dx));
  }

  function getDropPosition(clientY: number, element: HTMLElement): 'above' | 'below' {
    const bounds = element.getBoundingClientRect();
    return clientY < bounds.top + bounds.height / 2 ? 'above' : 'below';
  }

  function buildTouchGhost(row: HTMLElement): HTMLDivElement {
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLDivElement;
    Object.assign(ghost.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      pointerEvents: 'none',
      zIndex: '9999',
      opacity: '0.92',
      transform: 'scale(1.04) rotate(-0.8deg)',
      boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      transition: 'none',
      borderRadius: '0.75rem'
    });
    document.body.appendChild(ghost);
    return ghost;
  }

  function cleanupTouchDragGhost() {
    if (touchDragGhost) {
      touchDragGhost.remove();
      touchDragGhost = null;
    }
  }

  // ─── Increment with animation + confetti ──────────────────────────────────────
  const BURST_COLORS = ['#fff7ed', '#fbbf24', '#fde68a'];

  async function toggleHabit(habit: Habit) {
    const tgt = Math.max(1, habit.dailyTarget ?? 1);
    const accent = HABIT_COLOR_THEMES[habit.color];
    const previousStreak = calculateScheduledStreak(habit, habit.completions).current;
    const result = await habitsStore.incrementCompletionCount(habit.id, todayKey);
    const nextCount = result.count;
    const isMilestone = result.previousCount < tgt && nextCount >= tgt && isPhaseTransition(previousStreak + 1);

    animatingHabitId = habit.id;
    animLabel = getCelebrationLabel(nextCount, tgt);

    const burst = buildCelebrationParticles({
      startId: particleCounter,
      colors: [accent.hex, ...BURST_COLORS],
      count: 12,
      spread: 26,
      lift: 14
    });
    animParticles = burst.particles;
    particleCounter = burst.nextId;

    setTimeout(async () => {
      try {
        const launch = await getConfetti();
        if (isMilestone) {
          void launch({
            particleCount: 180,
            spread: 165,
            startVelocity: 42,
            origin: { y: 0.6 },
            colors: [accent.hex, '#fbbf24', '#fff7ed'],
            zIndex: 1000
          });
        } else {
          void launch({
            particleCount: 26,
            angle: 60,
            spread: 84,
            startVelocity: 30,
            origin: { x: 0.42, y: 0.74 },
            colors: [accent.hex, '#fff7ed', '#fbbf24'],
            scalar: 0.88,
            zIndex: 900
          });
          void launch({
            particleCount: 26,
            angle: 120,
            spread: 84,
            startVelocity: 30,
            origin: { x: 0.58, y: 0.74 },
            colors: [accent.hex, '#fff7ed', '#fbbf24'],
            scalar: 0.88,
            zIndex: 900
          });
        }
      } catch {
        // ignore errors from confetti (non-critical visual affordance)
      }
    }, 180);

    setTimeout(() => {
      animatingHabitId = null;
      animParticles = [];
      animLabel = '';
    }, 900);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────────
  function navigateToDetail(habitId: string) {
    void goto(resolve('/app/(protected)/habit/[id]', { id: habitId }));
  }

  function navigateToNewHabit() {
    void goto(resolve<'/app/(protected)/habit/new'>('/app/(protected)/habit/new', {}));
  }

  // ─── Drag-and-drop ────────────────────────────────────────────────────────────
  function isDragActive() {
    return sortMode === 'custom' && filter !== 'archived';
  }

  function onDragStart(e: DragEvent, habitId: string) {
    dragId = habitId;
    dropHint = null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', habitId);
    }
  }

  function onDragOver(e: DragEvent, habitId: string) {
    e.preventDefault();
    if (e.dataTransfer) { e.dataTransfer.dropEffect = 'move'; }
    if (habitId === dragId) { return; }

    dragOverId = habitId;
    const currentTarget = e.currentTarget as HTMLElement | null;
    const rect = currentTarget?.getBoundingClientRect();
    const position = rect && e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    dropHint = { habitId, position };
  }

  function onDragLeave(e: DragEvent) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    const nextTarget = e.relatedTarget as Node | null;
    if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) {
      return;
    }
    dragOverId = null;
    dropHint = null;
  }

  async function applyCustomReorder(sourceId: string, targetId: string, position: 'above' | 'below') {
    const fullItems = [...activeHabits].sort((a, b) => sortHabits(a, b, 'custom', todayDate));
    const visibleIds = new Set(filteredHabits.map((habit) => habit.id));
    const items = fullItems.filter((habit) => visibleIds.has(habit.id));
    const fromIdx = items.findIndex((habit) => habit.id === sourceId);
    const toIdx = items.findIndex((habit) => habit.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      return;
    }

    const [movedHabit] = items.splice(fromIdx, 1);
    let insertIdx = toIdx + (position === 'below' ? 1 : 0);
    if (fromIdx < insertIdx) {
      insertIdx -= 1;
    }
    insertIdx = Math.max(0, Math.min(items.length, insertIdx));
    items.splice(insertIdx, 0, movedHabit);

    let visibleIndex = 0;
    const reorderedHabits = fullItems.map((habit) => (visibleIds.has(habit.id) ? items[visibleIndex++] : habit));
    const base = Date.now();
    for (let i = 0; i < reorderedHabits.length; i++) {
      const newOrder = base + i * 1_000;
      if (reorderedHabits[i].sortOrder !== newOrder) {
        void habitsStore.updateHabit(reorderedHabits[i].id, { sortOrder: newOrder });
      }
    }
  }

  async function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const currentDropHint = dropHint;
    dragOverId = null;
    dropHint = null;
    if (!dragId || dragId === targetId) { dragId = null; return; }
    await applyCustomReorder(dragId, targetId, currentDropHint?.habitId === targetId ? currentDropHint.position : 'above');
    dragId = null;
  }

  function onDragEnd() { dragId = null; dragOverId = null; dropHint = null; }

  // ─── Tags ────────────────────────────────────────────────────────────────────
  function toggleTag(tag: string) {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter((t) => t !== tag);
    } else {
      selectedTags = [...selectedTags, tag];
    }
  }

  // ─── Swipe gestures (mobile) ─────────────────────────────────────────────────
  let swipeHabitId = $state('');

  function resetSwipeState() {
    swipeStartX = 0;
    swipeStartY = 0;
    swipeAxisLocked = null;
    swipeTriggered = false;
    swipeHabitId = '';
    swipeOffset = 0;
    swipeDirection = null;
    isSwipingGesture = false;
  }

  function onRowTouchStart(e: TouchEvent, habitId: string) {
    if (touchDragId || e.touches.length !== 1) { return; }
    swipeStartX  = e.touches[0]?.clientX ?? 0;
    swipeStartY  = e.touches[0]?.clientY ?? 0;
    swipeAxisLocked = null;
    swipeTriggered = false;
    swipeHabitId = habitId;
    swipeOffset = 0;
    swipeDirection = null;
    isSwipingGesture = false;
  }

  function onRowTouchMove(e: TouchEvent, habit: Habit) {
    if (touchDragId || swipeHabitId !== habit.id || e.touches.length !== 1) { return; }
    const dx = (e.touches[0]?.clientX ?? 0) - swipeStartX;
    const dy = (e.touches[0]?.clientY ?? 0) - swipeStartY;

    if (swipeAxisLocked === null) {
      const detected = detectHorizontalSwipe(dx, dy);
      if (detected === false) {
        resetSwipeState();
        return;
      }
      if (detected === null) {
        return;
      }
      swipeAxisLocked = detected;
    }

    if (!swipeAxisLocked) {
      return;
    }

    e.preventDefault();
    const clampedOffset = clampSwipeOffset(dx);
    swipeOffset = clampedOffset;
    swipeDirection = clampedOffset === 0 ? null : clampedOffset > 0 ? 'right' : 'left';
    isSwipingGesture = true;

    if (!swipeTriggered && Math.abs(clampedOffset) >= 60) {
      swipeTriggered = true;
      if (clampedOffset > 0) {
        if (getScheduleStatusForDate(habit, todayDate) !== 'frozen') {
          void toggleHabit(habit);
        }
      } else {
        navigateToDetail(habit.id);
      }
      setTimeout(() => {
        if (swipeHabitId === habit.id) {
          resetSwipeState();
        }
      }, 150);
    }
  }

  function onRowTouchEnd() {
    if (touchDragId) {
      return;
    }
    if (!swipeTriggered) {
      resetSwipeState();
    }
  }

  function onGripTouchStart(e: TouchEvent, habitId: string) {
    if (!isDragActive()) { return; }
    e.preventDefault();
    e.stopPropagation();
    const row = (e.currentTarget as HTMLElement | null)?.closest('[data-habit-id]') as HTMLElement | null;
    const touch = e.touches[0];
    if (!row || !touch) { return; }

    touchDragId = habitId;
    dragId = habitId;
    dragOverId = null;
    dropHint = null;
    touchDragOriginY = touch.clientY;
    touchDragOriginTop = row.getBoundingClientRect().top;
    cleanupTouchDragGhost();
    touchDragGhost = buildTouchGhost(row);
  }

  $effect(() => {
    if (!touchDragId || typeof document === 'undefined') {
      return;
    }

    function onTouchDragMove(e: TouchEvent) {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) { return; }

      if (touchDragGhost) {
        const delta = touch.clientY - touchDragOriginY;
        touchDragGhost.style.top = `${touchDragOriginTop + delta}px`;
      }

      if (touchDragGhost) {
        touchDragGhost.style.visibility = 'hidden';
      }
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      if (touchDragGhost) {
        touchDragGhost.style.visibility = '';
      }

      const row = element?.closest('[data-habit-id]');
      if (row) {
        const targetId = row.getAttribute('data-habit-id');
        if (targetId && targetId !== touchDragId) {
          const position = getDropPosition(touch.clientY, row as HTMLElement);
          dropHint = { habitId: targetId, position };
          dragOverId = targetId;
          return;
        }
      }

      dropHint = null;
      dragOverId = null;
    }

    async function onTouchDragEnd() {
      cleanupTouchDragGhost();
      const draggedId = touchDragId;
      const hint = dropHint;

      touchDragId = null;
      dragId = null;
      dragOverId = null;
      dropHint = null;

      if (!draggedId || !hint) {
        return;
      }

      await applyCustomReorder(draggedId, hint.habitId, hint.position);
    }

    document.addEventListener('touchmove', onTouchDragMove, { passive: false });
    document.addEventListener('touchend', onTouchDragEnd);
    document.addEventListener('touchcancel', onTouchDragEnd);

    return () => {
      document.removeEventListener('touchmove', onTouchDragMove);
      document.removeEventListener('touchend', onTouchDragEnd);
      document.removeEventListener('touchcancel', onTouchDragEnd);
      cleanupTouchDragGhost();
    };
  });

  // ─── Onboarding ───────────────────────────────────────────────────────────────
  async function handleTemplateSelect(template: OnboardingTemplate) {
    addingTemplate = template.name;
    try {
      const allHabits = $habitsStore.allHabits;
      const sortOrder =
        allHabits.length > 0
          ? Math.max(...allHabits.map((h) => h.sortOrder ?? 0)) + 1
          : 0;
      const habitId = await habitsStore.addHabit({
        name: template.name,
        description: template.description,
        icon: template.icon,
        color: template.color,
        tags: template.tags,
        frequency: template.frequency,
        customDays: template.customDays,
        targetStreak: template.targetStreak,
        dailyTarget: 1,
        type: 'positive',
        freezeDays: [],
        archived: false,
        sortOrder
      });
      await goto(resolve('/app/(protected)/habit/[id]', { id: habitId }));
    } finally {
      addingTemplate = null;
    }
  }
</script>

<svelte:head>
  <title>Dashboard - Habbit Runner</title>
</svelte:head>

{#if !$habitsStore.hasHydrated}
  <div class="min-h-screen bg-transparent">
    <PageLoadingSpinner label="Loading habits…" />
  </div>
{:else if $habitsStore.habits.length === 0}
  <Onboarding onCreateCustom={navigateToNewHabit} onTemplateSelect={handleTemplateSelect} activeTemplate={addingTemplate} />
{:else}
  <div class="min-h-screen bg-transparent">

    <ScheduledCompletionSummary
      summary={scheduledCompletionSummary}
      dateLabel={dateStr}
    />

    <!-- ═══════════ CONTROLS BAR (sticky) ════════════════════════════════════ -->
    <div class="sticky top-0 z-[70]">
      <DashboardToolbar
        {filter}
        {searchQuery}
        {sortMode}
        {viewDensity}
        {pendingCount}
        activeTags={selectedTags}
        availableTags={allTags}
        onFilterChange={(nextFilter) => {
          // Filters should reveal matching habits immediately, without replaying
          // the staggered entrance animation for newly visible cards.
          shouldAnimateListEntrance = false;
          filter = nextFilter;
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, filter: nextFilter });
        }}
        onSearchChange={(nextQuery) => {
          searchQuery = nextQuery;
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, searchQuery: nextQuery });
        }}
        onClearSearch={() => {
          searchQuery = '';
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, searchQuery: '' });
        }}
        onSortChange={(nextSortMode) => {
          sortMode = nextSortMode;
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, sort: nextSortMode });
        }}
        onDensityChange={(nextDensity) => {
          viewDensity = nextDensity;
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, density: nextDensity });
        }}
        onToggleTag={(tag) => {
          toggleTag(tag);
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, tags: selectedTags });
        }}
        onClearTags={() => {
          selectedTags = [];
          void themeStore.setDashboardWorkspace({ ...$themeStore.workspace.dashboard, tags: [] });
        }}
        onAddHabit={navigateToNewHabit}
      />
    </div>

    <!-- Reminders panel -->
    <RemindersPanel />

    <!-- ═══════════ HABIT LIST ════════════════════════════════════════════════ -->
    <div class="mx-auto max-w-5xl px-4 py-4 sm:px-6">
      {#if filteredHabits.length === 0}
        <div class="rounded-[1.75rem] border border-border bg-bg-secondary/88 py-16 text-center text-muted shadow-[0_20px_54px_rgba(15,23,42,0.08)]">
          <p class="text-4xl mb-3">
            {filter === 'pending' ? '🎉' : filter === 'done' ? '✨' : filter === 'archived' ? '🗂️' : '👋'}
          </p>
          <p class="text-lg font-semibold text-foreground">
            {filter === 'pending' ? 'All done for today!' : filter === 'done' ? 'No completed habits yet' : filter === 'archived' ? 'No archived habits' : searchQuery ? 'No habits match your search' : 'No habits found'}
          </p>
          <button
            type="button"
            onclick={navigateToNewHabit}
            class="mt-4 rounded-2xl bg-accent px-5 py-2 text-sm font-semibold uppercase tracking-widest text-bg-primary transition hover:opacity-90"
          >Add a habit</button>
        </div>

      {:else if viewDensity === 'comfortable'}
        <div
          class={`${selectedTags.length === 0 ? 'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]' : ''}`}
          role="list"
          aria-label="Habit list"
        >
          {#if selectedTags.length === 0}
            {#each filteredHabits as habit, idx (habit.id)}
              <HabitTile
                {habit}
                {todayKey}
                {todayDate}
                appearanceIndex={idx}
                animateOnMount={shouldAnimateListEntrance}
                onToggle={() => void toggleHabit(habit)}
                onDetail={() => navigateToDetail(habit.id)}
              />
            {/each}
          {:else}
            {#each groupedHabits as group (group.tag ?? 'all')}
              {#if group.tag}
                <div class="col-span-full">
                  <div class="mt-2 flex items-center gap-2 px-1 first:mt-0">
                    <span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
                    <h3 class="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">{group.tag}</h3>
                  </div>
                  <div class="mt-3 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
                    {#each group.habits as habit, idx (habit.id)}
                      <HabitTile
                        {habit}
                        {todayKey}
                        {todayDate}
                        appearanceIndex={idx}
                        animateOnMount={shouldAnimateListEntrance}
                        onToggle={() => void toggleHabit(habit)}
                        onDetail={() => navigateToDetail(habit.id)}
                      />
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>

      {:else}
        <div class="mx-auto flex w-full max-w-5xl flex-col" style="gap: 0.5rem;" role="list" aria-label="Habit list">
          {#if selectedTags.length === 0}
            <ul class="space-y-1" role="list">
              {#each filteredHabits as habit, idx (habit.id)}
                {@const accent = HABIT_COLOR_THEMES[habit.color]}
                {@const tgt = Math.max(1, habit.dailyTarget ?? 1)}
                {@const todayCount = habit.completions[todayKey] ?? 0}
                {@const completed = todayCount >= tgt}
                {@const status = getScheduleStatusForDate(habit, todayDate)}
                {@const isFrozen = status === 'frozen'}
                {@const isScheduled = isMandatoryToday(habit, todayDate)}
                {@const streak = calculateScheduledStreak(habit, habit.completions).current}
                {@const momentum = getDashboardMomentumStatus(habit, todayDate)}
                {@const completionRate = calculateScheduledCompletionRate(habit, habit.completions)}
                {@const hint = computeTileHint(habit, completionRate, streak)}
                {@const isAnimating = animatingHabitId === habit.id}
                {@const dropHintPosition = dropHint?.habitId === habit.id ? dropHint.position : null}
                {@const showDropAbove = dropHintPosition === 'above'}
                {@const showDropBelow = dropHintPosition === 'below'}
                {@const dropTransformClass = dropHintPosition === 'above' ? '-translate-y-2' : dropHintPosition === 'below' ? 'translate-y-2' : ''}
                {@const isSwipeRow = swipeHabitId === habit.id}
                {@const indicatorOpacity = isSwipeRow ? Math.min(1, Math.abs(swipeOffset) / 120) : 0}
                {@const indicatorColor = swipeDirection === 'right' ? 'rgba(16, 185, 129, 0.25)' : swipeDirection === 'left' ? 'rgba(59, 130, 246, 0.25)' : 'transparent'}
                {@const inlineTags = habit.tags.slice(0, 3)}
                {@const extraTagCount = Math.max(0, habit.tags.length - inlineTags.length)}
                <li
                  data-habit-id={habit.id}
                  role="listitem"
                  class="group relative transition-all duration-200 {shouldAnimateListEntrance ? 'animate-fade-slide-up' : ''}
                    {dragId && dragId !== habit.id ? 'opacity-50 scale-[0.97]' : ''}
                    {dragId === habit.id ? 'ring-2 ring-accent/40 rounded-2xl' : ''}
                    {dropTransformClass}"
                  style:animation-delay={shouldAnimateListEntrance ? `${Math.min(idx, 12) * 0.05}s` : undefined}
                  draggable={isDragActive()}
                  ondragstart={(e) => isDragActive() && onDragStart(e, habit.id)}
                  ondragover={(e) => isDragActive() && onDragOver(e, habit.id)}
                  ondragleave={(e) => isDragActive() && onDragLeave(e)}
                  ondrop={(e) => isDragActive() && void onDrop(e, habit.id)}
                  ondragend={() => isDragActive() && onDragEnd()}
                  ontouchstart={(e) => onRowTouchStart(e, habit.id)}
                  ontouchmove={(e) => onRowTouchMove(e, habit)}
                  ontouchend={onRowTouchEnd}
                  ontouchcancel={onRowTouchEnd}
                >
                  {#if showDropAbove}
                    <div class="absolute -top-1 inset-x-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-progress-glow z-10 pointer-events-none"></div>
                  {/if}
                  {#if showDropBelow}
                    <div class="absolute -bottom-1 inset-x-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-progress-glow z-10 pointer-events-none"></div>
                  {/if}

                  <div
                    class="habit-card-inner flex flex-col rounded-2xl border bg-bg-card px-3 py-2.5 transition-all duration-150 cursor-pointer overflow-hidden
                      {dragOverId === habit.id ? 'border-accent/50' : 'border-border hover:border-border-hover'}
                      {isFrozen ? 'opacity-75' : ''}"
                    role="button"
                    tabindex="0"
                    aria-label="{habit.name}, {completed ? 'completed' : 'not completed'}"
                    style:transform={isSwipeRow ? `translateX(${swipeOffset}px)` : 'translateX(0px)'}
                    style:transition={isSwipeRow && isSwipingGesture ? 'none' : 'transform 0.2s ease-out'}
                    style:touch-action="pan-y"
                    style:will-change="transform"
                    style:width="100%"
                    onclick={() => navigateToDetail(habit.id)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); navigateToDetail(habit.id); }
                      else if (e.key === ' ') { e.preventDefault(); void toggleHabit(habit); }
                    }}
                  >
                    <span class="absolute inset-y-0 left-0 w-1 rounded-l-2xl pointer-events-none" style:background={accent.hex}></span>
                    <span
                      class="habit-card-swipe-indicator"
                      style:opacity={indicatorOpacity}
                      style:background-color={indicatorColor}
                    ></span>

                    <div class="relative z-10 flex w-full min-w-0 items-start gap-3">
                      {#if isDragActive()}
                        <button
                          type="button"
                          class="flex-shrink-0 cursor-grab active:cursor-grabbing text-border/60 hover:text-muted transition-colors touch-none"
                          aria-label="Reorder {habit.name}"
                          onclick={(e) => { e.stopPropagation(); }}
                          ontouchstart={(e) => onGripTouchStart(e, habit.id)}
                        >
                          <GripVertical size={14} />
                        </button>
                      {/if}

                      <div class="relative flex-shrink-0">
                        {#if isAnimating}
                          {#each animParticles as p (p.id)}
                            <span
                              class="completion-burst-particle"
                              style="--tx: {p.tx}px; --ty: {p.ty}px; --particle-size: {p.size}px; --particle-rotate: {p.rotation}deg; --particle-delay: {p.delay}ms; --particle-duration: {p.duration}ms; --particle-color: {p.color}; background: {p.color}; border-radius: {p.radius}; left: 50%; top: 50%; margin-left: calc({p.size}px / -2); margin-top: calc({p.size}px / -2);"
                            ></span>
                          {/each}
                          <span class="completion-status-pop" style="color: {accent.hex}">{animLabel}</span>
                        {/if}
                        <button
                          type="button"
                          aria-label="{completed ? 'Undo' : 'Complete'} {habit.name}"
                          onclick={(e) => { e.stopPropagation(); void toggleHabit(habit); }}
                          disabled={isFrozen}
                          class="relative flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] transition-all duration-200 overflow-hidden
                            {completed ? `${accent.bgClass} ${accent.borderClass}` : isScheduled ? 'border-border-hover hover:border-muted' : isFrozen ? 'border-border bg-bg-secondary text-muted cursor-not-allowed opacity-60' : 'border border-dashed border-border text-muted hover:border-muted'}
                            {isAnimating ? 'animate-check-pulse animate-glow-burst' : ''}"
                          style={completed && !isFrozen ? `box-shadow: 0 0 12px ${accent.glow}` : ''}
                        >
                          {#if isAnimating}
                            <span class="completion-sheen" style="--sheen-color: {accent.hex}"></span>
                          {/if}
                          {#if tgt > 1}
                            {@const prog = Math.min(Math.max(todayCount, 0), tgt) / tgt}
                            <span class="absolute inset-[2px] rounded-full pointer-events-none overflow-hidden" aria-hidden="true">
                              <span
                                class="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                                style="width: {prog * 100}%; background: linear-gradient(90deg, {accent.hex}55, {accent.hex});"
                              ></span>
                            </span>
                          {/if}
                          {#if isFrozen}
                            <SnowflakeIcon size={13} class="text-muted z-10 relative" />
                          {:else if tgt > 1}
                            <span class="text-[10px] font-mono z-10 relative" style="color: {accent.hex}">{todayCount}/{tgt}</span>
                          {:else if completed}
                            <svg viewBox="0 0 12 12" class="h-4 w-4 z-10 relative {accent.textClass}">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                          {/if}
                        </button>
                      </div>

                      <div class="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <span class="flex-shrink-0 text-xl leading-none">{habit.icon}</span>
                        <div class="min-w-0 flex-1">
                          <div class="min-h-8">
                            <p class="line-clamp-2 text-[13px] font-semibold leading-4 text-foreground sm:truncate sm:text-sm sm:leading-tight {completed ? 'opacity-60 line-through' : ''}" data-habit-title>{habit.name}</p>
                            {#if tgt > 1}
                              <span class="hidden rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary sm:inline-flex">×{tgt}</span>
                            {/if}
                            {#if inlineTags.length > 0}
                              <div class="hidden items-center gap-1 sm:flex">
                                {#each inlineTags as tag, ti (tag + '-' + ti)}
                                  <span class="whitespace-nowrap rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary">#{tag}</span>
                                {/each}
                                {#if extraTagCount > 0}
                                  <span class="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary">+{extraTagCount}</span>
                                {/if}
                              </div>
                            {/if}
                          </div>

                          {#if isFrozen}
                            <span class="hidden items-center gap-0.5 text-[10px] font-mono text-muted sm:inline-flex">
                              <SnowflakeIcon size={8} /> Frozen
                            </span>
                          {:else if !isScheduled}
                            <span class="hidden items-center gap-0.5 text-[10px] font-mono text-muted sm:inline-flex">
                              <Moon size={8} /> Not today
                            </span>
                          {/if}

                          {#if hint}
                            {@const hc = hint.type === 'good' ? 'text-accent' : hint.type === 'warn' ? 'text-accent-secondary' : 'text-muted'}
                            <p class="mt-0.5 hidden truncate text-[10px] font-mono sm:block {hc}">{hint.text}</p>
                          {/if}
                        </div>
                      </div>

                      {#if habit.description}
                        <span class="shrink-0"><DescriptionTooltip description={habit.description} triggerClassName="!size-8 !min-h-8 !min-w-8 !rounded-lg sm:!size-11 sm:!min-h-11 sm:!min-w-11 sm:!rounded-[1rem]" /></span>
                      {/if}
                    </div>
                    <div class="relative z-10 mt-2 flex w-full min-w-0 items-center gap-2 border-t border-border/40 pt-2">
                      <HabitStreakPill {streak} missedScheduledDays={momentum.inactiveScheduledDays} />
                      <div class="min-w-0 flex-1" role="img" aria-label="Habit activity for the last 30 days, from 30 days ago through today">
                        <MiniHeatmap completions={habit.completions} dailyTarget={tgt} color={habit.color} />
                      </div>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          {:else}
            {#each groupedHabits as group (group.tag ?? 'all')}
              {#if group.tag}
                <div class="mb-3 space-y-1">
                  <div class="flex items-center gap-2 px-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-accent"></span>
                    <h3 class="text-[10px] font-mono font-bold uppercase tracking-widest text-muted">{group.tag}</h3>
                  </div>
                  <ul class="space-y-1" role="list">
                    {#each group.habits as habit, idx (habit.id)}
              {@const accent = HABIT_COLOR_THEMES[habit.color]}
              {@const tgt = Math.max(1, habit.dailyTarget ?? 1)}
              {@const todayCount = habit.completions[todayKey] ?? 0}
              {@const completed = todayCount >= tgt}
              {@const status = getScheduleStatusForDate(habit, todayDate)}
              {@const isFrozen = status === 'frozen'}
              {@const isScheduled = isMandatoryToday(habit, todayDate)}
              {@const streak = calculateScheduledStreak(habit, habit.completions).current}
              {@const momentum = getDashboardMomentumStatus(habit, todayDate)}
              {@const completionRate = calculateScheduledCompletionRate(habit, habit.completions)}
              {@const hint = computeTileHint(habit, completionRate, streak)}
              {@const isAnimating = animatingHabitId === habit.id}
              {@const dropHintPosition = dropHint?.habitId === habit.id ? dropHint.position : null}
              {@const showDropAbove = dropHintPosition === 'above'}
              {@const showDropBelow = dropHintPosition === 'below'}
              {@const dropTransformClass = dropHintPosition === 'above' ? '-translate-y-2' : dropHintPosition === 'below' ? 'translate-y-2' : ''}
              {@const isSwipeRow = swipeHabitId === habit.id}
              {@const indicatorOpacity = isSwipeRow ? Math.min(1, Math.abs(swipeOffset) / 120) : 0}
              {@const indicatorColor = swipeDirection === 'right' ? 'rgba(16, 185, 129, 0.25)' : swipeDirection === 'left' ? 'rgba(59, 130, 246, 0.25)' : 'transparent'}
              {@const inlineTags = habit.tags.slice(0, 3)}
              {@const extraTagCount = Math.max(0, habit.tags.length - inlineTags.length)}
              <li
                data-habit-id={habit.id}
                role="listitem"
                class="group relative transition-all duration-200 {shouldAnimateListEntrance ? 'animate-fade-slide-up' : ''}
                  {dragId && dragId !== habit.id ? 'opacity-50 scale-[0.97]' : ''}
                  {dragId === habit.id ? 'ring-2 ring-accent/40 rounded-2xl' : ''}
                  {dropTransformClass}"
                style:animation-delay={shouldAnimateListEntrance ? `${Math.min(idx, 12) * 0.05}s` : undefined}
                draggable={isDragActive()}
                ondragstart={(e) => isDragActive() && onDragStart(e, habit.id)}
                ondragover={(e) => isDragActive() && onDragOver(e, habit.id)}
                ondragleave={(e) => isDragActive() && onDragLeave(e)}
                ondrop={(e) => isDragActive() && void onDrop(e, habit.id)}
                ondragend={() => isDragActive() && onDragEnd()}
                ontouchstart={(e) => onRowTouchStart(e, habit.id)}
                ontouchmove={(e) => onRowTouchMove(e, habit)}
                ontouchend={onRowTouchEnd}
                ontouchcancel={onRowTouchEnd}
              >
                <!-- Drop indicator line -->
                {#if showDropAbove}
                  <div class="absolute -top-1 inset-x-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-progress-glow z-10 pointer-events-none"></div>
                {/if}
                {#if showDropBelow}
                  <div class="absolute -bottom-1 inset-x-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent animate-progress-glow z-10 pointer-events-none"></div>
                {/if}

                <div
                  class="habit-card-inner flex flex-col rounded-2xl border bg-bg-card px-3 py-2.5 transition-all duration-150 cursor-pointer overflow-hidden
                    {dragOverId === habit.id ? 'border-accent/50' : 'border-border hover:border-border-hover'}
                    {isFrozen ? 'opacity-75' : ''}"
                  role="button"
                  tabindex="0"
                  aria-label="{habit.name}, {completed ? 'completed' : 'not completed'}"
                  style:transform={isSwipeRow ? `translateX(${swipeOffset}px)` : 'translateX(0px)'}
                  style:transition={isSwipeRow && isSwipingGesture ? 'none' : 'transform 0.2s ease-out'}
                  style:touch-action="pan-y"
                  style:will-change="transform"
                  style:width="100%"
                  onclick={() => navigateToDetail(habit.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); navigateToDetail(habit.id); }
                    else if (e.key === ' ') { e.preventDefault(); void toggleHabit(habit); }
                  }}
                >
                  <span class="absolute inset-y-0 left-0 w-1 rounded-l-2xl pointer-events-none" style:background={accent.hex}></span>
                  <span
                    class="habit-card-swipe-indicator"
                    style:opacity={indicatorOpacity}
                    style:background-color={indicatorColor}
                  ></span>

                  <div class="relative z-10 flex w-full min-w-0 items-start gap-3">
                    {#if isDragActive()}
                      <button
                        type="button"
                        class="flex-shrink-0 cursor-grab active:cursor-grabbing text-border/60 hover:text-muted transition-colors touch-none"
                        aria-label="Reorder {habit.name}"
                        onclick={(e) => { e.stopPropagation(); }}
                        ontouchstart={(e) => onGripTouchStart(e, habit.id)}
                      >
                        <GripVertical size={14} />
                      </button>
                    {/if}

                    <!-- Toggle button with particle burst -->
                    <div class="relative flex-shrink-0">
                      {#if isAnimating}
                        {#each animParticles as p (p.id)}
                          <span
                            class="completion-burst-particle"
                            style="--tx: {p.tx}px; --ty: {p.ty}px; --particle-size: {p.size}px; --particle-rotate: {p.rotation}deg; --particle-delay: {p.delay}ms; --particle-duration: {p.duration}ms; --particle-color: {p.color}; background: {p.color}; border-radius: {p.radius}; left: 50%; top: 50%; margin-left: calc({p.size}px / -2); margin-top: calc({p.size}px / -2);"
                          ></span>
                        {/each}
                        <span class="completion-status-pop" style="color: {accent.hex}">{animLabel}</span>
                      {/if}
                      <button
                        type="button"
                        aria-label="{completed ? 'Undo' : 'Complete'} {habit.name}"
                        onclick={(e) => { e.stopPropagation(); void toggleHabit(habit); }}
                        disabled={isFrozen}
                        class="relative flex h-8 w-8 items-center justify-center rounded-xl border-[1.5px] transition-all duration-200 overflow-hidden
                          {completed ? `${accent.bgClass} ${accent.borderClass}` : isScheduled ? 'border-border-hover hover:border-muted' : isFrozen ? 'border-border bg-bg-secondary text-muted cursor-not-allowed opacity-60' : 'border border-dashed border-border text-muted hover:border-muted'}
                          {isAnimating ? 'animate-check-pulse animate-glow-burst' : ''}"
                        style={completed && !isFrozen ? `box-shadow: 0 0 12px ${accent.glow}` : ''}
                      >
                        {#if isAnimating}
                          <span class="completion-sheen" style="--sheen-color: {accent.hex}"></span>
                        {/if}
                        {#if tgt > 1}
                          {@const prog = Math.min(Math.max(todayCount, 0), tgt) / tgt}
                          <span class="absolute inset-[2px] rounded-full pointer-events-none overflow-hidden" aria-hidden="true">
                            <span
                              class="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                              style="width: {prog * 100}%; background: linear-gradient(90deg, {accent.hex}55, {accent.hex});"
                            ></span>
                          </span>
                        {/if}
                        {#if isFrozen}
                          <SnowflakeIcon size={13} class="text-muted z-10 relative" />
                        {:else if tgt > 1}
                          <span class="text-[10px] font-mono z-10 relative" style="color: {accent.hex}">{todayCount}/{tgt}</span>
                        {:else if completed}
                          <svg viewBox="0 0 12 12" class="h-4 w-4 z-10 relative {accent.textClass}">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                        {/if}
                      </button>
                    </div>

                    <!-- Habit info (clickable) -->
                    <div class="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <span class="flex-shrink-0 text-xl leading-none">{habit.icon}</span>
                      <div class="min-w-0 flex-1">
                        <div class="min-h-8">
                          <p class="line-clamp-2 text-[13px] font-semibold leading-4 text-foreground sm:truncate sm:text-sm sm:leading-tight {completed ? 'opacity-60 line-through' : ''}" data-habit-title>{habit.name}</p>
                          {#if tgt > 1}
                            <span class="hidden rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary sm:inline-flex">×{tgt}</span>
                          {/if}
                          {#if inlineTags.length > 0}
                            <div class="hidden items-center gap-1 sm:flex">
                              {#each inlineTags as tag, ti (tag + '-' + ti)}
                                <span class="whitespace-nowrap rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary">#{tag}</span>
                              {/each}
                              {#if extraTagCount > 0}
                                <span class="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent-secondary">+{extraTagCount}</span>
                              {/if}
                            </div>
                          {/if}
                        </div>

                        {#if isFrozen}
                          <span class="hidden items-center gap-0.5 text-[10px] font-mono text-muted sm:inline-flex">
                            <SnowflakeIcon size={8} /> Frozen
                          </span>
                        {:else if !isScheduled}
                          <span class="hidden items-center gap-0.5 text-[10px] font-mono text-muted sm:inline-flex">
                            <Moon size={8} /> Not today
                          </span>
                        {/if}

                        {#if hint}
                          {@const hc = hint.type === 'good' ? 'text-accent' : hint.type === 'warn' ? 'text-accent-secondary' : 'text-muted'}
                          <p class="mt-0.5 hidden truncate text-[10px] font-mono sm:block {hc}">{hint.text}</p>
                        {/if}
                      </div>
                    </div>

                    {#if habit.description}
                      <span class="shrink-0"><DescriptionTooltip description={habit.description} triggerClassName="!size-8 !min-h-8 !min-w-8 !rounded-lg sm:!size-11 sm:!min-h-11 sm:!min-w-11 sm:!rounded-[1rem]" /></span>
                    {/if}
                  </div>
                  <div class="relative z-10 mt-2 flex w-full min-w-0 items-center gap-2 border-t border-border/40 pt-2">
                    <HabitStreakPill {streak} missedScheduledDays={momentum.inactiveScheduledDays} />
                    <div class="min-w-0 flex-1" role="img" aria-label="Habit activity for the last 30 days, from 30 days ago through today">
                      <MiniHeatmap completions={habit.completions} dailyTarget={tgt} color={habit.color} />
                    </div>
                  </div>
                </div>
                </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      {/if}
    </div>

  </div>
{/if}
