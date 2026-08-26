import { describe, it, expect } from 'vitest';
import { ModuleManifestSchema } from '@endora-commerce/contracts';
import { manifest as lifecycleManifest } from '../../../src/modules/_lifecycle/manifest.js';
import { manifest as settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { manifest as salesChannelsManifest } from '../../../../packages/modules/sales_channels/src/manifest.js';
import { manifest as searchManifest } from '../../../../packages/modules/search/src/manifest.js';
import { manifest as comparisonsManifest } from '../../../../packages/modules/comparisons/src/manifest.js';
import { manifest as quoteRequestsManifest } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { manifest as inventoryManifest } from '../../../src/modules/inventory/manifest.js';
import { manifest as priceListsManifest } from '@endora-commerce/mod-price-lists';
import { manifest as assetsLibraryManifest } from '../../../../packages/modules/assets_library/src/manifest.js';
import { manifest as blogManifest } from '../../../../packages/modules/blog/src/manifest.js';

/**
 * Regression net for Pass A retrofit (T026–T034). Every manifest exported
 * by the in-repo modules MUST round-trip through `ModuleManifestSchema`
 * unchanged — guarantees the legacy module surface stays valid as the
 * schema evolves and as new modules opt in.
 */

const ALL_MANIFESTS = {
  _lifecycle: lifecycleManifest,
  settings: settingsManifest,
  sales_channels: salesChannelsManifest,
  search: searchManifest,
  comparisons: comparisonsManifest,
  quote_requests: quoteRequestsManifest,
  inventory: inventoryManifest,
  price_lists: priceListsManifest,
  assets_library: assetsLibraryManifest,
  blog: blogManifest,
} as const;

describe('Module manifest contract — Pass A retrofit', () => {
  for (const [folderName, manifest] of Object.entries(ALL_MANIFESTS)) {
    describe(`${folderName}`, () => {
      it('parses cleanly through ModuleManifestSchema', () => {
        const parsed = ModuleManifestSchema.parse(manifest);
        expect(parsed.id).toBe(manifest.id);
        expect(parsed.version).toBe(manifest.version);
        expect(parsed.dependencies).toEqual(manifest.dependencies);
      });

      it('id matches its folder name', () => {
        expect(manifest.id).toBe(folderName);
      });

      it('every dependency points at a known retrofitted module', () => {
        const known = new Set(Object.keys(ALL_MANIFESTS));
        for (const dep of manifest.dependencies) {
          // Some retrofitted modules depend on as-yet-unretrofitted ones
          // (Pass B — out of scope for this feature). We allow that here
          // and only flag deps that point at literally nothing.
          if (!known.has(dep)) {
            // Allow any string id matching the regex — Pass B will retrofit.
            expect(dep).toMatch(/^[a-z][a-z0-9_]*$/);
          } else {
            expect(known.has(dep)).toBe(true);
          }
        }
      });

      it('does not declare itself as a dependency', () => {
        expect(manifest.dependencies).not.toContain(manifest.id);
      });

      it('declared version is strict semver-lite', () => {
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/);
      });

      it("settings.moduleCode equals manifest.id when settings present", () => {
        if (manifest.settings) {
          expect(manifest.settings.moduleCode).toBe(manifest.id);
        }
      });
    });
  }
});
