import type { FastifyInstance } from 'fastify';
import { createApiKeyRequestSchema } from '@b2b/contracts';
import type { ApiKeyService } from './services/api-key-service.js';
import type { ApiKey } from './entities/api-key.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface ApiKeysAdminDeps {
  apiKeyService: ApiKeyService;
  requireAdmin: RequireAdminFactory;
}

export async function registerApiKeysAdminRoutes(
  app: FastifyInstance,
  deps: ApiKeysAdminDeps,
): Promise<void> {
  const { apiKeyService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/api-keys',
    { preHandler: requireAdmin('integrations:manage') },
    async () => {
      const rows = await apiKeyService.list();
      return { data: rows.map(serializeApiKey) };
    },
  );

  app.post(
    '/api/v1/admin/api-keys',
    {
      preHandler: requireAdmin('integrations:manage'),
      schema: { body: createApiKeyRequestSchema },
    },
    async (request, reply) => {
      const body = createApiKeyRequestSchema.parse(request.body);
      const adminId =
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : undefined;
      const result = await apiKeyService.create({
        name: body.name,
        scopes: body.scopes,
        ...(body.binding !== undefined ? { binding: body.binding } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
        ...(adminId !== undefined ? { createdByAdminUserId: adminId } : {}),
      });
      reply.status(201);
      return {
        data: {
          apiKey: serializeApiKey(result.apiKey),
          bearerToken: result.bearerToken,
        },
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/api-keys/:id',
    { preHandler: requireAdmin('integrations:manage') },
    async (request, reply) => {
      await apiKeyService.revoke(request.params.id);
      return reply.status(204).send();
    },
  );
}

function serializeApiKey(a: ApiKey): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    lastFour: a.lastFour,
    scopes: a.scopes,
    status: a.status,
    lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
    revokedAt: a.revokedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    // Feature 062 — additive binding/expiry fields (null for unbound keys).
    organizationId: a.organizationId ?? null,
    salesChannelId: a.salesChannelId ?? null,
    customerAccountId: a.customerAccountId ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
  };
}
