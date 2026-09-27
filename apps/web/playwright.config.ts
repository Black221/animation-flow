import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The API serves the built editor with a throwaway embedded database: the test covers the real stack end to end.
const PORT = 4173;
const dataDir = mkdtempSync(join(tmpdir(), 'af-e2e-'));
const chromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // the API refuses writes without it (CSRF); page.request calls in the tests send it too
    extraHTTPHeaders: { 'x-requested-with': 'animation-flow' },
    ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: {
    command: 'tsx ../api/src/main.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, WEB_DIST: 'dist' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
