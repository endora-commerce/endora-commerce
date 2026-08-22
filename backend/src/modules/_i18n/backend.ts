import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AdminUserPreferencePort } from '@b2b/contracts';
import { lazyPort, type ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { registerI18nAdminRoutes } from './routes.admin.js';
import { I18nService } from './services/i18n-service.js';
import {
  reconcileBundles,
  type I18nReconcileEntry,
  type I18nReconcileResult,
} from './services/bundle-reconciler.js';

/**
 * `_i18n` — the module whose boot-time work does not run in `ctx.onBoot`
 * (feature 072, wave 1, T089).
 *
 * Seventeen conversions before this one put their boot-time work in
 * `ctx.onBoot`. This one does not, and the reason is worth stating because the
 * natural move is to make it uniform with the other seventeen.
 *
 * This module walks the lifecycle manifest registry to refresh every module's
 * `translation_bundles` rows from disk. It reaches that registry through a lazy
 * accessor, because `_lifecycle`'s orchestrator is constructed *after* it — the
 * chicken-and-egg the original `registry?: T | (() => T | undefined)` option
 * shape exists to break. The reconcile therefore runs from the `ctx.routes`
 * callback, at **plugin attach**, which is the point at which every root has
 * finished composing and the accessor is guaranteed to answer.
 *
 * D-45 made the boot phase the last thing a root does before it builds the
 * server, so `ctx.onBoot` would find the registry today too. The reconcile stays
 * where it is all the same: the two placements are not equivalent in general (a
 * root that composes without building a server runs one and not the other), and
 * the failure mode if the accessor ever answered `undefined` again is silent —
 * the reconciler's documented behaviour for an absent registry is to return
 * `{installed: 0, skipped: 0, failed: 0}`, i.e. success. Every module's
 * translation bundles would quietly stop being refreshed, with no exception and
 * no warning, and the first symptom would be screens rendering raw i18n keys
 * some time after somebody edits a JSON bundle. Moving it therefore needs
 * evidence, not tidiness. `test/unit/_i18n/reconcile-timing.test.ts` pins the
 * placement, because the harness cannot: since issue #158 `setupBackendServer`
 * does pass the resolved registry and this reconcile does run there, but a
 * composed server can only observe that it happened — never that it happened at
 * plugin attach rather than during registration or boot.
 *
 * **The third `AdminUserService` goes away.** `composition.ts` built one
 * specially for this module — `new AdminUserService(em)`, with no audit writer
 * — while `admin_users` built its own with one, and the harness a third.
 * Nothing was being lost: the only method reached from here is
 * `setPreferredLanguage`, which is explicitly marked `command-coverage-ignore`
 * as a personal UI setting rather than an audited mutation. But it is the same
 * shape this wave has now removed six times — an optional constructor argument,
 * silently omitted, defaulting the unsafe way — and resolving the service from
 * the container means there is one of it, and it is the audited one.
 *
 * `deps.orm` was in the option interface and read nowhere in the factory body.
 * It does not reappear here.
 */

/**
 * The slice of the lifecycle registry this module reads: every registered
 * module's manifest and the path it was loaded from, which is all
 * `reconcileBundles` needs to find `<module>/<bundlesDir>/<lang>.json`.
 *
 * Declared here rather than imported from `_lifecycle` (feature 075, Phase C).
 * `lifecycleManifestRegistry` is a name a **composition root** supplies —
 * which modules a deployment ships is a root's input, and `_lifecycle`'s own
 * `LoadedManifestRegistry` additionally carries a dependency graph and each
 * module's install hooks, none of which a bundle reconcile has any business
 * seeing. Stating the demand is what keeps the two apart.
 */
export interface I18nManifestRegistryView {
  readonly modules: { values(): Iterable<I18nReconcileEntry> };
}

/** Reads the lifecycle registry lazily; `undefined` until `_lifecycle` exists. */
export type LifecycleManifestRegistryAccessor = () =>
  | I18nManifestRegistryView
  | undefined;

export interface AdminI18nCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly lifecycleManifestRegistry: LifecycleManifestRegistryAccessor;
  readonly adminI18nService: I18nService;
  readonly adminI18nReconciler: AdminI18nReconciler;
}

