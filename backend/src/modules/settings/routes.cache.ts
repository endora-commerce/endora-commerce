import type { FastifyInstance } from 'fastify';
import { ClearCacheRequestSchema } from '@endora-commerce/contracts';
import type { CacheAdminService } from './services/cache-admin.service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin cache-maintenance routes — lets an operator flush selected Redis cache
 * namespaces from the Admin UI so content / settings changes appear without
 * waiting for TTL expiry.
 *
 *   GET  /api/v1/admin/cache/namespaces  — list clearable namespaces
 *   POST /api/v1/admin/cache/clear       — clear selected (or all) namespaces
 *
 * Gated by `settings:write` — clearing caches is a privileged maintenance
 * action on par with editing platform settings.
 */
export interface SettingsCacheDeps {
  cacheAdminService: CacheAdminService;
  requireAdmin: RequireAdminFactory;
}

export async function registerSettingsCacheRoutes(
  app: FastifyInstance,
  deps: SettingsCacheDeps,
): Promise<void> {
  const { cacheAdminService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/cache/namespaces',
    { preHandler: requireAdmin('settings:write') },
    async () => ({
      data: cacheAdminService.listNamespaces(),
      cacheEnabled: cacheAdminService.enabled,
    }),
  );

  // Per-route ceiling on top of the global one in `http/server.ts`. Clearing
  // leaves both cache layers cold platform-wide, so every subsequent setting
  // read goes to PostgreSQL until they refill — cheap queries, but the
  // connection pool is the scarce resource, and it is what a repeated clear
  // exhausts. A human pressing the button a few times while diagnosing stays
  // well inside this; a script in a loop does not, which is the case worth
  // stopping.
  const rateLimit = { max: 6, timeWindow: '1 minute' };

  app.post(
    '/api/v1/admin/cache/clear',
    { preHandler: requireAdmin('settings:write'), config: { rateLimit } },
    async (request) => {
      const body = ClearCacheRequestSchema.parse(request.body ?? {});
      const result = await cacheAdminService.clear(body.namespaces);
      return { data: result };
    },
  );
}
