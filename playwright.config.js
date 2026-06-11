import { defineConfig } from '@playwright/test'

const PORT = 8421

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false, // shared server, shared dungeon lobby namespace
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    port: PORT,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      SCORE_SECRET: 'e2e-test-secret',
      DATA_DIR: '/tmp/gameclawd-e2e/dungeon',
      AETHERWING_DATA_DIR: '/tmp/gameclawd-e2e/aetherwing',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // WebGL via software rendering for the Three.js games
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
