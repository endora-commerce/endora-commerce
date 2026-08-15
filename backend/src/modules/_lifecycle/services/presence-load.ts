import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@b2b/contracts';
import { ModuleRegistration } from '../entities/module-registration.entity.js';
import { activationDeclarationsFrom } from './activation-resolver.js';
import { installGatingGraph } from './gating-graph.js';
import { registryCache } from './registry-cache.js';

/**
 * The composition step that gives module presence an answer (feature 072,
 * D-38).
 *
 * It used to live in `_lifecycle`'s Fastify plugin body, which runs inside
 * `buildServer` — after `composeApp()` has registered every module and run every
 * boot hook. Eleven boot hooks resolve a gated port, so they all asked a cache
 * nothing had loaded, all got "not installed", and the first one reached threw
 * `ModuleCompositionError` before the process could listen. The ordering was the
 * bug; the cache, the gate and the composer were each doing exactly their job.
 *
 * So this is called from the composition root **before the first module
 * registers**, and it is awaited and fatal: it needs the EntityManager factory
 * and the manifest list, and both exist long before the early pass composes.
 * Redis is not involved — arming the notification channel is
 * `registryCache.watch()`, which happens after composition and cannot fail a
 * boot.
 *
 * It lives under `_lifecycle` rather than in `src/kernel/` because the cache
 * does, and the kernel may not import from `src/modules/`
 * (`check-kernel-boundary.ts`). D-37 relocates the whole presence machinery into
 * the kernel; the call site is already where it needs to be.
 */
export async function loadModulePresence(opts: {
  em: () => EntityManager;
  /** Every manifest this deployment ships — core registry plus overlay modules. */
  manifests: readonly ModuleManifest[];
}): Promise<void> {
  await reconcileExistingModules(opts.em, opts.manifests);
  // Feature 073 (T045/T046) — the graph the flip-time refusals read. Installed
  // from the same manifest list as the activation declarations, so an overlay
  // module's edges count for a refusal exactly as a core module's do (FR-027).
  installGatingGraph(opts.manifests);
  await registryCache.load({
    em: opts.em,
    // Feature 073 — the operator-activation axis. Declarations come from the
    // shipped manifests, so there is no hand-maintained list: a module that
    // declares no control is governed by the platform axis alone.
    activationDeclarations: activationDeclarationsFrom(opts.manifests),
  });
}

/**
 * First-boot reconciler — idempotent.
 *
 * For every shipped manifest with NO row in `module_registrations`, inserts one
 * with `state='installed'`. This lets feature 018 land on a running platform
 * without breaking the gating wrappers (`defineModuleRoutes`,
 * `defineModuleWorker`, `subscribeForModule`) — pre-existing modules continue
 * serving traffic because their auto-created row marks them
 * installed-and-enabled.
 *
 * Modules added AFTER feature 018 ships go through the explicit
 * `module:install <id>` flow.
 */
async function reconcileExistingModules(
  emFactory: () => EntityManager,
  manifests: readonly ModuleManifest[],
): Promise<void> {
  const em = emFactory();
  const existing = await em.find(ModuleRegistration, {});
  const existingIds = new Set(existing.map((r) => r.moduleId));
  const now = new Date();
  for (const manifest of manifests) {
    if (existingIds.has(manifest.id)) continue;
    em.create(ModuleRegistration, {
      moduleId: manifest.id,
      state: 'installed',
      version: manifest.version,
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
  }
  await em.flush();
}
