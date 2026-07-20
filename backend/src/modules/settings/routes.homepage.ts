import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '../sales_channels/middleware/sales-channel-resolver.js';
import type { HomepageResolver } from './services/homepage-resolver.js';

/**
 * Public storefront read for the home-page configuration.
 *
 *   GET /api/v1/storefront/homepage
 *
 * Returns the CMS page slug an operator selected as the home page for the
 * request's sales channel (from `x-sales-channel`, falling back to the
 * system-default channel), or null when none is configured.
 */
export async function registerSettingsHomepageRoutes(
  app: FastifyInstance,
  deps: { homepageResolver: HomepageResolver },
): Promise<void> {
  app.get('/api/v1/storefront/homepage', async (request) => {
    const salesChannelCode = getResolvedChannel(request).code;
    const data = await deps.homepageResolver.resolve(salesChannelCode);
    return { data };
  });
}
