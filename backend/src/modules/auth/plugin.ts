import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } from '@b2b/contracts';
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
  /**
   * Resolved fresh from the CustomerAccount when the auth plugin has an
   * emFactory. Nullable post-feature-026 — guest-style Customer accounts
   * have no Organization and fall back to platform defaults. Order
   * placement and RFQ submission still require a non-null organizationId.
   */
  organizationId: string | null;
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
  /**
   * Feature 062 — distributor binding, resolved by ApiKeyService.authenticate.
   * All three are set for a bound key, all null/absent for a legacy unbound
   * key. The tenant-context hook derives single-org scope from them and the
   * sales-channel resolver pins the channel (fail closed on header mismatch).
   */
  organizationId?: string | null;
  salesChannelId?: string | null;
  customerAccountId?: string | null;
};
export type Actor = ActorAnonymous | ActorCustomer | ActorAdmin | ActorApiKey;

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    /** Admin session resolved from the dedicated admin cookie, if any. */
    adminActor: ActorAdmin | null;
  }
}

export interface AuthPluginOptions {
  sessionService: SessionService;
  /** Resolves an API key bearer token to an ApiKey actor. Installed by the api_keys module. */
  apiKeyResolver?: (token: string) => Promise<{
    apiKeyId: string;
    scopes: string[];
    organizationId?: string | null;
    salesChannelId?: string | null;
    customerAccountId?: string | null;
  } | null>;
  /**
   * Resolves a customerAccountId to the customer's `organizationId`. Used to
   * stamp `actor.organizationId` for customer + impersonation sessions so
   * route handlers don't have to re-fetch the CustomerAccount per request.
   */
  customerOrgResolver?: (customerAccountId: string) => Promise<string | null>;
  /** Cookie name used to carry customer (storefront) sessions. */
  cookieName?: string;
  /** Cookie name used to carry admin (Admin UI) sessions. */
  adminCookieName?: string;
}

/**
 * Customer (storefront) sessions live in `b2b_session`; admin (Admin UI)
 * sessions live in a **separate** `b2b_admin_session` cookie. Using two distinct
 * cookie names lets a customer stay signed in on the storefront while an admin is
 * signed in on the Admin UI in the same browser — on a shared host (e.g. all
 * `localhost` ports) a single cookie name would clobber the other on every login.
 *
 * The two spellings moved to `@b2b/contracts` in feature 075's Phase P: they are
 * constants, not behaviour, and five modules set or clear the cookie. They are
 * re-exported from here so the consumers Phase C has not reached yet keep
 * resolving them at this path.
 */
export { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME };

/**
 * If the request carries a valid admin session (resolved into `request.adminActor`
 * by the auth plugin) but its ambient `request.actor` is not already an admin,
 * promote the admin candidate. Admin guards call this so an admin route works
 * even when a customer session is simultaneously present on the same request.
 */
