import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { AdminNotificationService } from './services/admin-notification-service.js';
import { NotificationNotFoundError } from './services/admin-notification-service.js';

const listQuerySchema = z.object({
  unread: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().optional(),
});

export interface AdminNotificationsRoutesDeps {
  adminNotificationService: AdminNotificationService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Routes for the admin notification bell (feature 026, US1).
 *
 * The list endpoint resolves per-admin `isRead` by joining
 * `admin_notification_reads` for `audience='all_admins'` rows. Read state
 * for `audience='admin_user'` lives directly on the notification row.
 */
export async function registerAdminNotificationsRoutes(
  app: FastifyInstance,
  deps: AdminNotificationsRoutesDeps,
): Promise<void> {
  const { adminNotificationService, requireAdmin } = deps;
  const gate = requireAdmin('admin:read');

  app.get('/api/v1/admin/notifications', { preHandler: gate }, async (request) => {
    const actor = request.actor;
    if (actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    const query = listQuerySchema.parse(request.query);
    const page = await adminNotificationService.listForAdmin({
      adminUserId: actor.adminUserId,
      unread: query.unread,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return {
      items: page.items.map((it) => ({
        id: it.id,
        audience: it.audience,
        kind: it.kind,
        subjectType: it.subjectType,
        subjectId: it.subjectId,
        title: it.title,
        body: it.body,
        linkPath: it.linkPath,
        createdAt: it.createdAt.toISOString(),
        isRead: it.isRead,
      })),
      nextCursor: page.nextCursor,
      unreadCount: page.unreadCount,
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/notifications/:id/read',
    { preHandler: gate },
    async (request, reply) => {
      const actor = request.actor;
      if (actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      try {
        await adminNotificationService.markRead(request.params.id, actor.adminUserId);
      } catch (err) {
        if (err instanceof NotificationNotFoundError) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Notification not found.');
        }
        throw err;
      }
      reply.status(204).send();
    },
  );

  app.post('/api/v1/admin/notifications/mark-all-read', { preHandler: gate }, async (request) => {
    const actor = request.actor;
    if (actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    const markedCount = await adminNotificationService.markAllRead(actor.adminUserId);
    return { markedCount };
  });
}
