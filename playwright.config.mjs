import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-report' }], ...(process.env.CI ? [['github']] : [])],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    geolocation: { latitude: 34.6687, longitude: 135.5013 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
    // 瀏覽器固定用 UTF-8 語系：否則在 LANG 沒設定的機器上，中文下載檔名會被換成 "download"
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8' }, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) },
  },
  webServer: { command: 'node tests/serve.mjs', port: 4173, reuseExistingServer: true },
});
