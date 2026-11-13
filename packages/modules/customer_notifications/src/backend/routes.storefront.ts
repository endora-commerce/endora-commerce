import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getResolvedChannel, type RequireCustomerGuard } from '@endora-commerce/platform/kernel';
// The `request.actor` and `request.responseLanguage()` augmentations are the
// platform's; a side-effect import of the `./http` barrel is how they reach
// this package's program.
import '@endora-commerce/platform/http';
import type { CustomerNotificationService, NotificationReader } from './services/customer-notification-service.js';

/**
 * The centre's storefront API
 * (`specs/179-rfq-and-customer-notifications/contracts/customer-notifications-storefront-api.md` §1).
 *
 * Registered through `ctx.routes`, so every route answers the platform's
 * `503 MODULE_DISABLED` while the module is off; guarded by `requireCustomer`,
 * which answers `401` before anything else for a caller who is not a signed-in
 * buyer; and every answer is `private, no-store` — the entries are one
 * person's, and the count changes exactly when that person acts.
 */

export interface CustomerNotificationsStorefrontRoutesDeps {
  /** Read per request: the service is the module's own singleton, resolved lazily. */
  readonly service: () => CustomerNotificationService;
  readonly requireCustomer: RequireCustomerGuard;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

const PRIVATE = 'private, no-store';

export async function registerCustomerNotificationsStorefrontRoutes(
  app: FastifyInstance,
  deps: CustomerNotificationsStorefrontRoutesDeps,
): Promise<void> {
  const guarded = { preHandler: deps.requireCustomer };

  app.get('/api/v1/storefront/notifications', guarded, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const data = await deps.service().list(await readerOf(request), {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return privately(reply).send({ data });
  });

  app.get('/api/v1/storefront/notifications/unread-count', guarded, async (request, reply) => {
    const unreadCount = await deps.service().unreadCount(await readerOf(request));
    return privately(reply).send({ data: { unreadCount } });
  });

  // Read-only: one entry under the list's visibility, for the storefront's open
  // route to learn the link it redirects to. It marks nothing.
  app.get<{ Params: { id: string } }>('/api/v1/storefront/notifications/:id', guarded, async (request, reply) => {
    const data = await deps.service().get(await readerOf(request), request.params.id);
    return privately(reply).send({ data });
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/storefront/notifications/:id/read',
    guarded,
    async (request, reply) => {
      await deps.service().markRead(await readerOf(request), request.params.id);
      return privately(reply).code(204).send();
    },
  );

  app.post('/api/v1/storefront/notifications/read-all', guarded, async (request, reply) => {
    const data = await deps.service().markAllRead(await readerOf(request));
    return privately(reply).send({ data });
  });
}

function privately(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', PRIVATE);
}

/** The reader behind a request `requireCustomer` has already admitted. */
async function readerOf(request: FastifyRequest): Promise<NotificationReader> {
  const actor = request.actor;
  if (actor.kind !== 'customer') {
    // Unreachable behind `requireCustomer`; a guard that admitted a non-customer
    // is a wiring defect, and answering for nobody would be worse than failing.
    throw new Error('customer_notifications: a storefront route was reached without a signed-in customer');
  }
  return {
    customerAccountId: actor.customerAccountId,
    organizationId: actor.organizationId,
    salesChannelId: getResolvedChannel(request).id,
    language: await request.responseLanguage(),
    impersonating: actor.impersonatorAdminUserId !== null && actor.impersonatorAdminUserId !== undefined,
  };
}
