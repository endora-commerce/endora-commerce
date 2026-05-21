import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminNotificationService } from './services/admin-notification-service.js';
import { registerAdminNotificationsRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Composition root for the admin_notifications module.
 *
 * The service is exposed on the handle so other modules (organizations,
 * inventory, quote_requests, …) can write entries by injection without
 * reaching across module boundaries. The admin routes are mounted lazily
 * via `plugin(app)` and are gated by the existing admin-permission factory.
 */
export interface AdminNotificationsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Cap of unread per audience before older entries auto-archive. Default 50. */
  maxUnreadPerAudience?: number;
}

export interface AdminNotificationsModuleHandle {
  adminNotificationService: AdminNotificationService;
}

export function adminNotificationsModule(options: AdminNotificationsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: AdminNotificationsModuleHandle;
} {
  const adminNotificationService = new AdminNotificationService(options.emFactory, {
    maxUnreadPerAudience: options.maxUnreadPerAudience ?? 50,
  });

  return {
    handle: { adminNotificationService },
    plugin: async (app: FastifyInstance): Promise<void> => {
      await registerAdminNotificationsRoutes(app, {
        adminNotificationService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
