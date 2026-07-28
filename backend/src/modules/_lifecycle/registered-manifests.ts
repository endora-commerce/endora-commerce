import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import { DISCOVERED_MANIFESTS } from './manifest-index.generated.js';
import {
  overlayModulesRootFor,
  selectedDeployment,
} from '../../overlay/overlay-roots.js';
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
import { manifest as mfaManifest } from '../mfa/manifest.js';
// Feature 043 — natural-language prompt actions in the admin command palette.
import { manifest as promptActionsManifest } from '../prompt_actions/manifest.js';
// Feature 046 — Progressive Web App (installability, caching, push).
import { manifest as pwaManifest } from '../pwa/manifest.js';
// Feature 047 — Transactional Emails (admin-editable email content + look).
import { manifest as transactionalEmailsManifest } from '../transactional_emails/manifest.js';
// Feature 048 — Newsletter (own-infrastructure bulk email + automations).
import { manifest as newsletterManifest } from '../newsletter/manifest.js';
// Feature 049 — Google Analytics (GA4 integration + custom events + server-side tagging).
import { manifest as googleAnalyticsManifest } from '../google_analytics/manifest.js';
import { manifest as linkedInAdsManifest } from '../linkedin_ads/manifest.js';
import { manifest as metaAdsManifest } from '../meta_ads/manifest.js';
// Feature 049 — Stripe payment gateway.
import { manifest as stripeManifest } from '../stripe/manifest.js';
// Feature 055 — Custom Fields Layer (entity-agnostic runtime fields).
import {
  manifest as customFieldsManifest,
  uninstallHook as customFieldsUninstallHook,
} from '../custom_fields/manifest.js';
// Feature 058 — Credentials (reusable credential configurations).
import { manifest as credentialsManifest } from '../credentials/manifest.js';
// Feature 059 — KSeF (Krajowy System e-Faktur invoice integration).
import { manifest as ksefManifest } from '../ksef/manifest.js';
// Pass C retrofit — manifest backfills for every remaining legacy module.
// These predate the lifecycle system; the manifest is the static record
// required for the module to be considered active. A module on disk that
// is missing from this list (and therefore has no manifest entry) is
// treated as inactive — see `assertEveryModuleHasManifest` below.
import { manifest as addressesManifest } from '../addresses/manifest.js';
import { manifest as adminNotificationsManifest } from '../admin_notifications/manifest.js';
import { manifest as adminRolesManifest } from '../admin_roles/manifest.js';
import { manifest as adminUsersManifest } from '../admin_users/manifest.js';
import { manifest as analyticsManifest } from '../analytics/manifest.js';
import { manifest as apiKeysManifest } from '../api_keys/manifest.js';
import { manifest as assetsLegacyManifest } from '../assets/manifest.js';
import { manifest as auditLogsManifest } from '../audit_logs/manifest.js';
import { manifest as authManifest } from '../auth/manifest.js';
import { manifest as cartsManifest } from '../carts/manifest.js';
import { manifest as creditLimitsManifest } from '../credit_limits/manifest.js';
import { manifest as currenciesManifest } from '../currencies/manifest.js';
import { manifest as customerAccountsManifest } from '../customer_accounts/manifest.js';
import { manifest as customersManifest } from '../customers/manifest.js';
import { manifest as deliveryMethodsManifest } from '../delivery_methods/manifest.js';
import { manifest as emailManifest } from '../email/manifest.js';
import { manifest as healthChecksManifest } from '../health_checks/manifest.js';
import { manifest as invoicesManifest } from '../invoices/manifest.js';
import { manifest as languagesManifest } from '../languages/manifest.js';
import { manifest as ordersManifest } from '../orders/manifest.js';
import { manifest as organizationsManifest } from '../organizations/manifest.js';
import { manifest as paymentMethodsManifest } from '../payment_methods/manifest.js';
import { manifest as paymentsManifest } from '../payments/manifest.js';
import { manifest as promotionsManifest } from '../promotions/manifest.js';
import { manifest as quickOrderManifest } from '../quick_order/manifest.js';
import { manifest as returnsManifest } from '../returns/manifest.js';
import { manifest as seoManifest } from '../seo/manifest.js';
import { manifest as shipmentsManifest } from '../shipments/manifest.js';
import { manifest as shoppingListsManifest } from '../shopping_lists/manifest.js';
import { manifest as taxesManifest } from '../taxes/manifest.js';
import { manifest as webhooksManifest } from '../webhooks/manifest.js';

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
  // Feature 042 — MFA (2FA + Google/Microsoft sign-in).
  { manifest: mfaManifest, filePath: pathFor('mfa') },
  // Feature 043 — prompt assistant for the admin command palette.
  { manifest: promptActionsManifest, filePath: pathFor('prompt_actions') },
  // Feature 046 — Progressive Web App module.
  { manifest: pwaManifest, filePath: pathFor('pwa') },
  // Feature 047 — Transactional Emails module.
  { manifest: transactionalEmailsManifest, filePath: pathFor('transactional_emails') },
  // Feature 048 — Newsletter module.
  { manifest: newsletterManifest, filePath: pathFor('newsletter') },
  // Feature 049 — Google Analytics module.
  { manifest: googleAnalyticsManifest, filePath: pathFor('google_analytics') },
  // Feature 063 — LinkedIn Ads module.
  { manifest: linkedInAdsManifest, filePath: pathFor('linkedin_ads') },
  // Feature 064 — Meta Ads module.
  { manifest: metaAdsManifest, filePath: pathFor('meta_ads') },
  // Feature 049 — Stripe payment gateway module.
  { manifest: stripeManifest, filePath: pathFor('stripe') },
  // Feature 055 — Custom Fields Layer module.
  {
    manifest: customFieldsManifest,
    filePath: pathFor('custom_fields'),
    uninstallHook: customFieldsUninstallHook,
  },
  // Feature 058 — Credentials module.
  { manifest: credentialsManifest, filePath: pathFor('credentials') },
  // Feature 059 — KSeF module.
  { manifest: ksefManifest, filePath: pathFor('ksef') },
  // Pass C retrofit — every remaining legacy module gets a manifest so
  // none of them are treated as inactive. Sort: alphabetical by id.
  { manifest: addressesManifest, filePath: pathFor('addresses') },
  { manifest: adminNotificationsManifest, filePath: pathFor('admin_notifications') },
  { manifest: adminRolesManifest, filePath: pathFor('admin_roles') },
  { manifest: adminUsersManifest, filePath: pathFor('admin_users') },
  { manifest: analyticsManifest, filePath: pathFor('analytics') },
  { manifest: apiKeysManifest, filePath: pathFor('api_keys') },
  { manifest: assetsLegacyManifest, filePath: pathFor('assets') },
  { manifest: auditLogsManifest, filePath: pathFor('audit_logs') },
  { manifest: authManifest, filePath: pathFor('auth') },
  { manifest: cartsManifest, filePath: pathFor('carts') },
  { manifest: creditLimitsManifest, filePath: pathFor('credit_limits') },
  { manifest: currenciesManifest, filePath: pathFor('currencies') },
  { manifest: customerAccountsManifest, filePath: pathFor('customer_accounts') },
  { manifest: customersManifest, filePath: pathFor('customers') },
  { manifest: deliveryMethodsManifest, filePath: pathFor('delivery_methods') },
  { manifest: emailManifest, filePath: pathFor('email') },
  { manifest: healthChecksManifest, filePath: pathFor('health_checks') },
  { manifest: invoicesManifest, filePath: pathFor('invoices') },
  { manifest: languagesManifest, filePath: pathFor('languages') },
  { manifest: ordersManifest, filePath: pathFor('orders') },
  { manifest: organizationsManifest, filePath: pathFor('organizations') },
  { manifest: paymentMethodsManifest, filePath: pathFor('payment_methods') },
  { manifest: paymentsManifest, filePath: pathFor('payments') },
  { manifest: promotionsManifest, filePath: pathFor('promotions') },
  { manifest: quickOrderManifest, filePath: pathFor('quick_order') },
  // Feature 046 — Returns & Complaints (Refunds, RMA).
  { manifest: returnsManifest, filePath: pathFor('returns') },
  { manifest: seoManifest, filePath: pathFor('seo') },
  { manifest: shipmentsManifest, filePath: pathFor('shipments') },
  { manifest: shoppingListsManifest, filePath: pathFor('shopping_lists') },
  { manifest: taxesManifest, filePath: pathFor('taxes') },
  { manifest: webhooksManifest, filePath: pathFor('webhooks') },
];

