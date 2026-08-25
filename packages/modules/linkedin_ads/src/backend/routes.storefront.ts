import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { LinkedInConfigService } from './services/linkedin-config.service.js';

export interface LinkedInAdsStorefrontDeps {
  configService: LinkedInConfigService;
}

/**
 * Public storefront routes for the LinkedIn Ads module (feature 063). Wrapped by
 * `defineModuleRoutes` in plugin.ts so they 503 when the module is disabled.
 * Channel comes from the shared sales-channel resolver.
 */
export async function registerLinkedInAdsStorefrontRoutes(
  app: FastifyInstance,
  deps: LinkedInAdsStorefrontDeps,
): Promise<void> {
  // Per-channel public config for the browser. Never returns the access token.
  app.get('/api/v1/storefront/linkedin-ads/config', async (request, reply) => {
    const channel = getResolvedChannel(request);
    const config = await deps.configService.getConfig(channel.id);
    return reply.send({ data: config });
  });
}
