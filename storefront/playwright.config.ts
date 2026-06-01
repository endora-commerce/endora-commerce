import { defineConfig, devices } from '@playwright/test';

// Visual-regression configuration for the TailwindCSS migration parity gate (SC-001).
// See specs/041-storefront-tailwind/contracts/visual-regression-contract.md.
//
// The storefront depends on a running backend + seeded data, so this config does NOT
// start the app itself — point it at an already-running instance via STOREFRONT_URL
// (and ADMIN_URL for the FR-012b admin-editor subset). The pre-migration baseline is
// captured first with `playwright test --update-snapshots` on the unchanged build, then
// the migrated build is diffed against that committed baseline.
const baseURL = process.env.STOREFRONT_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './test/visual',
  // Deterministic rendering: no retries masking flakiness, single worker so font/layout
  // settling is consistent across the matrix.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // Near-zero tolerance: FR-002 forbids intentional visual change, so any real diff fails.
  // A tiny ratio absorbs sub-pixel antialiasing only.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL,
    // Freeze time-of-day / locale influences on rendering where possible.
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
