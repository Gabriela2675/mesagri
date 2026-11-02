import { defineConfig } from '@playwright/test';

/* Recorridos de punta a punta contra la web (y, cuando corre, la API con MySQL). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', actionTimeout: 8_000, viewport: { width: 1500, height: 960 } },
});
