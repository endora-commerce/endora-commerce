import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminNotificationRecordPort } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerAdminNotificationsRoutes } from './routes.admin.js';
import { AdminNotificationService } from './services/admin-notification-service.js';
import { createAdminNotificationRecordPort } from './services/admin-notification-port.js';
import { AdminNotificationRead } from './entities/admin-notification-read.entity.js';
import { AdminNotification } from './entities/admin-notification.entity.js';

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
  /**
   * Feature 075, Phase P — the one method the one cross-module consumer calls.
   *
   * `organizations` records a notification when a new organisation registers.
   * The module's other four methods are its own admin surface — listing,
   * marking read, archiving, counting — and stay unpublished. The adapter
   * exists because `record` answers with the `AdminNotification` entity, and a
   * port answers with a record.
   */
  ctx.di.providePort<AdminNotificationRecordPort>(
    'adminNotificationRecordPort',
    ctx
      .asFunction(() =>
        createAdminNotificationRecordPort(
          () => ctx.cradle<AdminNotificationsCradle>().adminNotificationService,
        ),
      )
      .singleton(),
  );

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

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  AdminNotificationRead,
  AdminNotification,
];
