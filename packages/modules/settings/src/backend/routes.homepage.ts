import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
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
    // The id, not the code: the channel is already resolved, and handing the
    // resolver a code made it re-resolve one (feature 075 / D-87).
    const salesChannelId = getResolvedChannel(request).id;
    const data = await deps.homepageResolver.resolve(salesChannelId);
    return { data };
  });
}
