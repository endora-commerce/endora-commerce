import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { ModulePresenceProbe } from './services/admin-actions-service.js';
import {
  adminActionsModule,
  type AdminActionsManifestRegistryView,
  type AdminActionsModuleHandle,
} from './plugin.js';

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
 * **The presence probe stops being optional**, and its absent form is the
 * permissive one. The option's own comment says what that costs: *"Without it
 * the palette keeps offering a deactivated module's actions, which lead to a
 * 503."* An operator switches a module off, its entries stay in ⌘K, and the
 * admin who picks one gets an error rather than an absence. Both roots pass it,
 * so nothing is live; eleventh removal of this shape.
 *
 * Issue #225 — it carries the presence **version** alongside the reading, in
 * one value, because the service memoises what the reading produced and needs
 * to know when the reading moved. A root that supplied one without the other
 * would give the palette a snapshot it can never drop.
 *
 * `adminActionsReconciler` is a **port**, and since feature 080's T036a it is
 * one with no consumer here: the lifecycle orchestrator reaches this module's
 * reconcile through the `lifecycleParticipant` declared in `manifest.ts`. See
 * the note on `AdminActionsModuleHandle.reconciler` in `plugin.ts`.
 */

export interface AdminActionsCradle {
  readonly emFactory: () => EntityManager;
  readonly orm: import('@mikro-orm/postgresql').MikroORM;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly adminI18nService: AdminI18nTranslatePort;
  readonly permissionService: PermissionReadPort;
  /** Reads the lifecycle registry lazily; `undefined` until `_lifecycle` exists. */
  readonly lifecycleManifestRegistry: () => AdminActionsManifestRegistryView | undefined;
  /**
   * The operator presence axis and its generation, so the palette hides a
   * deactivated module and stops serving a snapshot built before it was.
   */
  readonly modulePresenceProbe: ModulePresenceProbe;
  readonly adminActions: { handle: AdminActionsModuleHandle; plugin: unknown };
  readonly adminActionsReconciler: AdminActionsModuleHandle['reconciler'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    adminActions: ctx
      .asFunction(({ orm, emFactory }: AdminActionsCradle) =>
        adminActionsModule({
          orm,
          emFactory,
          // Feature 075, Phase C — `admin_roles`' published permission read,
          // resolved per call so a switched-off `admin_roles` answers 503 at
          // the call rather than through a gate frozen at composition time.
          permissionService: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
          // The registry accessor, threaded straight through: the module's own
          // reconcile reads it at plugin attach, which is the whole point.
          registry: () => ctx.cradle<AdminActionsCradle>().lifecycleManifestRegistry(),
          // Feature 075, Phase C — `_i18n`'s published resolver. One method of
          // it: the palette renders a label and a description per action.
          i18nService: lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<AdminActionsCradle>().requireAdmin(permission)(req, reply),
          resolveAdminContext: (req) =>
            ctx.cradle<AdminActionsCradle>().adminContextResolver(req),
          presence: {
            isActivated: (moduleId) =>
              ctx.cradle<AdminActionsCradle>().modulePresenceProbe.isActivated(moduleId),
            version: () => ctx.cradle<AdminActionsCradle>().modulePresenceProbe.version(),
          },
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
