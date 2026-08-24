import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import {
  ApiKeyService,
  type ApiKeyBindingPorts,
  type AuthenticatedApiKey,
} from './services/api-key-service.js';
import { registerApiKeysAdminRoutes } from './routes.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the US7 surface — API keys + webhooks.
 * Returns a handle so other modules (e.g. catalog routes.api-key.ts) can
 * consume the api-key gate this builds.
 */

export interface IntegrationsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  auditLogService: AuditPort;
  /**
   * `organizations`' and `customer_accounts`' published reads, which the
   * binding rules B3 and B4 decide on (feature 075, D-87). Both were raw SQL
   * against those modules' tables inside the service.
   */
  bindingPorts: ApiKeyBindingPorts;
  /**
   * Who the acting admin is, from the production actor (feature 080, T051).
   * Threaded through to the admin routes, which used to read
   * `request.testActor` — see `ApiKeysAdminDeps.resolveAdminUserId`.
   */
  resolveAdminUserId: (request: FastifyRequest) => string;
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
  const apiKeyService = new ApiKeyService(
    options.emFactory,
    options.bindingPorts,
    options.auditLogService,
  );

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
      requireApiKey,
      requireBoundApiKey,
    },
    plugin: async (app) => {
      await registerApiKeysAdminRoutes(app, {
        apiKeyService,
        requireAdmin: options.requireAdmin,
        resolveAdminUserId: options.resolveAdminUserId,
      });
    },
  };
}
