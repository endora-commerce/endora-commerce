import type { Page } from '@playwright/test';

// Shared helpers for the visual-regression parity suite (SC-001).
// See specs/041-storefront-tailwind/contracts/visual-regression-contract.md §3.

// Wait until the page is network-idle AND all web fonts have finished loading, so
// the Geist Google-Fonts @import cannot cause FOUT-induced false diffs (R4 / contract §3).
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    // document.fonts.ready resolves once all @font-face loads settle.
    if ('fonts' in document) {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }
  });
  // Disable CSS animations/transitions for deterministic capture.
  await page.addStyleTag({
    content:
      '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
}

// Apply (or clear) the storefront's runtime dark theme scope. The storefront toggles
// dark mode via the `is-dark` class on <html> (preserved by the migration, FR-003a).
export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('is-dark', t === 'dark');
  }, theme);
  // Let the re-theme paint before capture.
  await page.waitForTimeout(150);
}

// The page-type families covered by the parity matrix (contract §2).
// Data-dependent detail routes are sourced from env so baselines stay deterministic
// against a known seeded dataset; defaults are placeholders to be set per environment.
export const PAGES: { id: string; path: string }[] = [
  { id: 'home', path: '/' },
  { id: 'catalog', path: '/catalog' },
  { id: 'search', path: `/search?q=${process.env.VR_SEARCH_QUERY ?? 'pump'}` },
  { id: 'category', path: process.env.VR_CATEGORY_PATH ?? '/c/example-category' },
  { id: 'product', path: process.env.VR_PRODUCT_PATH ?? '/p/example-product' },
  { id: 'compare', path: '/compare' },
  { id: 'cart', path: '/cart' },
  { id: 'login', path: '/login' },
  { id: 'register', path: '/register' },
  { id: 'blog', path: '/blog' },
  // CMS page is opt-in: only covered when a real seeded slug is provided, so the
  // baseline never captures a 404 placeholder.
  ...(process.env.VR_CMS_PATH ? [{ id: 'cms', path: process.env.VR_CMS_PATH }] : []),
  { id: 'offline', path: '/offline' },
];
