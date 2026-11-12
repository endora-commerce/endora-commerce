import type { MfaDeactivationGuardPort, MfaEnrolmentCountPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '../kernel/index.js';
import { lazyPort } from '../kernel/index.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { CommandHookRegistry } from '../commands/hooks/registry.js';
import { startCommandOutboxDrain } from '../commands/outbox/drain-worker.js';
import { PostgresOutboxStore } from '../commands/outbox/store.js';
import { registerApiDescriptionRoutes } from './routes.api-description.js';
import { registerPlatformInfoRoutes } from '../http/platform-info.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';
import {
  registerApiInterceptorAdminRoutes,
  registerCommandHookAdminRoutes,
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
 * gated route down mid-run. So the orchestrator is a contribution, and the
 * module list mounts only where one exists. `composeApp` makes it for every
 * deployment — the reference one and a scaffolded instance alike — and the
 * harness, which composes by hand, makes none.
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
   * The composition's command-hook registry (176 P2), registered by both roots
   * beside `commandBus`. Read only when the root registered it: a composition
   * that wires no hooks serves no execution plan.
   */
  readonly commandHookRegistry?: CommandHookRegistry;
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
   * Contribution point, filled by `composeApp`: absent in a composition that
   * boots no orchestrator — the test harness, and nothing an operator runs — and
   * the module list is then not served. The projections still are — rendering a
   * correct navigation must not depend on being able to install anything.
   */
  readonly lifecycleOrchestrator: LifecycleAdminDeps['orchestrator'] | undefined;
  /** The scoped-EM factory every root registers with the ORM. */
  readonly emFactory: () => EntityManager;
  /** Whether this process runs queue consumers; read only when the root registered it. */
  readonly processRunsWorkers?: boolean;
  /** The connection a consumer is built on; read only when the root registered it. */
  readonly moduleQueueRedis?: Redis | undefined;
}

/**
 * Start the command outbox drain (`specs/176-command-hooks-outbox/` P3,
 * research R-18) where this process runs workers and the root offers a queue
 * connection and a command-hook registry. `_lifecycle` is the platform's
 * resident, non-deactivatable module, so `ctx.worker` gives the consumer the
 * platform's shutdown and reconcile path without it ever being switched off
 * with a feature. Per-row presence is the **handler's** module's, decided
 * inside the drain.
 *
 * Each value is asked of the container rather than resolved, because the roots
 * differ in what they register: the shared test server registers no queue
 * connection and runs no worker, and a root with no registry has no handler
 * to deliver to.
 */
async function startOutboxDrain(ctx: ModuleContext, app: FastifyInstance): Promise<void> {
  const cradle = ctx.cradle<LifecycleCradle>();
  if (!('commandHookRegistry' in cradle) || !('processRunsWorkers' in cradle) || !('moduleQueueRedis' in cradle)) {
    return;
  }
  await startCommandOutboxDrain({
    processRunsWorkers: cradle.processRunsWorkers === true,
    moduleQueueRedis: cradle.moduleQueueRedis,
    store: new PostgresOutboxStore(cradle.emFactory),
    handlers: cradle.commandHookRegistry as CommandHookRegistry,
    log: ctx.log,
    attach: (worker) => ctx.worker(worker, { logger: app.log }),
    onClose: (close) => {
      app.addHook('onClose', close);
    },
  });
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

      // `'commandHookRegistry' in cradle` asks the container rather than
      // resolving: a root that wires no hooks registers no registry.
      if ('commandHookRegistry' in cradle) {
        registerCommandHookAdminRoutes(app, {
          registry: cradle.commandHookRegistry as CommandHookRegistry,
          requireAdmin: cradle.requireAdmin,
        });
      }

      registerModulePresenceRoutes(app, {
        requireAdmin: cradle.requireAdmin,
        activation: cradle.lifecycleActivationPropagation,
        // The one live datum on the deactivation-confirmation screen: how many
        // people hold a second factor. `mfa` owns `mfa_enrolments`, so it
        // answers the question rather than this surface querying its table.
        // The route probes `mfa`'s presence before it calls — the count is read
        // while the module is still on, which is what the dialog is for.
        mfaEnrolmentCount: lazyPort<MfaEnrolmentCountPort>(ctx, 'mfaEnrolmentCountPort'),
        // Asked before `mfa` is switched off: a switch-off while administrators
        // are required to use a second factor is refused, so the requirement
        // is turned off as its own change first.
        mfaDeactivationGuard: lazyPort<MfaDeactivationGuardPort>(ctx, 'mfaDeactivationGuardPort'),
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

  // The command outbox drain's consumer and schedule. Attached where `app.log`
  // exists, as every worker in the tree is — this is where a
  // `BACKEND_ROLE=worker` process reaches too.
  ctx.routes(async (app) => {
    await startOutboxDrain(ctx, app);
  });

  ctx.ungatedRoutes(
    'Which release this platform is: a fact about the platform itself, read by the admin ' +
      'header on every screen. There is no module whose absence should take it away, and ' +
      'gating it on this one would blank the version exactly when an operator is being asked ' +
      'for it.',
    (app) => {
      registerPlatformInfoRoutes(app, {
        requireAdmin: ctx.cradle<LifecycleCradle>().requireAdmin,
      });
    },
  );

  ctx.ungatedRoutes(
    'The API description: a fact about the platform itself, generated from every route this ' +
      'server registered. No module owns it, and gating it on one would take the description ' +
      'of every other module away with it. Who reads it is decided by its own permission, ' +
      'platform.api_description.read, not by module presence.',
    (app) => {
      registerApiDescriptionRoutes(app, {
        requireAdmin: ctx.cradle<LifecycleCradle>().requireAdmin,
        document: () => app.apiDescription(),
      });
    },
  );
}
