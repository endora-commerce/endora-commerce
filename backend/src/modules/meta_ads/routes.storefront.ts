import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { MetaConfigService } from './services/meta-config.service.js';

export interface MetaAdsStorefrontDeps {
  configService: MetaConfigService;
}

/**
 * Public storefront routes for the Meta Ads module (feature 064). Wrapped by
 * `defineModuleRoutes` in plugin.ts so they 503 when the module is disabled.
 */
export async function registerMetaAdsStorefrontRoutes(
  app: FastifyInstance,
  deps: MetaAdsStorefrontDeps,
): Promise<void> {
  app.get('/api/v1/storefront/meta-ads/config', async (request, reply) => {
    const channel = getResolvedChannel(request);
    const config = await deps.configService.getConfig(channel.id);
    return reply.send({ data: config });
  });
}
