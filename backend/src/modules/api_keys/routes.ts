import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createApiKeyRequestSchema } from '@endora-commerce/contracts';
import type { ApiKeyService } from './services/api-key-service.js';
import type { ApiKey } from './entities/api-key.entity.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface ApiKeysAdminDeps {
  apiKeyService: ApiKeyService;
  requireAdmin: RequireAdminFactory;
  /**
   * The acting admin's id, resolved from the request the guard in front of
   * these routes has already accepted.
   *
   * Injected rather than read here, because the read used to be
   * `testAdminUserId(request)` — `http/test-actor-carrier`, which
   * `contracts/host-package.md` §1.4j classifies **A**: the file exists to
   * narrow this repository's test-harness Fastify augmentation, and an
   * installed package has no relationship to that harness. It also answered
   * `undefined` in production for every request, because nothing under `src/`
   * writes `request.testActor`.
   *
   * Both composition roots supply it from `adminContextResolver`, which reads
   * the production actor and throws 401 for a non-admin. Every call site sits
   * behind `requireAdmin(...)`, so the actor is an admin by the time it runs.
   */
  resolveAdminUserId: (request: FastifyRequest) => string;
}

export async function registerApiKeysAdminRoutes(
  app: FastifyInstance,
  deps: ApiKeysAdminDeps,
): Promise<void> {
  const { apiKeyService, requireAdmin, resolveAdminUserId } = deps;

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
      const result = await apiKeyService.create({
        name: body.name,
        scopes: body.scopes,
        ...(body.binding !== undefined ? { binding: body.binding } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
        createdByAdminUserId: resolveAdminUserId(request),
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