/**
 * Boot-time check: every directory under `backend/src/modules/` (apart
 * from `__tests__` and the like) MUST own a `manifest.ts` AND be
 * registered above. Anything else is treated as inactive — the
 * function logs a warning and the module's lifecycle features (i18n
 * bundles, admin actions, settings registration) are skipped. The
 * loader still allows the module's plugin to register via
 * `composition.ts`, but operators see a clear signal that the module
 * is off the lifecycle path until a manifest is added.
 *
 * The check is invoked once at boot via the lifecycle plugin. Pure fs
 * + no Redis / DB, so it's safe to run before the orchestrator opens.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';

export interface InactiveModule {
  id: string;
  reason: 'no-manifest-file' | 'no-registry-entry';
}

export function findInactiveModules(): InactiveModule[] {
  const registeredIds = new Set(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  const out: InactiveModule[] = [];
  let entries: string[];
  try {
    entries = readdirSync(MODULES_ROOT);
  } catch {
    return out;
  }
  for (const name of entries) {
    // Skip files (e.g. `index.ts`) and dotfiles. Underscore-prefixed
    // platform-internal modules (`_lifecycle`, `_i18n`) are still valid.
    if (name.startsWith('.')) continue;
    const fullPath = join(MODULES_ROOT, name);
    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (!existsSync(join(fullPath, 'manifest.ts'))) {
      out.push({ id: name, reason: 'no-manifest-file' });
      continue;
    }
    if (!registeredIds.has(name)) {
      out.push({ id: name, reason: 'no-registry-entry' });
    }
  }
  return out;
}

/**
 * The **deployment-resolved** manifest set = the hand-maintained core
 * `REGISTERED_MANIFESTS` PLUS any overlay-only module discovered for the active
 * deployment (feature 057). The core array is never edited per deployment
 * (FR-004): overlay modules are appended from the generated manifest index
 * (which includes overlay entries when the build ran with `DEPLOYMENT` set).
 *
 * For a bare-core build (`DEPLOYMENT` unset) the generated index contains only
 * core modules, so this returns `REGISTERED_MANIFESTS` unchanged (FR-008).
 * Consumers that must include overlay modules — lifecycle scripts, the
 * permission catalogue, composition — call this instead of reading the raw
 * array. `filePath` stays real so the i18n bundle loader keeps working.
 */
export function resolvedManifestEntries(): RegisteredManifestEntry[] {
  const byId = new Map<string, RegisteredManifestEntry>(
    REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e]),
  );
  const deployment = selectedDeployment();
  for (const discovered of DISCOVERED_MANIFESTS) {
    if (byId.has(discovered.id)) continue; // core module already registered
    // An overlay-only module: prefer a real core path if one somehow exists,
    // else resolve under the deployment's overlay tree.
    const corePath = pathFor(discovered.id);
    const filePath =
      existsSync(corePath) || deployment === null
        ? corePath
        : join(overlayModulesRootFor(deployment), discovered.id, 'manifest.ts');
    byId.set(discovered.id, { manifest: discovered.manifest, filePath });
  }
  return [...byId.values()];
}
