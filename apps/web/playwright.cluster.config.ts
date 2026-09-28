import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Two API processes on one PostgreSQL (CLUSTER_DATABASE_URL, emptied first by the test): people on either one edit
// the same project together. `pnpm --filter @af/web e2e:cluster`.
const db = process.env.CLUSTER_DATABASE_URL;
if (!db) throw new Error('CLUSTER_DATABASE_URL=postgres://… is required (its tables are dropped)');
export const PORTS = [4183, 4184] as const;
const chromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');

export default defineConfig({
  testDir: 'e2e-cluster',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'x-requested-with': 'animation-flow' },
    ...(existsSync(chromium) ? { launchOptions: { executablePath: chromium } } : {}),
  },
  // the schema is emptied, the first process migrates it, then the second one starts
  webServer: PORTS.map((port, i) => ({
    command: i === 0 ? 'node ../api/scripts/reset-db.mjs && tsx ../api/src/main.ts' : `until curl -sf http://127.0.0.1:${PORTS[0]}/api/health >/dev/null; do sleep 0.3; done; tsx ../api/src/main.ts`,
    url: `http://127.0.0.1:${port}/api/health`,
    env: { PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: db, APP_ENCRYPTION_KEY: key, DATA_DIR: mkdtempSync(join(tmpdir(), 'af-cl-')), WEB_DIST: 'dist', ROLE: i === 0 ? 'all' : 'api', ADMIN_PORT: 'off' },
    reuseExistingServer: false,
    timeout: 60_000,
  })),
});
