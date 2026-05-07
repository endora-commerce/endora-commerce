import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ModuleListQuerySchema,
  ModuleListResponseSchema,
  type ModuleListResponse,
} from '@b2b/contracts';
import type { ModuleLifecycleOrchestrator } from './services/orchestrator.js';

/**
 * Read-only admin surface for the lifecycle subsystem (feature 018 / E-1).
 *
 * v1 ships ONLY this GET endpoint — mutating operations stay CLI-only
 * (per `contracts/admin-http.md` E-2 deferred). The admin app can
 * render an "Installed Modules" panel from this response and surface
 * orphan / pending-upgrade flags as warnings.
 */

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface LifecycleAdminDeps {
  orchestrator: ModuleLifecycleOrchestrator;
  requireAdmin: RequireAdminFactory;
}

export async function registerLifecycleAdminRoutes(
  app: FastifyInstance,
  deps: LifecycleAdminDeps,
): Promise<void> {
  app.get<{ Querystring: { state?: string; flag?: string } }>(
    '/api/v1/admin/modules',
    {
      preHandler: deps.requireAdmin('platform.modules.read'),
      schema: {
        querystring: ModuleListQuerySchema,
        response: { 200: ModuleListResponseSchema },
      },
    },
    async (request): Promise<ModuleListResponse> => {
      const query = ModuleListQuerySchema.parse(request.query);
      const all = await deps.orchestrator.status();
      let modules = all;
      if (query.state) {
        modules = modules.filter((m) => m.state === query.state);
      }
      if (query.flag) {
        modules = modules.filter((m) => m.flags.includes(query.flag!));
      }
      return { modules };
    },
  );
}
