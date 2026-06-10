import type { FastifyInstance } from 'fastify';
import { ClearCacheRequestSchema } from '@b2b/contracts';
import type { RequireAdminFactory } from './plugin.js';
import type { CacheAdminService } from './services/cache-admin.service.js';

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

  app.post(
    '/api/v1/admin/cache/clear',
    { preHandler: requireAdmin('settings:write') },
    async (request) => {
      const body = ClearCacheRequestSchema.parse(request.body ?? {});
      const result = await cacheAdminService.clear(body.namespaces);
      return { data: result };
    },
  );
}
