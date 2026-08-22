import type { EntityManager } from '@mikro-orm/postgresql';
import { defineModuleManifest, type ModuleLifecycleParticipant } from '@b2b/contracts';

/**
 * Admin UI i18n subsystem — feature 019.
 *
 * Platform-internal module (underscore-prefixed exemption per Constitution
 * Principle VI, alongside `auth` / `example` / `_lifecycle`). Owns the
 * `translation_bundles` table, the per-language merged-bundle resolver,
 * the read API consumed by the admin SPA at boot, and the `core`
 * namespace that holds admin-chrome strings (AppShell, navigation,
 * login, profile).
 *
 * Depends on `_lifecycle` because every module's bundle install / hard-
 * uninstall is driven by the lifecycle orchestrator's hook surface.
 */
export const manifest = defineModuleManifest({
  id: '_i18n',
  name: 'Admin UI i18n',
  description:
    "Per-user Admin UI language preference and module-scoped translation bundles. " +
    'English is the platform-wide fallback (FR-013 / FR-016).',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port every route here is gated by;
  // `admin_users` owns the service the preferred-language setter writes through.
  // Neither depends back on this module, so the graph stays acyclic.
  dependencies: ['_lifecycle', 'auth', 'admin_users'],
  i18n: { bundlesDir: 'i18n' },
  // Feature 074 (Constitution XVII), test C1 — reachability. Two grounds hold
  // and they are stated in that order because only the first is about this
  // module's merits: every user-facing string on every surface resolves here,
  // including the labels on `/platform/modules`, so switching it off would
  // leave an operator unable to read the screen that switches it back on. The
  // `_`-prefix rule is the structural second: an `_`-prefixed id is
  // platform-internal and `assertActivationRules`
  // (`packages/contracts/src/modules.ts`) refuses any other activation form
  // for one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Every user-facing string on every surface is served from here, including the labels ' +
      'on the platform screen that holds the module switches.',
  },
});

/**
 * `translation_bundles` follows the manifest set — feature 080, T036a / D-159.
 *
 * Not an install hook: an install hook fires for *its own* module, and this has
 * to run whenever **any** module is installed, because this module's table is a
 * projection of every other module's `manifest.i18n` declaration. Not a port
 * either: the lifecycle orchestrator also serves the five `module:*` commands,
 * and a platform command composes no container to resolve one from (D-157.2 /
 * D-157.4) — which is exactly how a terminal install came to write no bundle at
 * all while the same install from `/platform/modules` wrote them.
 *
 * The service is imported at call time, not at module load. This file is
 * imported by the generated manifest index, which is in turn imported by every
 * static check script and by `src/db/configured-migrations.ts`; a static import
 * of `I18nService` would pull an ORM-dependent graph into all of them.
 *
 * A fresh `I18nService` per call is correct and not a lost cache:
 * `getMergedBundleForLanguage` revalidates against `MAX(version)` in the table
 * on every read, so the running server picks the new rows up on its next
 * request without having been the instance that wrote them.
 */
export const lifecycleParticipant: ModuleLifecycleParticipant<EntityManager> = {
  async onModuleInstalled({ moduleId, manifest: installed, modulePath, em }) {
    // The declaration belongs to the module being installed, so the decision
    // is this one's to make: a manifest with no `i18n` block ships no bundle.
    if (!installed.i18n) return;
    const { I18nService } = await import('./services/i18n-service.js');
    await new I18nService({ em: () => em }).installBundlesForModule(
      moduleId,
      modulePath,
      installed.i18n.bundlesDir,
      em,
    );
  },
  async onModuleHardUninstalled({ moduleId, em }) {
    // Unconditional, and deliberately not gated on the manifest's `i18n`
    // block: the manifest is `null` for an orphan row whose module this
    // instance no longer has, and that is the one case whose rows nothing
    // else will ever remove.
    const { I18nService } = await import('./services/i18n-service.js');
    await new I18nService({ em: () => em }).removeBundlesForModule(moduleId, em);
  },
};
