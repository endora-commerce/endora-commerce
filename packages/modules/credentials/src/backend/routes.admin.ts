import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ConfigurationListQuerySchema,
  CreateConfigurationSchema,
  ERROR_CODES,
  UpdateConfigurationSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CREDENTIALS_READ_PERMISSION, CREDENTIALS_WRITE_PERMISSION } from '../manifest.js';
import type { CredentialsService } from './services/credentials.service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin HTTP surface for the credentials module — feature 058
 * (contracts/admin-api.md).
 *
 *   GET    /api/v1/admin/credentials/types
 *   GET    /api/v1/admin/credentials            (?type=)
 *   GET    /api/v1/admin/credentials/:code
 *   POST   /api/v1/admin/credentials
 *   PUT    /api/v1/admin/credentials/:code
 *   DELETE /api/v1/admin/credentials/:code
 *   GET    /api/v1/admin/credentials/:code/preview
 *
 * Reads gated by `credentials:read`, writes by `credentials:write`. Secrets are
 * masked on every read; only the server-side `resolve` (US2) decrypts.
 */

export interface CredentialsRoutesDeps {
  service: CredentialsService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

export async function registerCredentialsAdminRoutes(
  app: FastifyInstance,
  deps: CredentialsRoutesDeps,
): Promise<void> {
  const { service, requireAdmin } = deps;
  const readGuard = requireAdmin(CREDENTIALS_READ_PERMISSION);
  const writeGuard = requireAdmin(CREDENTIALS_WRITE_PERMISSION);

  app.get('/api/v1/admin/credentials/types', { preHandler: readGuard }, async () => ({
    types: service.describeTypes(),
  }));

  app.get('/api/v1/admin/credentials', { preHandler: readGuard }, async (request) => {
    const q = ConfigurationListQuerySchema.parse(request.query ?? {});
    return { configurations: await service.list(q.type) };
  });

  app.get<{ Params: { code: string } }>(
    '/api/v1/admin/credentials/:code',
    { preHandler: readGuard },
    async (request) => {
      const dto = await service.getByCode(request.params.code);
      if (!dto) {
        throw new HttpError(404, ERROR_CODES.CREDENTIAL_NOT_FOUND, 'Configuration not found.');
      }
      return dto;
    },
  );

  // Preview target for the settings-field preview button — same masked shape as
  // GET /:code (documented separately in the contract, served identically).
  app.get<{ Params: { code: string } }>(
    '/api/v1/admin/credentials/:code/preview',
    { preHandler: readGuard },
    async (request) => {
      const dto = await service.getByCode(request.params.code);
      if (!dto) {
        throw new HttpError(404, ERROR_CODES.CREDENTIAL_NOT_FOUND, 'Configuration not found.');
      }
      return dto;
    },
  );

  app.post('/api/v1/admin/credentials', { preHandler: writeGuard }, async (request, reply) => {
    const body = CreateConfigurationSchema.parse(request.body);
    const dto = await service.create(body);
    return reply.code(201).send(dto);
  });

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/credentials/:code',
    { preHandler: writeGuard },
    async (request) => {
      // `typeCode` / `providerCode` are immutable after create (edge case).
      const raw = (request.body ?? {}) as Record<string, unknown>;
      if ('typeCode' in raw || 'providerCode' in raw) {
        throw new HttpError(
          422,
          ERROR_CODES.CREDENTIAL_TYPE_IMMUTABLE,
          'The type and provider cannot be changed after creation — create a new configuration instead.',
        );
      }
      const body = UpdateConfigurationSchema.parse(request.body);
      return service.update(request.params.code, body);
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/credentials/:code',
    { preHandler: writeGuard },
    async (request, reply) => {
      await service.delete(request.params.code);
      return reply.code(204).send();
    },
  );
}
