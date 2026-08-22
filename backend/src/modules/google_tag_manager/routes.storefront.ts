import type { FastifyInstance } from 'fastify';
import { gtmCollectRequestSchema } from '@endora-commerce/contracts';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { GtmConfigService } from './services/gtm-config.service.js';
import type { GtmCollectEnqueuer } from './services/ss-relay-queue.js';

export interface GoogleTagManagerStorefrontDeps {
  configService: GtmConfigService;
  /** Producer that enqueues server-side relay jobs (US3). Absent ⇒ 503. */
  enqueueRelay?: GtmCollectEnqueuer;
}

/**
 * Public storefront routes for the Google Tag Manager module (feature 066).
 * Wrapped by `defineModuleRoutes` in plugin.ts so they 503 when the module is
 * disabled. The sales channel comes from the shared resolver middleware
 * (Principle XII) — never from the request body.
 */
export async function registerGoogleTagManagerStorefrontRoutes(
  app: FastifyInstance,
  deps: GoogleTagManagerStorefrontDeps,
): Promise<void> {
  app.get('/api/v1/storefront/google-tag-manager/config', async (request, reply) => {
    const channel = getResolvedChannel(request);
    const config = await deps.configService.getConfig(channel.id);
    return reply.send({ data: config });
  });

  // Server-side relay ingest — producer only (Principle X): validate → enqueue
  // → 202. Nothing is forwarded inside the shopper's request (FR-029).
  app.post('/api/v1/storefront/google-tag-manager/collect', async (request, reply) => {
    if (!deps.enqueueRelay) {
      return reply.status(503).send({
        error: {
          code: 'server_side_unavailable',
          message: 'Server-side tagging is not available.',
        },
      });
    }
    const channel = getResolvedChannel(request);
    // The schema is the enforcement point for the closed event allow-list: an
    // event name outside it is a 400 and is never enqueued (FR-024 / FR-025).
    const body = gtmCollectRequestSchema.parse(request.body);
    // Read from the connection and the headers, never from the body — a client
    // must not be able to nominate someone else's IP or user agent.
    const userAgent = request.headers['user-agent'];
    const accepted = await deps.enqueueRelay(channel.id, body, {
      ...(request.ip ? { ip: request.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
    return reply.status(202).send({ data: { accepted } });
  });
}
