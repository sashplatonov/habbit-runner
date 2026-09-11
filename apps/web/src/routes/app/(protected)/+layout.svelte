<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { AuthSession } from '@/lib/auth/session';
  import {
    AUTH_SESSION_CLEARED_EVENT,
    authenticatedFetch,
    clearAuthSession
  } from '@/lib/auth/session';
  import { subscribeToPush, isPushNotificationSupported } from '@/lib/pwa/pushSubscription';
  import { setCurrentUserId } from '@/lib/storage/db';
  import { clearCurrentUserTimeZone } from '@/lib/time/userTimezone';
  import AppLayout from '$lib/components/AppLayout.svelte';
  import PullToRefresh from '$lib/components/PullToRefresh.svelte';
  import { habitsStore } from '$lib/stores/habits';
  import { themeStore } from '$lib/stores/theme';
  import { get } from 'svelte/store';
  import { createAppRuntime } from '$lib/app/runtime';
  import AppRuntimeProvider from '$lib/app/AppRuntimeProvider.svelte';

  type Props = {
    data: {
      authSession: AuthSession;
    };
    children: Snippet;
  };

  let { data, children }: Props = $props();
  let sessionClearInFlight = false;
  let isRefreshing = $state(false);
  const runtime = createAppRuntime({ habitsStore, routeBase: '/app/(protected)', isDemo: false });

  afterNavigate(() => {
    if (browser) {
      document.getElementById('main-content')?.focus();
    }
    void recordStableNavigation();
  });

  async function recordStableNavigation(pathname = window.location.pathname): Promise<void> {
    if (!get(themeStore).serverSyncReady) {
      return;
    }
    if (pathname.endsWith('/dashboard')) {
      await themeStore.setNavigation('dashboard');
    } else if (pathname.endsWith('/stats')) {
      await themeStore.setNavigation('progress');
    } else if (pathname.endsWith('/account')) {
      await themeStore.setNavigation('account');
    }
  }

  async function handleSessionCleared() {
    if (sessionClearInFlight) {
      return;
    }

    sessionClearInFlight = true;
    setCurrentUserId(null);
    clearCurrentUserTimeZone();
    await themeStore.setAuthenticated(false);
    await goto(resolve<'/'>('/', {}), { replaceState: true });
  }

  async function refreshHabits() {
    isRefreshing = true;
    try {
      await habitsStore.refresh();
    } finally {
      isRefreshing = false;
    }
  }

  async function logout() {
    clearAuthSession();

    try {
      await authenticatedFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      return;
    }
  }

  onMount(() => {
    sessionClearInFlight = false;
    setCurrentUserId(data.authSession.userId);
    isRefreshing = true;
    void habitsStore.setUserId(data.authSession.userId).finally(() => {
      isRefreshing = false;
    });
    void (async () => {
      await themeStore.setAuthenticated(true);
      await recordStableNavigation();
    })();

    const onSessionCleared = () => {
      void handleSessionCleared();
    };

    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, onSessionCleared);

    if (
      isPushNotificationSupported() &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      subscribeToPush().catch(() => undefined);
    }

    return () => {
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, onSessionCleared);
    };
  });
</script>

<PullToRefresh
  enabled={true}
  isRefreshing={isRefreshing}
  onRefresh={refreshHabits}
>
  <AppRuntimeProvider {runtime}>
    {#if $themeStore.isAuthenticated && $themeStore.syncError}
      <div class="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger sm:mx-6" role="status" aria-live="polite">
        <span class="min-w-0 flex-1">{$themeStore.syncError}</span>
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-danger/40 px-3 font-semibold text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
          aria-label="Retry preference synchronization"
          onclick={() => void themeStore.retrySync()}
        >
          Retry
        </button>
      </div>
    {/if}
    <AppLayout
      theme={$themeStore.theme}
      onThemeChange={(id) => themeStore.setTheme(id)}
      onLogout={logout}
    >
      {@render children()}
    </AppLayout>
  </AppRuntimeProvider>
</PullToRefresh>
