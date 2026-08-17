import type { EntityManager } from '@mikro-orm/postgresql';
import { lazyPort, type ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { registerAdminNotificationsRoutes } from './routes.admin.js';
import { AdminNotificationService } from './services/admin-notification-service.js';

/**
 * `admin_notifications` — a module four other modules write into (feature 072,
 * wave 1).
 *
 * `organizations`, `inventory`, `quote_requests` and the moderation wiring all
 * hold `adminNotificationService`, which is why it is a **port**: the write is
 * a cross-module call, so it answers on this module's effective state instead
 * of succeeding into a module the operator switched off. What that buys is
 * narrow and worth stating — an operator who turns notifications off stops
 * accumulating rows nobody will read, rather than filling a table whose surface
 * is gone.
 *
 * The unread cap stays a constant rather than a setting. It is a storage
 * guard, not an operator preference, and nothing in the tree ever passed a
 * value other than the default.
 */

/** Cap of unread entries per audience before older ones auto-archive. */
const MAX_UNREAD_PER_AUDIENCE = 50;

export interface AdminNotificationsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminNotificationService: AdminNotificationService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'adminNotificationService',
    ctx
      .asFunction(
        ({ emFactory }: AdminNotificationsCradle) =>
          new AdminNotificationService(emFactory, {
            maxUnreadPerAudience: MAX_UNREAD_PER_AUDIENCE,
          }),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { requireAdmin } = ctx.cradle<AdminNotificationsCradle>();
    await registerAdminNotificationsRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40).
      adminNotificationService: lazyPort<AdminNotificationService>(
        ctx,
        'adminNotificationService',
      ),
      requireAdmin,
    });
  });
}
