import { describe, expect, it } from 'vitest';
import { manifest as catalogManifest } from '../../../../packages/modules/catalog/src/manifest.js';
import { manifest as importExportManifest } from '../../../../packages/modules/import_export/src/manifest.js';
import { manifest as inventoryManifest } from '../../../../packages/modules/inventory/src/manifest.js';
import { manifest as quoteRequestsManifest } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { manifest as cmsManifest } from '../../../../packages/modules/cms/src/manifest.js';
import { manifest as blogManifest } from '../../../../packages/modules/blog/src/manifest.js';
import { manifest as megamenuManifest } from '@endora-commerce/mod-megamenu';
import { manifest as salesChannelsManifest } from '../../../../packages/modules/sales_channels/src/manifest.js';
import { manifest as settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { ModuleActionSchema } from '@endora-commerce/contracts';

/**
 * Per-module manifest assertions for the v1 seed action set (T028, T029,
 * T036 from tasks.md). One parameterized table; one assertion per row.
 *
 * The point is to lock the contract between each module's manifest and
 * the curated seed list in research §R9 — if a module owner inadvertently
 * removes an action declaration or renames its id, this test fails before
 * the change reaches the registry.
 */

interface ExpectedAction {
  module: { id: string; manifest: typeof catalogManifest };
  actionId: string;
  targetRoute: string;
  icon: string;
  requiredPermission: string | undefined;
  weight: number;
  labelKey: string;
}

const EXPECTED: ReadonlyArray<ExpectedAction> = [
  {
    module: { id: 'catalog', manifest: catalogManifest },
    actionId: 'new-product',
    targetRoute: '/catalog/products/new',
    icon: 'Plus',
    requiredPermission: 'catalog:write',
    weight: 100,
    labelKey: 'actions.newProduct.label',
  },
  {
    module: { id: 'import_export', manifest: importExportManifest },
    actionId: 'import-products',
    targetRoute: '/import-export',
    icon: 'Upload',
    requiredPermission: 'catalog:write',
    weight: 110,
    labelKey: 'actions.importProducts.label',
  },
  {
    module: { id: 'import_export', manifest: importExportManifest },
    actionId: 'open-import-export-center',
    targetRoute: '/import-export',
    icon: 'FileUp',
    requiredPermission: 'catalog:write',
    weight: 220,
    labelKey: 'actions.openCenter.label',
  },
  {
    module: { id: 'inventory', manifest: inventoryManifest },
    actionId: 'open-inventory',
    targetRoute: '/inventory',
    icon: 'Boxes',
    // `inventory:read` since 2026-08-29, when the module took its own codes:
    // the stock overview's own route is `requireAdmin('inventory:read')`.
    // This row has now been corrected twice and both reasons are worth keeping.
    // Issue #232 replaced a `catalog:write` that hid the screen from operators
    // who can open it with `orders:read`, the code the route then enforced —
    // correct against the route, and the route's own code was the defect.
    requiredPermission: 'inventory:read',
    weight: 230,
    labelKey: 'actions.openInventory.label',
  },
  {
    module: { id: 'quote_requests', manifest: quoteRequestsManifest },
    actionId: 'open-rfq-inbox',
    targetRoute: '/quote-requests',
    icon: 'Inbox',
    requiredPermission: 'rfqs:handle',
    weight: 310,
    labelKey: 'actions.openInbox.label',
  },
  {
    module: { id: 'cms', manifest: cmsManifest },
    actionId: 'new-page',
    targetRoute: '/cms/pages/new',
    icon: 'FileText',
    requiredPermission: 'cms.write',
    weight: 130,
    labelKey: 'actions.newPage.label',
  },
  {
    module: { id: 'blog', manifest: blogManifest },
    actionId: 'new-post',
    targetRoute: '/blog/posts/new',
    icon: 'BookOpen',
    requiredPermission: 'blog.write',
    weight: 140,
    labelKey: 'actions.newPost.label',
  },
  {
    module: { id: 'megamenu', manifest: megamenuManifest },
    actionId: 'edit-megamenu',
    targetRoute: '/megamenu',
    icon: 'Menu',
    requiredPermission: 'megamenu.write',
    weight: 240,
    labelKey: 'actions.editMegamenu.label',
  },
  {
    module: { id: 'sales_channels', manifest: salesChannelsManifest },
    actionId: 'new-sales-channel',
    targetRoute: '/sales-channels/new',
    icon: 'Layers',
    requiredPermission: 'sales_channels:write',
    weight: 150,
    labelKey: 'actions.newSalesChannel.label',
  },
  {
    module: { id: 'settings', manifest: settingsManifest },
    actionId: 'open-settings',
    targetRoute: '/settings',
    icon: 'Settings',
    // Was `undefined` — the only action of the 53 shipped that declared no code
    // at all, against a `settings:read` route (issue #232).
    requiredPermission: 'settings:read',
    weight: 250,
    labelKey: 'actions.openSettings.label',
  },
];

describe('seeded action manifests — v1 set', () => {
  it('exactly 10 distinct (moduleId, actionId) pairs', () => {
    const pairs = EXPECTED.map((e) => `${e.module.id}:${e.actionId}`);
    const unique = new Set(pairs);
    expect(unique.size).toBe(10);
    expect(pairs.length).toBe(10);
  });

  for (const expected of EXPECTED) {
    it(`${expected.module.id} declares "${expected.actionId}" with the expected payload`, () => {
      const actions = expected.module.manifest.actions ?? [];
      const found = actions.find((a) => a.id === expected.actionId);
      expect(found, `${expected.module.id}.${expected.actionId} not found in manifest`).toBeDefined();
      if (!found) return;
      expect(found.targetRoute).toBe(expected.targetRoute);
      expect(found.icon).toBe(expected.icon);
      expect(found.requiredPermission).toBe(expected.requiredPermission);
      expect(found.weight).toBe(expected.weight);
      expect(found.labelKey).toBe(expected.labelKey);
      // Re-validate via the Zod schema to catch any drift in shape.
      expect(() => ModuleActionSchema.parse(found)).not.toThrow();
    });
  }

  it('every seeded action declares at least one keyword for search', () => {
    for (const expected of EXPECTED) {
      const found = (expected.module.manifest.actions ?? []).find(
        (a) => a.id === expected.actionId,
      );
      expect(found?.keywords?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
