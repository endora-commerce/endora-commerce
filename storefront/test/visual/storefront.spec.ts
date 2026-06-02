import { test, expect } from '@playwright/test';
import { PAGES, settle, setTheme } from './_helpers';

// Storefront visual-parity matrix: every page-type family × {light, dark}, run under
// both the desktop and mobile projects defined in playwright.config.ts (× 2 viewports).
// Baseline is captured from the pre-migration build (T006); the migrated build must
// diff clean against it (SC-001 / FR-002).
//
// Usage:
//   STOREFRONT_URL=... npx playwright test           # diff against committed baseline
//   STOREFRONT_URL=... npx playwright test --update-snapshots   # capture/refresh baseline
for (const pageDef of PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${pageDef.id} — ${theme}`, async ({ page }) => {
      const res = await page.goto(pageDef.path, { waitUntil: 'domcontentloaded' });
      // Skip non-routable pages in this environment rather than fail the whole matrix.
      expect(res, `no response for ${pageDef.path}`).not.toBeNull();
      await settle(page);
      await setTheme(page, theme);
      await expect(page).toHaveScreenshot(`${pageDef.id}-${theme}.png`, { fullPage: true });
    });
  }
}
