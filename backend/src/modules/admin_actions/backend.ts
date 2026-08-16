import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { LoadedManifestRegistry } from '../_lifecycle/services/manifest-loader.js';
import type { I18nService } from '../_i18n/services/i18n-service.js';
import type { PermissionService } from '../admin_roles/services/permission-service.js';
import { ModuleAction } from './entities/module-action.entity.js';
import { adminActionsModule, type AdminActionsModuleHandle } from './plugin.js';

/**
 * `admin_actions` — the second module whose reconcile must not move (feature
 * 072, wave 2, T099).
 *
 * This is `_i18n`'s shape repeated, and it is worth naming rather than
 * rediscovering. The module walks the lifecycle manifest registry to refresh
 * every module's palette actions, and reaches that registry through the same
 * lazy accessor, for the same chicken-and-egg reason — `_lifecycle`'s
 * orchestrator is constructed after it. The reconcile therefore runs at
 * **plugin attach**, the point at which every root has finished composing and
 * the accessor is guaranteed to answer, and it stays there.
 *
 * It stays there for `_i18n`'s reason too: neither reconciler treats an absent
 * registry as an error — this one simply walks nothing — so an accessor that
 * answers `undefined` fails silently. Every module's palette actions would stop
 * being refreshed at boot and the first symptom would be a stale ⌘K entry
 * pointing at a route that moved. Moving the reconcile is a change that has to
 * carry its own evidence; uniformity with the other conversions is not it.
 *
 * **`isModuleActivated` stops being optional**, and its absent form is the
 * permissive one. The option's own comment says what that costs: *"Without it
 * the palette keeps offering a deactivated module's actions, which lead to a
 * 503."* An operator switches a module off, its entries stay in ⌘K, and the
 * admin who picks one gets an error rather than an absence. Both roots pass it,
 * so nothing is live; eleventh removal of this shape.
 *
 * `adminActionsReconciler` is a **port** — the lifecycle orchestrator resolves
 * it across a module boundary on install and hard-uninstall.
 */

export const entities = [ModuleAction];

export interface AdminActionsCradle {
  readonly emFactory: () => EntityManager;
  readonly orm: import('@mikro-orm/postgresql').MikroORM;
  readonly redisSubscriber: import('ioredis').Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly adminI18nService: I18nService;
  readonly permissionService: PermissionService;
  /** Reads the lifecycle registry lazily; `undefined` until `_lifecycle` exists. */
  readonly lifecycleManifestRegistry: () => LoadedManifestRegistry | undefined;
  /** The operator presence axis, so the palette hides a deactivated module. */
  readonly moduleActivationProbe: (moduleId: string) => boolean;
  readonly adminActions: { handle: AdminActionsModuleHandle; plugin: unknown };
  readonly adminActionsReconciler: AdminActionsModuleHandle['reconciler'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    adminActions: ctx
      .asFunction(({ orm, emFactory, redisSubscriber }: AdminActionsCradle) =>
        adminActionsModule({
          orm,
          emFactory,
          redisSubscriber,
          permissionService: lazyPort<PermissionService>(ctx, 'permissionService'),
          // The registry accessor, threaded straight through: the module's own
          // reconcile reads it at plugin attach, which is the whole point.
          registry: () => ctx.cradle<AdminActionsCradle>().lifecycleManifestRegistry(),
          i18nService: lazyPort<I18nService>(ctx, 'adminI18nService'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<AdminActionsCradle>().requireAdmin(permission)(req, reply),
          resolveAdminContext: (req) =>
            ctx.cradle<AdminActionsCradle>().adminContextResolver(req),
          isModuleActivated: (moduleId) =>
            ctx.cradle<AdminActionsCradle>().moduleActivationProbe(moduleId),
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'adminActionsReconciler',
    ctx
      .asFunction(({ adminActions }: AdminActionsCradle) => adminActions.handle.reconciler)
      .singleton(),
  );

  ctx.routes(async (app) => {
    const plugin = ctx.cradle<AdminActionsCradle>().adminActions.plugin as (
      a: typeof app,
    ) => Promise<void>;
    // Plugin attach, not `onBoot` — see the note at the top of this file.
    await plugin(app);
  });
}
