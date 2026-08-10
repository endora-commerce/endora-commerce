import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { ApiKeyService, type AuthenticatedApiKey } from './services/api-key-service.js';
import { WebhookService } from '../webhooks/services/webhook-service.js';
import { registerApiKeysAdminRoutes } from './routes.js';
import { registerWebhooksAdminRoutes } from '../webhooks/routes.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the US7 surface — API keys + webhooks.
 * Returns a handle so other modules (e.g. catalog routes.api-key.ts) can
 * consume the api-key gate this builds.
 */

export interface IntegrationsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  auditLogService?: AuditLogService;
}

/**
 * Feature 062 — the resolved binding `requireBoundApiKey` stashes on the
 * request for the distributor services.
 */
export interface ApiKeyRequestBinding {
  apiKeyId: string;
  scopes: string[];
  organizationId: string;
  salesChannelId: string;
  customerAccountId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireBoundApiKey` after a successful binding assertion. */
    apiKeyBinding?: ApiKeyRequestBinding;
  }
}

export interface IntegrationsModuleHandle {
  apiKeyService: ApiKeyService;
  webhookService: WebhookService;
  /**
   * Pre-handler factory that authenticates a Bearer token via ApiKeyService
   * and gates on the requested scope. Used by api-key route surfaces (e.g.
   * the catalog by-sku upsert in routes.api-key.ts) — out-of-scope returns
   * 403 + an audit row tagging the api key (T220).
   */
  requireApiKey: (
    scope: string,
  ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /**
   * Feature 062 — distributor gate: authenticate → scope (audited 403,
   * unchanged) → binding assertion (403 `API_KEY_NOT_BOUND` + audit
   * `api_key.not_bound`) → stash the resolved binding on the request.
   */
  requireBoundApiKey: (
    scope: string,
  ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function integrationsModule(options: IntegrationsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: IntegrationsModuleHandle;
} {
  const apiKeyService = new ApiKeyService(options.emFactory, options.auditLogService);
  const webhookService = new WebhookService(options.emFactory, options.auditLogService);

  // Shared authenticate + scope assertion used by both gates.
  const resolveScopedKey = async (
    request: FastifyRequest,
    scope: string,
  ): Promise<AuthenticatedApiKey> => {
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
    return resolved;
  };

  const requireApiKey =
    (scope: string) => async (request: FastifyRequest): Promise<void> => {
      await resolveScopedKey(request, scope);
    };

  // Feature 062 — distributor gate (contracts/api-key-binding.md §4).
  const requireBoundApiKey =
    (scope: string) => async (request: FastifyRequest): Promise<void> => {
      const resolved = await resolveScopedKey(request, scope);
      if (
        !resolved.organizationId ||
        !resolved.salesChannelId ||
        !resolved.customerAccountId
      ) {
        if (options.auditLogService) {
          await options.auditLogService.record({
            action: 'api_key.not_bound',
            objectType: 'api_key',
            objectId: resolved.apiKeyId,
            stateBefore: null,
            stateAfter: { attemptedScope: scope },
          });
        }
        throw new HttpError(
          403,
          ERROR_CODES.API_KEY_NOT_BOUND,
          'This endpoint requires a distributor-bound API key.',
        );
      }
      request.apiKeyBinding = {
        apiKeyId: resolved.apiKeyId,
        scopes: resolved.scopes,
        organizationId: resolved.organizationId,
        salesChannelId: resolved.salesChannelId,
        customerAccountId: resolved.customerAccountId,
      };
    };

  return {
    handle: {
      apiKeyService,
      webhookService,
      requireApiKey,
      requireBoundApiKey,
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
    },
  };
}
