import type { MfaEnrolmentCountPort } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { ApiInterceptorRegistry } from '../../http/interceptors/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import {
  registerApiInterceptorAdminRoutes,
  registerLifecycleAdminRoutes,
  registerModulePresenceRoutes,
  type LifecycleAdminDeps,
  type ModulePresenceAdminDeps,
} from './routes.admin.js';
import { registerModulePresenceStorefrontRoutes } from './routes.storefront.js';

/**
 * `_lifecycle` — the module remainder, after the wrappers and the registry
 * became kernel-owned (feature 072, wave 2, T125).
 *
 * What converts is the **route half**: the presence projections, the activation
 * write, the interceptor admin screen and the module list. The orchestrator does
 * not, and the reason is not squeamishness — it is the one collaborator whose
 * absence is a real composition, not a degraded one. The test harness runs no
 * orchestrator on purpose: it never populates `module_registrations`, and a
 * refresh from the database would blank the seeded enabled-set and take every
 * gated route down mid-run. So the orchestrator is a contribution a root makes,
 * and the module list mounts only where one exists.
 *
 * **Every route here is ungated, and that is the point of the module.** Gating
 * the presence projection on `_lifecycle`'s own presence is the circle D-36 was
 * decided to break: an operator who has switched something off reaches
 * `/platform/modules` to switch it back on, and that screen must answer when
 * the rest of the platform does not. `routes.admin.ts` already said as much in
 * a comment ("registered outside `defineModuleRoutes`"); `ctx.ungatedRoutes`
 * makes it a declaration with a reason attached rather than an omission.
 *
 * Both roots mounted these by hand — production through
 * `lifecycleModuleFromStaticEntries`, the harness through three direct calls
 * with its own propagation shape. That divergence is what this file removes:
 * the routes are registered once, and what differs between compositions is
 * named (`lifecycleActivationPropagation`, `lifecycleOrchestrator`).
 */

/** What `_lifecycle` resolves from the container, and the names it owns. */
export interface LifecycleCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly apiInterceptors: ApiInterceptorRegistry;
  /**
   * How a committed activation flip reaches the rest of the deployment:
   * refreshing local state, publishing to other processes, dropping the
   * storefront's cache. Root-shaped because the harness refreshes through the
   * cache seam rather than the database — see the note above.
   */
  readonly lifecycleActivationPropagation: NonNullable<
    ModulePresenceAdminDeps['activation']
  >;
  /**
   * Contribution point: absent in a composition that boots no orchestrator, and
   * the module list is then not served. The projections still are — rendering a
   * correct navigation must not depend on being able to install anything.
   */
  readonly lifecycleOrchestrator: LifecycleAdminDeps['orchestrator'] | undefined;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, absent by default: no orchestrator, no module list.
    lifecycleOrchestrator: ctx
      .asFunction((): LifecycleCradle['lifecycleOrchestrator'] => undefined)
      .singleton(),
  });

  ctx.ungatedRoutes(
    'The module presence projection and the activation write: an operator reaches ' +
      '/platform/modules precisely when something is switched off, so gating this surface on ' +
      "this module's own presence is the circle D-36 exists to break — including the case " +
      'where the module that is off is this one.',
    async (app) => {
      const cradle = ctx.cradle<LifecycleCradle>();

      registerApiInterceptorAdminRoutes(app, {
        registry: cradle.apiInterceptors,
        requireAdmin: cradle.requireAdmin,
      });

      registerModulePresenceRoutes(app, {
        requireAdmin: cradle.requireAdmin,
        activation: cradle.lifecycleActivationPropagation,
        // The one live datum on the deactivation-confirmation screen: how many
        // people hold a second factor. `mfa` owns `mfa_enrolments`, so it
        // answers the question rather than this surface querying its table.
        // The route probes `mfa`'s presence before it calls — the count is read
        // while the module is still on, which is what the dialog is for.
        mfaEnrolmentCount: lazyPort<MfaEnrolmentCountPort>(ctx, 'mfaEnrolmentCountPort'),
      });

      registerModulePresenceStorefrontRoutes(app);

      const orchestrator = ctx.cradle<LifecycleCradle>().lifecycleOrchestrator;
      if (orchestrator !== undefined) {
        await registerLifecycleAdminRoutes(app, {
          orchestrator,
          requireAdmin: cradle.requireAdmin,
        });
      }
    },
  );
}
