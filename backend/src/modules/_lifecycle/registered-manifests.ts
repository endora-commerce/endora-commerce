import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import { manifest as lifecycleManifest } from './manifest.js';
import {
  manifest as settingsManifest,
} from '../settings/manifest.js';
import {
  manifest as salesChannelsManifest,
} from '../sales_channels/manifest.js';
import { manifest as searchManifest } from '../search/manifest.js';
import { manifest as comparisonsManifest } from '../comparisons/manifest.js';
import { manifest as quoteRequestsManifest } from '../quote_requests/manifest.js';
import { manifest as inventoryManifest } from '../inventory/manifest.js';
import { manifest as priceListsManifest } from '../price_lists/manifest.js';
import { manifest as assetsLibraryManifest } from '../assets_library/manifest.js';
import { manifest as blogManifest } from '../blog/manifest.js';
import { manifest as adminI18nManifest } from '../_i18n/manifest.js';

/**
 * Single source of truth for the static manifest list consumed by both
 * `composition.ts` (boot wiring) and the `_lifecycle/scripts/*` CLI
 * entry points. Adding a new module's manifest goes here ONCE.
 *
 * Modules with optional install/uninstall hooks add them as a sibling
 * `installHook` / `uninstallHook` export from the module's `manifest.ts`;
 * the spread below picks them up automatically.
 */
export interface RegisteredManifestEntry {
  manifest: ModuleManifest;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
}

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> = [
  { manifest: lifecycleManifest },
  { manifest: settingsManifest },
  { manifest: salesChannelsManifest },
  { manifest: searchManifest },
  { manifest: comparisonsManifest },
  { manifest: quoteRequestsManifest },
  { manifest: inventoryManifest },
  { manifest: priceListsManifest },
  { manifest: assetsLibraryManifest },
  { manifest: blogManifest },
  // Feature 019 — Admin UI i18n. Ships its own `core` namespace bundle.
  { manifest: adminI18nManifest },
];
