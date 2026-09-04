import { defineConfig, devices } from '@playwright/test';

/**
 * `conformance:storefront`'s browser configuration
 * (`specs/098-storefront-ssr-seo-a11y-suite/` Phase 4;
 * `contracts/accessibility-floor.md` §4).
 *
 * A second configuration rather than a project inside `playwright.config.ts`,
 * because the two suites answer different questions and want opposite things
 * from a run. The visual suite is a **matrix** — two viewports, two themes,
 * a screenshot per cell — and its `expect.toHaveScreenshot` tolerances are
 * tuned to a pixel floor that has nothing to say here. This one is a single
 * serial run whose verdict is a reconciliation across pages, and it must not
 * pick up `test/conformance/*.test.ts`, which are the judgement's own vitest
 * unit tests and run in `test:frontend` on every merge request.
 *
 * `reducedMotion: 'reduce'` is set per context in the spec rather than here:
 * it is one of the assertions, so the run has to be able to say which
 * emulation produced which observation.
 */
export default defineConfig({
  testDir: './test/conformance',
  // The unit tests of the judgement are `*.test.ts` and belong to vitest;
  // Playwright's default `testMatch` would collect them too.
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 15 * 60 * 1000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    baseURL: process.env['STOREFRONT_URL'] ?? 'http://127.0.0.1:3000',
  },
});
