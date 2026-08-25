import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { SpeculationRulesResolver } from './services/speculation-rules-resolver.js';

/**
 * Public storefront read for the Speculation Rules configuration.
 *
 *   GET /api/v1/storefront/speculation-rules
 *
 * Resolves the `storefront.speculation_rules.*` settings for the request's
 * sales channel (from `x-sales-channel`, falling back to the system-default
 * channel). Returns `{ enabled, eagerness }`; a settings hiccup falls back to
 * enabled + 'moderate' inside the resolver so a public page never 500s.
 */
export async function registerSettingsSpeculationRulesRoutes(
  app: FastifyInstance,
  deps: { speculationRulesResolver: SpeculationRulesResolver },
): Promise<void> {
  app.get('/api/v1/storefront/speculation-rules', async (request) => {
    // The id, not the code: the channel is already resolved, and handing the
    // resolver a code made it re-resolve one (feature 075 / D-87).
    const salesChannelId = getResolvedChannel(request).id;
    const data = await deps.speculationRulesResolver.resolve(salesChannelId);
    return { data };
  });
}
