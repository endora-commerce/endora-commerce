import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminNotificationService } from './services/admin-notification-service.js';
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
    plugin: async (_app: FastifyInstance): Promise<void> => {
      // Routes are registered by a follow-up task (US1 T043) once the
      // admin route gate factory and Zod request schemas are in place.
      // The handle is already usable by other modules at this point.
    },
  };
}
