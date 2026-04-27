import type { FastifyInstance } from 'fastify';
import {
  createIntegrationRequestSchema,
  updateIntegrationRequestSchema,
} from '@b2b/contracts';
import type { IntegrationService } from './services/integration-service.js';
import type { ExternalIntegration } from './entities/external-integration.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface IntegrationsAdminDeps {
  integrationService: IntegrationService;
  requireAdmin: RequireAdminFactory;
}

export async function registerIntegrationsAdminRoutes(
  app: FastifyInstance,
  deps: IntegrationsAdminDeps,
): Promise<void> {
  const { integrationService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/integrations',
    { preHandler: requireAdmin('integrations:manage') },
    async () => {
      const rows = await integrationService.list();
      return { data: rows.map(serializeIntegration) };
    },
  );

  app.post(
    '/api/v1/admin/integrations',
    {
      preHandler: requireAdmin('integrations:manage'),
      schema: { body: createIntegrationRequestSchema },
    },
    async (request, reply) => {
      const body = createIntegrationRequestSchema.parse(request.body);
      const adminId =
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : undefined;
      const row = await integrationService.create({
        name: body.name,
        vendor: body.vendor,
        kind: body.kind,
        config: body.config,
        ...(adminId !== undefined ? { createdByAdminUserId: adminId } : {}),
      });
      // Run testConnection synchronously — surfaces immediate errors and
      // either flips status to 'active' or marks the row 'error' with
      // lastError populated. Per T223.
      const test = await integrationService.testConnection(row.id);
      reply.status(201);
      return {
        data: {
          ...serializeIntegration(await integrationService.getById(row.id)),
          testResult: {
            ok: test.ok,
            status: test.status,
            testedAt: test.testedAt.toISOString(),
            message: test.message ?? null,
          },
        },
      };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/integrations/:id',
    {
      preHandler: requireAdmin('integrations:manage'),
      schema: { body: updateIntegrationRequestSchema },
    },
    async (request) => {
      const body = updateIntegrationRequestSchema.parse(request.body);
      const row = await integrationService.update(request.params.id, body);
      return { data: serializeIntegration(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/integrations/:id',
    { preHandler: requireAdmin('integrations:manage') },
    async (request, reply) => {
      await integrationService.remove(request.params.id);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/integrations/:id/test',
    { preHandler: requireAdmin('integrations:manage') },
    async (request) => {
      const result = await integrationService.testConnection(request.params.id);
      return {
        data: {
          ok: result.ok,
          status: result.status,
          testedAt: result.testedAt.toISOString(),
          message: result.message ?? null,
        },
      };
    },
  );
}

function serializeIntegration(i: ExternalIntegration): Record<string, unknown> {
  return {
    id: i.id,
    name: i.name,
    vendor: i.vendor,
    kind: i.kind,
    status: i.status,
    lastTestedAt: i.lastTestedAt?.toISOString() ?? null,
    lastError: i.lastError ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
