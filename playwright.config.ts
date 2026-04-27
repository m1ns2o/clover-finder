import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: 'http://localhost:4187',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'pnpm preview --port 4187',
    url: 'http://localhost:4187',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
