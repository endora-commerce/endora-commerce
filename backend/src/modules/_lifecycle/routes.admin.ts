import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ModuleListQuerySchema,
  ModuleListResponseSchema,
  apiInterceptorListSchema,
  type ApiInterceptorList,
  type ModuleListResponse,
} from '@b2b/contracts';
import type { ApiInterceptorRegistry } from '../../http/interceptors/index.js';
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

export interface ApiInterceptorAdminDeps {
  registry: ApiInterceptorRegistry;
  requireAdmin: RequireAdminFactory;
}

/**
 * Feature 060 — read-only diagnostics for the API interceptor mechanism.
 * The response IS the execution plan: items sorted by target, then phase
 * (pre before post), then execution order. `moduleEnabled` is resolved live
 * from the enabled-set predicate at request time. Registrations are shipped
 * module code, so there is no write surface (and no Command Bus involvement).
 */
export function registerApiInterceptorAdminRoutes(
  app: FastifyInstance,
  deps: ApiInterceptorAdminDeps,
): void {
  app.get(
    '/api/v1/admin/api-interceptors',
    {
      preHandler: deps.requireAdmin('platform.modules.read'),
      schema: { response: { 200: apiInterceptorListSchema } },
    },
    async (): Promise<ApiInterceptorList> => ({
      items: deps.registry.list().map((item) => ({
        ...item,
        moduleEnabled: deps.registry.isModuleEnabled(item.module),
      })),
    }),
  );
}
