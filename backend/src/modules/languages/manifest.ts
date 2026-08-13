import { defineModuleManifest } from '@b2b/contracts';

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
  name: 'Languages',
  description:
    'Storefront/admin language catalog and per-channel locale routing.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by;
  // `currencies` owns the `CurrencyService` this module's admin surface serves
  // alongside languages. Feature 072 made both container resolutions.
  dependencies: ['auth', 'currencies'],
  // Feature 073/072 (Constitution XVII). Every localized read on the platform
  // resolves a language, and the dictionary validator rejects a code it cannot
  // find — a deployment with this off has no locales, which is not a smaller
  // platform but a broken one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Owns the language set every localized field, storefront locale and ' +
      'dictionary validation resolves against; switched off, no content resolves.',
  },
});
