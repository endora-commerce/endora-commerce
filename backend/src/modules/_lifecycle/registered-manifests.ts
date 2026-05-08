import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
import { manifest as adminActionsManifest } from '../admin_actions/manifest.js';
import { manifest as catalogManifest } from '../catalog/manifest.js';
import { manifest as importExportManifest } from '../import_export/manifest.js';
import { manifest as cmsManifest } from '../cms/manifest.js';
import { manifest as megamenuManifest } from '../megamenu/manifest.js';
import { manifest as dictionariesManifest } from '../dictionaries/manifest.js';

/**
 * Single source of truth for the static manifest list consumed by both
 * `composition.ts` (boot wiring) and the `_lifecycle/scripts/*` CLI
 * entry points. Adding a new module's manifest goes here ONCE.
 *
 * Modules with optional install/uninstall hooks add them as a sibling
 * `installHook` / `uninstallHook` export from the module's `manifest.ts`;
 * the spread below picks them up automatically.
 *
 * Each entry carries a real `filePath` so downstream reconcilers can
 * locate the module's directory on disk — notably the i18n bundle
 * loader (`_i18n/plugin.ts`) does `dirname(entry.filePath)` and joins
 * `bundlesDir` to find each module's `i18n/<lang>.json` files. Without
 * a real path, `dirname('<static>')` resolves to `.` and no bundle ever
 * loads, leaving every action label rendered as its raw i18n key.
 */
export interface RegisteredManifestEntry {
  manifest: ModuleManifest;
  filePath: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
}

/**
 * Convention: every module lives at `backend/src/modules/<id>/manifest.ts`.
 * `import.meta.url` points at this `_lifecycle/registered-manifests.ts`,
 * so `dirname(dirname(...))` lands on the modules root.
 */
const MODULES_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pathFor = (id: string): string => join(MODULES_ROOT, id, 'manifest.ts');

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> = [
  { manifest: lifecycleManifest, filePath: pathFor('_lifecycle') },
  { manifest: settingsManifest, filePath: pathFor('settings') },
  { manifest: salesChannelsManifest, filePath: pathFor('sales_channels') },
  { manifest: searchManifest, filePath: pathFor('search') },
  { manifest: comparisonsManifest, filePath: pathFor('comparisons') },
  { manifest: quoteRequestsManifest, filePath: pathFor('quote_requests') },
  { manifest: inventoryManifest, filePath: pathFor('inventory') },
  { manifest: priceListsManifest, filePath: pathFor('price_lists') },
  { manifest: assetsLibraryManifest, filePath: pathFor('assets_library') },
  { manifest: blogManifest, filePath: pathFor('blog') },
  // Feature 019 — Admin UI i18n. Ships its own `core` namespace bundle.
  { manifest: adminI18nManifest, filePath: pathFor('_i18n') },
  // Feature 020 — module-contributed admin command palette actions.
  { manifest: adminActionsManifest, filePath: pathFor('admin_actions') },
  // Feature 020 — manifest backfills for legacy modules so they can
  // contribute palette actions and (in future) participate in the
  // lifecycle. None of these declare an installHook today; their
  // schemas were established by earlier migrations and are owned
  // platform-wide, not by the module's own install pass.
  { manifest: catalogManifest, filePath: pathFor('catalog') },
  { manifest: importExportManifest, filePath: pathFor('import_export') },
  { manifest: cmsManifest, filePath: pathFor('cms') },
  { manifest: megamenuManifest, filePath: pathFor('megamenu') },
  // Pass B retrofit — `inventory` and `blog` declare `dictionaries` as a
  // dependency, so the module needs an entry here even though it has no
  // install hook (its schema is owned by migration 038).
  { manifest: dictionariesManifest, filePath: pathFor('dictionaries') },
];
