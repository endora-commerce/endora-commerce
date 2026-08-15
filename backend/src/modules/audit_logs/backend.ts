import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { ModuleDisabledError } from '../../kernel/lifecycle/plugin-helpers.js';
import type { AuditActorIdentity } from './routes.admin.js';
import { registerAuditLogAdminRoutes } from './routes.admin.js';
import { registerRecentActivityRoutes } from './routes.admin.recent-activity.js';
import { RecentActivityService } from './services/recent-activity-service.js';

/**
 * `audit_logs` — the compliance surface that was a passenger (feature 072,
 * wave 1, T084).
 *
 * The module owned two route files and a service and registered none of them.
 * `admin_users/plugin.ts` imported both route modules, constructed
 * `RecentActivityService` itself and mounted the lot inside its own plugin, so
 * the audit log existed for exactly as long as the admin-users module happened
 * to be composed. Its service and entity moved to the kernel in T016 —
 * `AuditLogService` is what every module writes through — and what is left here
 * is the *reading* half, which is this module's own.
 *
 * **`auditActorResolver` is a contribution, not a dependency**, and the
 * distinction is the whole design of this file. Turning a bare actor id into a
 * name and an e-mail needs `admin_users`, but needing it for a *column* is not
 * the same as needing it to function: an operator investigating an incident
 * wants the record more, not less, when part of the platform is off. So the
 * name is owned and defaulted here, a composition root that ships `admin_users`
 * overrides it, and the manifest declares no edge — because a `dependencies`
 * entry would make the lifecycle refuse to disable `admin_users` while the
 * audit log is on, which is precisely backwards.
 *
 * The root registers a **gated** resolver, since deciding what "`admin_users`
 * is present" means is a composition-root question, not one this module should
 * answer by hard-coding another module's id. When `admin_users` converts it
 * publishes the resolver itself and the root's entry disappears.
 */

export interface AuditLogsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly auditActorResolver:
    | ((ids: string[]) => Promise<AuditActorIdentity[]>)
    | undefined;
  readonly recentActivityService: RecentActivityService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    recentActivityService: ctx
      .asFunction(({ emFactory }: AuditLogsCradle) => new RecentActivityService(emFactory))
      .singleton(),

    // Contribution point, defaulted to absent by its owner. A deployment
    // without `admin_users` reads the audit log with raw actor ids rather than
    // failing to read it.
    auditActorResolver: ctx
      .asFunction((): ((ids: string[]) => Promise<AuditActorIdentity[]>) | undefined => undefined)
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { auditLogService, recentActivityService, requireAdmin } =
      ctx.cradle<AuditLogsCradle>();

    await registerAuditLogAdminRoutes(app, {
      auditLogService,
      requireAdmin,
      // Resolved per request, and per request is what makes the degradation
      // work: a contributor captured once would keep naming actors long after
      // its module went away.
      resolveActors: async (ids) => {
        const resolve = ctx.cradle<AuditLogsCradle>().auditActorResolver;
        if (resolve === undefined) return [];
        try {
          return await resolve(ids);
        } catch (error) {
          // The enrichment is optional; the record is not. Anything else is
          // a real failure and must not be swallowed into a blank column.
          if (error instanceof ModuleDisabledError) return [];
          throw error;
        }
      },
    });

    await registerRecentActivityRoutes(app, { recentActivityService, requireAdmin });
  });
}
