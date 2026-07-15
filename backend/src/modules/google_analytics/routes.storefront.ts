import type { FastifyInstance } from 'fastify';
import { gaCollectRequestSchema } from '@b2b/contracts';
import { getResolvedChannel } from '../sales_channels/middleware/sales-channel-resolver.js';
import type { GaConfigService } from './services/ga-config.service.js';
import type { GaCollectEnqueuer } from './services/ss-delivery-queue.js';

export interface GoogleAnalyticsStorefrontDeps {
  configService: GaConfigService;
  /** Producer that enqueues server-side delivery jobs (US4). Absent ⇒ 503. */
  enqueueCollect?: GaCollectEnqueuer;
}

/**
 * Public storefront routes for the Google Analytics module (feature 049).
 * Wrapped by `defineModuleRoutes` in plugin.ts so they 503 when the module is
 * disabled. Channel is resolved from the `X-Sales-Channel` header by the shared
 * sales-channel-resolver middleware.
 */
export async function registerGoogleAnalyticsStorefrontRoutes(
  app: FastifyInstance,
  deps: GoogleAnalyticsStorefrontDeps,
): Promise<void> {
  // Per-channel public config for the browser. Never returns the API secret.
  app.get('/api/v1/storefront/google-analytics/config', async (request, reply) => {
    const channel = getResolvedChannel(request);
    const config = await deps.configService.getConfig(channel.id);
    return reply.send({ data: config });
  });

  // Server-side collect — producer only (Principle X): validate → enqueue → 202.
  app.post('/api/v1/storefront/google-analytics/collect', async (request, reply) => {
    if (!deps.enqueueCollect) {
      return reply.status(503).send({
        error: { code: 'server_side_unavailable', message: 'Server-side tagging is not available.' },
      });
    }
    const channel = getResolvedChannel(request);
    const body = gaCollectRequestSchema.parse(request.body);
    const accepted = await deps.enqueueCollect(channel.id, body);
    return reply.status(202).send({ data: { accepted } });
  });
}
