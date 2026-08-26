import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listQuerySchema, upsertFeedDeliveryRequestSchema } from '@endora-commerce/contracts';
import { PRODUCT_FEEDS_READ_PERMISSION, PRODUCT_FEEDS_WRITE_PERMISSION } from '../manifest.js';
import { parseOrThrow } from './routes.admin.js';
import type { DeliveryConfigService } from './services/delivery/delivery-config.service.js';
import type { DeliveryService } from './services/delivery/delivery.service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Delivery admin surface — feature 070.
 *
 *   GET    /api/v1/admin/product-feeds/:id/delivery
 *   PUT    /api/v1/admin/product-feeds/:id/delivery
 *   DELETE /api/v1/admin/product-feeds/:id/delivery
 *   POST   /api/v1/admin/product-feeds/:id/delivery/test
 *   GET    /api/v1/admin/product-feeds/:id/delivery/attempts
 *
 * **The read is `:read`; every write and the test are `:write`** — SR-1. A
 * read-only administrator can see where a feed is delivered and whether the
 * partner got today's file, which is the question they are most often asked, and
 * cannot change the target or make this platform open a connection. That split
 * is also what AS-7 asserts: the admin renders the controls present-but-disabled
 * with a reason, rather than hiding a target that exists.
 *
 * The read is safe at `:read` because nothing on `FeedDeliveryConfig` is a
 * secret — passwords, keys and authenticating headers are booleans on that shape
 * by construction (FR-107).
 *
 * A separate file from `routes.admin.ts` because delivery is a separable
 * capability: it is the surface that would be dropped whole if a deployment
 * never pushed a feed anywhere.
 *
 * Every async handler `return`s its reply — `inject()` masks a missing return;
 * over a real socket the same handler crash-loops with `ERR_HTTP_HEADERS_SENT`.
 */

export interface ProductFeedsDeliveryRoutesDeps {
  requireAdmin: RequireAdminFactory;
  config: DeliveryConfigService;
  delivery: DeliveryService;
}

const idParamsSchema = z.object({ id: z.string().uuid() });

export async function registerProductFeedsDeliveryRoutes(
  app: FastifyInstance,
  deps: ProductFeedsDeliveryRoutesDeps,
): Promise<void> {
  const read = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION) };
  const write = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_WRITE_PERMISSION) };

  app.get('/api/v1/admin/product-feeds/:id/delivery', read, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    // `null` rather than a 404: "this feed has no delivery configured" is a
    // state the screen renders, not an error it reports.
    return reply.send({ data: await deps.config.view(id) });
  });

  app.put('/api/v1/admin/product-feeds/:id/delivery', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(upsertFeedDeliveryRequestSchema, request.body ?? {});
    return reply.send({ data: await deps.config.upsert(id, body) });
  });

  app.delete('/api/v1/admin/product-feeds/:id/delivery', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    await deps.config.remove(id);
    return reply.status(204).send();
  });

  // FR-106 — proves reachability and authentication, delivers no artefact, and
  // is rate-limited per feed so it cannot become a general-purpose request tool
  // (SR-5). The refusal path is inside `DeliveryService.test`.
  app.post('/api/v1/admin/product-feeds/:id/delivery/test', write, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return reply.send({ data: await deps.delivery.test(id) });
  });

  app.get('/api/v1/admin/product-feeds/:id/delivery/attempts', read, async (request, reply) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const query = parseOrThrow(listQuerySchema, request.query ?? {});
    const attempts = await deps.delivery.listAttempts(id, query.limit);
    return reply.send({
      data: attempts,
      pagination: { cursor: null, hasMore: false, limit: query.limit },
    });
  });
}