export function promoteAdminActor(request: FastifyRequest): void {
  const r = request as FastifyRequest & { adminActor?: ActorAdmin | null };
  if (request.actor.kind !== 'admin' && r.adminActor) {
    request.actor = r.adminActor;
  }
}

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const cookieName = opts.cookieName ?? SESSION_COOKIE_NAME;
  const adminCookieName = opts.adminCookieName ?? ADMIN_SESSION_COOKIE_NAME;

  // Fastify 5 forbids reference-type defaults on decorateRequest (they'd be
  // shared across requests). Use a getter / setter pair backed by a
  // per-request symbol so each request gets its own slot; the onRequest
  // hook below seeds the value.
  const actorSlot = Symbol('b2b-auth.actor');
  app.decorateRequest('actor', {
    getter(): Actor {
      const self = this as unknown as Record<symbol, Actor | undefined>;
      return self[actorSlot] ?? { kind: 'anonymous' };
    },
    setter(value: Actor): void {
      (this as unknown as Record<symbol, Actor>)[actorSlot] = value;
    },
  });

  // Admin session candidate, resolved from the admin cookie independently of the
  // customer actor so both can coexist on one request.
  const adminActorSlot = Symbol('b2b-auth.adminActor');
  app.decorateRequest('adminActor', {
    getter(): ActorAdmin | null {
      const self = this as unknown as Record<symbol, ActorAdmin | null | undefined>;
      return self[adminActorSlot] ?? null;
    },
    setter(value: ActorAdmin | null): void {
      (this as unknown as Record<symbol, ActorAdmin | null>)[adminActorSlot] = value;
    },
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Initialise to anonymous; downstream branches may overwrite with a
    // typed customer / admin / api_key actor.
    request.actor = { kind: 'anonymous' };
    request.adminActor = null;

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

    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;

    // 2a. Admin cookie → admin session candidate (kept separate so it can
    // coexist with a customer session in the same browser).
    const adminRaw = cookies?.[adminCookieName];
    if (adminRaw) {
      const resolvedAdmin = await opts.sessionService.loadSession(adminRaw);
      if (resolvedAdmin?.kind === 'admin' && resolvedAdmin.session.adminUserId) {
        request.adminActor = {
          kind: 'admin',
          adminUserId: resolvedAdmin.session.adminUserId,
          session: resolvedAdmin.session,
        };
      }
    }

    // 2b. Customer cookie → the ambient actor for public + customer routes.
    const raw = cookies?.[cookieName];
    if (raw) {
      const resolved = await opts.sessionService.loadSession(raw);
      if (resolved) {
        const session = resolved.session;
        if (resolved.kind === 'impersonation' && session.customerAccountId) {
          const orgId = opts.customerOrgResolver
            ? (await opts.customerOrgResolver(session.customerAccountId)) ?? ''
            : '';
          request.actor = {
            kind: 'customer',
            customerAccountId: session.customerAccountId,
            organizationId: orgId,
            impersonatorAdminUserId: session.impersonatorAdminUserId ?? null,
            session,
          };
        } else if (resolved.kind === 'customer' && session.customerAccountId) {
          const orgId = opts.customerOrgResolver
            ? (await opts.customerOrgResolver(session.customerAccountId)) ?? ''
            : '';
          request.actor = {
            kind: 'customer',
            customerAccountId: session.customerAccountId,
            organizationId: orgId,
            impersonatorAdminUserId: null,
            session,
          };
        }
        // An admin-kind session in the customer cookie (legacy) is ignored;
        // admins now authenticate via the dedicated admin cookie.

        // Feature 040 — keep presence fresh: stamp `lastSeenAt` on every active
        // customer request (throttled to once/minute inside the service via a
        // Redis marker). Without this, the admin "online customers" view only
        // reflects login time, so an actively-browsing buyer ages out of the
        // freshness window and disappears. Fire-and-forget: never block or fail
        // the request on a presence write.
        if (
          (resolved.kind === 'customer' || resolved.kind === 'impersonation') &&
          session.customerAccountId
        ) {
          void opts.sessionService.touchLastSeen(session.id).catch(() => undefined);
        }
      }
    }

    // 3. If no customer/anonymous identity was established but an admin session
    // exists, expose it as the ambient actor too, so admin flows that read
    // `request.actor` without first running an admin guard still resolve.
    if (request.actor.kind === 'anonymous' && request.adminActor) {
      request.actor = request.adminActor;
    }
  });

}

export const authPlugin = fastifyPlugin(authPluginImpl, {
  name: 'b2b-auth',
  fastify: '5.x',
});

/*
 * Three `FastifyInstance` decorators lived here — `requireCustomer`,
 * `requireAdmin`, `requireApiKey` — and were deleted with this module's
 * conversion (feature 072, T078). **Nothing in `src/` or `test/` called any of
 * them.**
 *
 * Worth recording rather than deleting silently, because the `requireAdmin` one
 * read as a live authorisation hole: its body accepted any admin regardless of
 * the permission code, under a comment promising the real check "in T188". It
 * was not a hole — the guard every route actually uses is `createRequireAdmin`
 * in `require-admin.ts`, which checks `permissionService.hasPermission`. The
 * decorator was dead code that looked dangerous, which is its own kind of cost.
 */
