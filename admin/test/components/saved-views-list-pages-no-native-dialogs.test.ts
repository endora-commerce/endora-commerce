import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Feature 147 (SC-001) — the three list pages that mount the saved-views
 * control never call a native prompt, confirm or alert themselves. Complements
 * `saved-views-no-native-dialogs.test.ts`, which scans the kit's components
 * only: the pages are where the old order list's `prompt()` lived.
 */
const MODULES = resolve(__dirname, '../../../packages/modules');
const PAGES = [
  'orders/src/admin/pages/OrdersList.tsx',
  'catalog/src/admin/pages/ProductsList.tsx',
  'quote_requests/src/admin/pages/RfqList.tsx',
  // Issue #1734 — the Opportunities page's list and board share one wrapper.
  'crm/src/admin/components/OpportunitySavedViews.tsx',
  'projects/src/admin/pages/ProjectsList.tsx',
];
// A bare `confirm(` is deliberately not matched: the product list's bulk-delete
// confirmation predates this feature and is not a saved-views flow.
const NATIVE_DIALOG = /window\.(prompt|confirm|alert)\b|\b(prompt|alert)\(/;

describe('saved-views list pages use no native dialog', () => {
  it.each(PAGES)('%s mounts the kit control and calls no native dialog', (page) => {
    const source = readFileSync(resolve(MODULES, page), 'utf8');
    expect(source).toContain('SavedViewsControl');
    expect(NATIVE_DIALOG.test(source)).toBe(false);
  });
});
