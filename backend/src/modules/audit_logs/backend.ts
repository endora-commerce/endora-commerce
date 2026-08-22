import type { AuditReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import { ModuleDisabledError } from '../../kernel/lifecycle/plugin-helpers.js';
import type { AuditActorIdentity } from './routes.admin.js';
import { registerAuditLogAdminRoutes } from './routes.admin.js';
import { registerRecentActivityRoutes } from './routes.admin.recent-activity.js';
import { AuditReferenceRegistry } from './services/audit-reference-registry.js';
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
 * `AuditPort` is what every module writes through — and what is left here
 * is the *reading* half, which is this module's own.
 *
 * **`auditActorResolver` is a contribution, not a dependency**, and the
 * distinction is the whole design of this file. Turning a bare actor id into a
 * name and an e-mail needs `admin_users`, but needing it for a *column* is not
 * the same as needing it to function. So the name is owned and defaulted here,
 * a composition root that ships `admin_users` overrides it, and the manifest
 * declares no edge — because a `dependencies` entry would make the lifecycle
 * refuse to disable `admin_users` while the audit log is on, which is precisely
 * backwards.
 *
 * **What that buys, exactly — D-102.** The enrichment degrades and the *record*
 * does not: with `admin_users` absent the audit rows still render, with raw
 * actor ids in the actor column. That is a claim about this module's own
 * handler and it stops there. The **route** is guarded by `requireAdmin`, whose
 * permission check reads `adminUserReadPort` since feature 075 Phase C, so on a
 * deployment that does not ship `admin_users` no admin-authenticated request
 * reaches this handler at all. Reading the trail when the admin identity
 * subsystem is itself absent needs a surface that is not an admin-authenticated
 * HTTP route: `pnpm --filter backend run audit:read`, whose credential is
 * access to the host rather than a session.
 *
 * This paragraph used to say that "an operator investigating an incident wants
 * the record more, not less, when part of the platform is off". The sentiment
 * is right and the module could not deliver it over HTTP; the withdrawal is
 * recorded rather than quietly narrowed, because the interesting content of
 * that sentence was the part that turned out to be false.
 *
 * The root registers a **gated** resolver, since deciding what "`admin_users`
 * is present" means is a composition-root question, not one this module should
 * answer by hard-coding another module's id. When `admin_users` converts it
 * publishes the resolver itself and the root's entry disappears.
 */

export interface AuditLogsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly auditActorResolver:
    | ((ids: string[]) => Promise<AuditActorIdentity[]>)
    | undefined;
  readonly auditReferenceRegistry: AuditReferenceRegistryPort;
  readonly recentActivityService: RecentActivityService;
}

export function registerModule(ctx: ModuleContext): void {
  /**
   * Turning an actor id into a name, through the contribution point above.
   *
   * One closure, two readers — the audit-log list and the dashboard card — so
   * there is exactly one place that decides what an absent directory means, and
   * exactly one `catch` for a reviewer to check. The dashboard card used to
   * decide it for itself, by running `select … from admin_users` (feature 075,
   * D-87).
   */
  const resolveActors = async (ids: string[]): Promise<AuditActorIdentity[]> => {
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
  };

  ctx.di.register({
    /**
     * Who can turn one of *their* ids into a name and a link (feature 075,
     * D-87). A **contribution seam**, so a plain `ctx.di.register`: contributors
     * push from their own boot hooks, and a gate here would refuse them at a
     * point in the boot where there is nothing to answer.
     *
     * The presence predicate is this module's enumeration policy — skip — and it
     * is asked per read rather than per registration, so an operator's flip
     * takes effect without a restart.
     */
    auditReferenceRegistry: ctx
      .asFunction(
        (): AuditReferenceRegistryPort =>
          new AuditReferenceRegistry((moduleId) => effectiveState.isPresent(moduleId)),
      )
      .singleton(),

    recentActivityService: ctx
      .asFunction(
        ({ emFactory, auditReferenceRegistry }: AuditLogsCradle) =>
          new RecentActivityService(emFactory, resolveActors, auditReferenceRegistry),
      )
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
      resolveActors,
    });

    await registerRecentActivityRoutes(app, { recentActivityService, requireAdmin });
  });
}
