import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: process.env.CI ? 4 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'compact-mobile', use: { ...devices['Pixel 5'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    {
      name: 'telegram-webview',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        userAgent: `${devices['Pixel 5'].userAgent} TelegramWebview`
      }
    }
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'VITE_API_BASE_URL=/api npm run build && npm run preview -- --host 0.0.0.0 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results'
});
