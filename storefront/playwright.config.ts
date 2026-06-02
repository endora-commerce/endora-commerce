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
  // Parity gate operates in SC-001 "triage" mode. The storefront renders some content
  // server-side that is non-deterministic across runs (the `page.top` CMS hook badge and
  // session-dependent banners are fetched during SSR, so browser-level route stubbing
  // cannot freeze them). That floor of transient noise measures ~1% of a full-page shot.
  // maxDiffPixelRatio is set just above that floor so runs aren't red from noise; real
  // regressions are confirmed by reviewing the emitted *-diff.png images. Fully
  // deterministic VR would require seeding/controlling backend hook + banner state.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL,
    // Freeze time-of-day / locale influences on rendering where possible.
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    // The storefront has its own `prefers-reduced-motion: reduce` handling; emulating it
    // disables the route-enter / progress animations natively, so captures are deterministic
    // (no frame caught mid-animation — the source of the dark-mode transient diffs).
    reducedMotion: 'reduce',
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
