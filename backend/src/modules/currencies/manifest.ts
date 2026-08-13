import { defineModuleManifest } from '@b2b/contracts';

/**
 * Currencies module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'currencies',
  name: 'Currencies',
  description:
    'Currency reference data and per-channel currency configuration.',
  version: '1.0.0',
  // Deliberately empty. `currencies` announces a change on the EventBus and
  // `dictionaries` reacts by dropping its caches — a **notification**, not a
  // query, which `contracts/module-context.md` says needs no dependency edge.
  // Declaring one produced a real cycle (dictionaries → currencies →
  // dictionaries) and the cycle was the design telling us the direction was
  // wrong: a currency has no business knowing a dictionary cache exists.
  dependencies: [],
});
