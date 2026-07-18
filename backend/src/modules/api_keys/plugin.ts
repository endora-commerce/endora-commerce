import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { ApiKeyService } from './services/api-key-service.js';
import { WebhookService } from '../webhooks/services/webhook-service.js';
import { IntegrationService } from '../integrations/services/integration-service.js';
import { registerApiKeysAdminRoutes } from './routes.js';
import { registerWebhooksAdminRoutes } from '../webhooks/routes.js';
import { registerIntegrationsAdminRoutes } from '../integrations/routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';

/**
 * Composition root for the US7 surface — API keys + webhooks + integrations.
 * Returns a handle so other modules (e.g. catalog routes.api-key.ts) can
 * consume the api-key gate this builds.
 */

export interface IntegrationsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  auditLogService?: AuditLogService;
}

export interface IntegrationsModuleHandle {
  apiKeyService: ApiKeyService;
  webhookService: WebhookService;
  integrationService: IntegrationService;
  /**
   * Pre-handler factory that authenticates a Bearer token via ApiKeyService
   * and gates on the requested scope. Used by api-key route surfaces (e.g.
   * the catalog by-sku upsert in routes.api-key.ts) — out-of-scope returns
   * 403 + an audit row tagging the api key (T220).
   */
  requireApiKey: (
    scope: string,
  ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function integrationsModule(options: IntegrationsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: IntegrationsModuleHandle;
} {
  const apiKeyService = new ApiKeyService(options.emFactory, options.auditLogService);
  const webhookService = new WebhookService(options.emFactory, options.auditLogService);
  const integrationService = new IntegrationService(options.emFactory, options.auditLogService);

  const requireApiKey =
    (scope: string) => async (request: FastifyRequest): Promise<void> => {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'API key required.');
      }
      const token = header.slice('Bearer '.length).trim();
      const resolved = await apiKeyService.authenticate(token);
      if (!resolved) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'API key is invalid or revoked.');
      }
      if (!resolved.scopes.includes(scope)) {
        if (options.auditLogService) {
          await options.auditLogService.record({
            action: 'api_key.out_of_scope',
            objectType: 'api_key',
            objectId: resolved.apiKeyId,
            stateBefore: null,
            stateAfter: { attemptedScope: scope, grantedScopes: resolved.scopes },
          });
        }
        throw new HttpError(
          403,
          ERROR_CODES.API_KEY_OUT_OF_SCOPE,
          `API key lacks the required scope: ${scope}.`,
        );
      }
    };

  return {
    handle: {
      apiKeyService,
      webhookService,
      integrationService,
      requireApiKey,
    },
    plugin: async (app) => {
      await registerApiKeysAdminRoutes(app, {
        apiKeyService,
        requireAdmin: options.requireAdmin,
      });
      await registerWebhooksAdminRoutes(app, {
        webhookService,
        requireAdmin: options.requireAdmin,
      });
      await registerIntegrationsAdminRoutes(app, {
        integrationService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
