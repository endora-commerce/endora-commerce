import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Languages module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'languages',
  docs: { dir: 'docs' },
  name: 'Languages',
  description:
    'Storefront/admin language catalog and per-channel locale routing.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by;
  // `currencies` owns `currencyReadPort`. Feature 072 made both container
  // resolutions.
  //
  // The `currencies` edge narrowed on 2026-08-29 and did not go away: the four
  // `/api/v1/admin/currencies*` routes this module served, and the
  // `currencyAdminPort` behind them, moved to their owner. What still reaches
  // across is `GET /api/v1/i18n/config`, which answers with both catalogues and
  // both defaults in one public payload — composition rather than ownership,
  // and one read rather than a write surface.
  dependencies: ['auth', 'currencies'],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. The flag
  // used to rest on a two-hop walk of somebody else's `dependencies`
  // (`organizations` → `dictionaries` → here); ruling 2 removes that as a
  // ground entirely. This module's own is that it owns the locale scope: every
  // localized surface, every translation bundle and every per-channel routing
  // decision resolves against the language catalogue, so its absence is not a
  // reduced platform but an unresolvable one.
  activation: {
    nonDeactivatable: true,
    reason:
      'The locale scope every localized surface and every translation bundle resolves ' +
      'against.',
  },
});