/** The lifecycle-orchestrator-shaped hook surface (feature 019 FR-016). */
export interface AdminI18nReconciler {
  install(args: {
    moduleId: string;
    modulePath: string;
    bundlesDir: string;
  }): Promise<{ installed: string[] }>;
  remove(moduleId: string): Promise<{ removed: number }>;
  /** Re-read every module's on-disk bundles without a restart (`i18n:reload`). */
  reloadAll(): Promise<I18nReconcileResult>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'adminI18nService',
    ctx
      .asFunction(
        ({ emFactory }: AdminI18nCradle) => new I18nService({ em: emFactory }),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'adminI18nReconciler',
    ctx
      .asFunction((): AdminI18nReconciler => {
        // Feature 072 (D-38b) — `adminI18nService` is resolved per call, not
        // captured in this factory. It is a `providePort` name, so it is a
        // transient gate; awilix strict mode refuses a **singleton** that
        // captures one, and it refuses it unconditionally — warm registry cache
        // or cold. Destructuring it here therefore threw
        // `AwilixResolutionError: … has a shorter lifetime than its ancestor:
        // 'adminI18nReconciler$ungated$'` at every boot, which is the second
        // half of why the backend would not start.
        const i18n = lazyPort<I18nService>(ctx, 'adminI18nService');
        return {
          install: async ({ moduleId, modulePath, bundlesDir }) => {
            const result = await i18n.installBundlesForModule(
              moduleId,
              modulePath,
              bundlesDir,
            );
            return { installed: result.installed };
          },
          remove: async (moduleId) => i18n.removeBundlesForModule(moduleId),
          // Resolved per call for a second reason as well: `reloadAll` is
          // reachable from the admin endpoint and the CLI at any time after
          // boot, and the registry accessor answers `undefined` until
          // `_lifecycle` is built.
          reloadAll: async () => runReconcile(ctx),
        };
      })
      .singleton(),
  );

  ctx.routes(async (app) => {
    // Plugin attach, not `onBoot` — see the note at the top of this file. This
    // is the point in a composition where the lifecycle registry exists.
    await runReconcile(ctx);

    const { adminI18nService, requireAdmin, adminContextResolver } =
      ctx.cradle<AdminI18nCradle>();
    await registerI18nAdminRoutes(app, {
      i18nService: adminI18nService,
      // Feature 075, Phase C — one method of `admin_users`, resolved per call.
      // The class this replaced brought creation, roles, deletion and
      // impersonation across the boundary for a single language write.
      adminUserPreference: lazyPort<AdminUserPreferencePort>(ctx, 'adminUserPreferencePort'),
      requireAdmin,
      resolveAdminContext: adminContextResolver,
      reload: () => runReconcile(ctx),
    });
  });
}

async function runReconcile(ctx: ModuleContext): Promise<I18nReconcileResult> {
  const { lifecycleManifestRegistry, adminI18nService } = ctx.cradle<AdminI18nCradle>();
  const registry = lifecycleManifestRegistry();
  // Absent registry is a real state, not an error: a composition that never
  // builds `_lifecycle` (several unit tests) still serves the read API, which
  // reads `translation_bundles` directly.
  if (!registry) return { installed: 0, skipped: 0, failed: 0, failures: [] };
  return reconcileBundles(registry.modules.values(), adminI18nService, {
    // `reconcileBundles` takes a plain message logger; the kernel's is
    // pino-shaped, so the message goes in the second position.
    info: (msg) => ctx.log.info({}, msg),
    warn: (msg) => ctx.log.warn({}, msg),
  });
}
