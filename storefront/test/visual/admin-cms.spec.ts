import { test, expect } from '@playwright/test';
import { settle } from './_helpers';

// Admin CMS Page Builder no-regression subset (FR-012b). The admin app is NOT migrated,
// but it consumes @endora-commerce/cms-components; after that package gains its self-contained
// stylesheet, the admin editor/preview surfaces rendering those components MUST look
// unchanged. Baseline captured pre-migration (T007).
//
// Requires a running admin instance (ADMIN_URL) and the page-builder editor route.
// ADMIN_CMS_EDITOR_PATH should point at a seeded CMS page in the builder.
const adminURL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const editorPath = process.env.ADMIN_CMS_EDITOR_PATH ?? '/cms/pages/example/edit';

test.describe('admin CMS editor — cms-components parity', () => {
  test('page-builder editor surface', async ({ page }) => {
    const res = await page.goto(`${adminURL}${editorPath}`, { waitUntil: 'domcontentloaded' });
    expect(res, `no response for admin ${editorPath}`).not.toBeNull();
    await settle(page);
    await expect(page).toHaveScreenshot('admin-cms-editor.png', { fullPage: true });
  });
});
