import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL } },
  ],
  webServer: [
    {
      command: '.venv/bin/python -m uvicorn myschedule.main:app --host 127.0.0.1 --port 8001 --no-access-log',
      cwd: fileURLToPath(new URL('../backend', import.meta.url)),
      url: 'http://127.0.0.1:8001/health/live',
      reuseExistingServer: false,
      env: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', ALLOWED_GOOGLE_EMAILS: '[]', APP_ENV: 'test' },
    },
    {
      command: 'npm run dev -- --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8001' },
    },
  ],
})
