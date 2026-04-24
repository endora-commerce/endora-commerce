import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { SessionService } from './services/session-service.js';
import type { Session } from './entities/session.entity.js';

/**
 * Authentication plugin. Resolves the caller's identity into one of four forms and
 * exposes pre-handler factories that gate routes.
 *
 * See research.md R-11, R-12 and contracts/README.md § Authentication.
 */

export type ActorAnonymous = { kind: 'anonymous' };
export type ActorCustomer = {
  kind: 'customer';
  customerAccountId: string;
  /** Non-null when the request is a Supplier employee acting on behalf of a Customer. */
  impersonatorAdminUserId: string | null;
  session: Session;
};
export type ActorAdmin = {
  kind: 'admin';
  adminUserId: string;
  session: Session;
};
export type ActorApiKey = {
  kind: 'api_key';
  apiKeyId: string;
  scopes: string[];
};
export type Actor = ActorAnonymous | ActorCustomer | ActorAdmin | ActorApiKey;

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export interface AuthPluginOptions {
  sessionService: SessionService;
  /** Resolves an API key bearer token to an ApiKey actor. Installed by the api_keys module. */
  apiKeyResolver?: (token: string) => Promise<{ apiKeyId: string; scopes: string[] } | null>;
  /** Cookie name used to carry sessions. */
  cookieName?: string;
}

export const SESSION_COOKIE_NAME = 'b2b_session';

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const cookieName = opts.cookieName ?? SESSION_COOKIE_NAME;

  app.decorateRequest('actor', { kind: 'anonymous' } satisfies ActorAnonymous);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // 1. API key (Bearer) beats cookie — integrations pass Authorization: Bearer ...
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && opts.apiKeyResolver) {
      const token = authHeader.slice('Bearer '.length).trim();
      const resolved = await opts.apiKeyResolver(token);
      if (resolved) {
        request.actor = { kind: 'api_key', ...resolved };
        return;
      }
      // Unknown bearer token — leave as anonymous; route-level guards will reject.
      return;
    }

    // 2. Cookie → session lookup.
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.[cookieName];
    if (!raw) return;
    const resolved = await opts.sessionService.loadSession(raw);
    if (!resolved) return;

    const session = resolved.session;
    if (resolved.kind === 'admin' && session.adminUserId) {
      request.actor = { kind: 'admin', adminUserId: session.adminUserId, session };
      return;
    }
    if (resolved.kind === 'impersonation' && session.customerAccountId) {
      request.actor = {
        kind: 'customer',
        customerAccountId: session.customerAccountId,
        impersonatorAdminUserId: session.impersonatorAdminUserId ?? null,
        session,
      };
      return;
    }
    if (resolved.kind === 'customer' && session.customerAccountId) {
      request.actor = {
        kind: 'customer',
        customerAccountId: session.customerAccountId,
        impersonatorAdminUserId: null,
        session,
      };
    }
  });

  // Gate factories — routes use these as preHandlers.
  app.decorate('requireCustomer', () => requireCustomer);
  app.decorate('requireAdmin', (permission?: string) => requireAdmin(permission));
  app.decorate('requireApiKey', (scope: string) => requireApiKey(scope));
}

export const authPlugin = fastifyPlugin(authPluginImpl, {
  name: 'b2b-auth',
  fastify: '5.x',
});

declare module 'fastify' {
  interface FastifyInstance {
    requireCustomer: () => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (permission?: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireApiKey: (scope: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function requireCustomer(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.actor.kind !== 'customer') {
    throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
  }
  return Promise.resolve();
}

function requireAdmin(permission?: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (request.actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    if (permission) {
      // Permission matrix lookup is wired by the admin_users module in US4; for now we accept
      // any admin. The real check replaces this function body in T188.
      return;
    }
  };
}

function requireApiKey(scope: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (request.actor.kind !== 'api_key') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'API key required.');
    }
    if (!request.actor.scopes.includes(scope)) {
      throw new HttpError(403, ERROR_CODES.API_KEY_OUT_OF_SCOPE, `API key lacks required scope: ${scope}.`);
    }
  };
}
