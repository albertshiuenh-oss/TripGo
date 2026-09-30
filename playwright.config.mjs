import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-report' }]],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4173',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    geolocation: { latitude: 34.6687, longitude: 135.5013 },
    permissions: ['geolocation'],
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: 'node tests/serve.mjs', port: 4173, reuseExistingServer: true },
});
