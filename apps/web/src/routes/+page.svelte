<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { readAuthSession } from '$lib/auth/session';
  import PublicLanding from '$lib/components/PublicLanding.svelte';
  import TelegramRootEntry from '$lib/components/TelegramRootEntry.svelte';
  import { loadTelegramWebApp } from '$lib/telegram/webApp';
  import { themeStore } from '$lib/stores/theme';
  import { get } from 'svelte/store';

  let redirecting = $state(false);
  let telegramEntry = $state(false);

  function isTelegramContainer(): boolean {
    return Boolean(window.Telegram?.WebApp)
      || /Telegram/i.test(window.navigator.userAgent);
  }

  function hasTelegramLaunchIntent(): boolean {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return ['startapp', 'tgWebAppStartParam', 'tgWebAppData', 'tgWebAppVersion', 'tgWebAppPlatform']
      .some((key) => search.has(key) || hash.has(key));
  }

  async function redirectAuthenticatedUser(): Promise<void> {
    await themeStore.setAuthenticated(true);
    const navigation = get(themeStore).workspace.navigation;
    const destination = navigation.screen === 'progress'
      ? resolve<'/app/(protected)/stats'>('/app/(protected)/stats', {})
      : navigation.screen === 'account'
        ? resolve<'/app/(protected)/account'>('/app/(protected)/account', {})
        : navigation.screen === 'habit-detail' && navigation.selectedHabitId
          ? resolve('/app/(protected)/habit/[id]', { id: navigation.selectedHabitId })
          : resolve<'/app/(protected)/dashboard'>('/app/(protected)/dashboard', {});
    redirecting = true;
    await goto(destination, { replaceState: true });
  }

  onMount(() => {
    void (async () => {
      const telegramLaunch = isTelegramContainer() || hasTelegramLaunchIntent();
      if (!telegramLaunch) {
        if (readAuthSession()) {
          await redirectAuthenticatedUser();
        }
        return;
      }
      telegramEntry = true;
      try {
        const telegram = await loadTelegramWebApp();
        telegramEntry = telegramLaunch || Boolean(telegram?.initData);
        if (!telegramEntry && readAuthSession()) {
          await redirectAuthenticatedUser();
        }
      } catch {
        if (readAuthSession()) {
          await redirectAuthenticatedUser();
        }
      }
    })();
  });
</script>

{#if telegramEntry}
  <TelegramRootEntry enabled={telegramEntry} />
{:else}
  <PublicLanding {redirecting} />
{/if}
