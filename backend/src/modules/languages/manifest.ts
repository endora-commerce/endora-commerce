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
  // Feature 073, Amendment A1 (Constitution XVII). Not one of the four the
  // specification names as the criterion set. It holds the flag because it is
  // in the transitive closure of `organizations`, which is: `organizations`
  // declares `dictionaries`, and `dictionaries` declares this module. The chain
  // fails closed at every link, so switching this off takes the tenancy root
  // down two hops away.
  activation: {
    nonDeactivatable: true,
    reason:
      'Reached from the non-deactivatable `organizations` through `dictionaries`, which ' +
      'declares this module; dependencies fail closed along the whole chain.',
  },
});
