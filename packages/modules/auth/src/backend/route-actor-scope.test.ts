import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type Actor,
} from '@endora-commerce/contracts';
import { resolveCommandActor } from '@endora-commerce/platform/commands';
import {
  registerRequestScopeHook,
  resolveTenantContext,
  systemTenantContext,
} from '@endora-commerce/platform/composition';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { authPlugin } from './plugin.js';
import { createRequireAdmin, createRequireAdminAny } from './require-admin.js';
import { createRequireCustomer } from './require-customer.js';
import type { SessionService } from './services/session-service.js';

/**
 * The route decides which session a request runs as — not which cookies the
 * browser happens to hold.
 *
 * A browser can carry an admin session and a customer session at once; it is
 * the ordinary state of an operator who is also signed in to the storefront,
 * and it is every request made while impersonating. This module resolves both
 * and its guards choose between them, so the rule is this module's to hold:
 *
 *  - a route behind the **admin** guard runs as the admin, and in the admin's
 *    tenant scope;
 *  - a route behind the **customer** guard runs as the customer, and in the
 *    customer's — with the impersonating admin recorded when there is one;
 *  - a route behind neither keeps the ambient actor;
 *  - a guard that accepts nobody refuses, and never falls back to the other
 *    session's scope.
 *
 * The table below is every cookie combination against every class of route,
 * through the real plugin, the real guards and the platform's real scope hook.
 * Only the session store and the actor → context mapping are stand-ins: the
 * first because the subject is not how a session is stored, the second because
 * the platform's own mapping reads module ports this package does not have —
 * the stand-in gives an admin a reach that is recognisably not the customer's.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ORG = '00000000-0000-4000-8000-0000000000aa';
const ADMIN_REACH = '00000000-0000-4000-8000-0000000000bb';
const KEY_ORG = '00000000-0000-4000-8000-0000000000cc';

const ADMIN_COOKIE = 'admin-session.token';
const CUSTOMER_COOKIE = 'customer-session.token';
const IMPERSONATION_COOKIE = 'impersonation-session.token';
const API_KEY = 'sk_live_known';

const sessions: Record<string, { kind: string; session: Record<string, unknown> }> = {
  [ADMIN_COOKIE]: { kind: 'admin', session: { id: 's-admin', adminUserId: ADMIN_ID } },
  [CUSTOMER_COOKIE]: {
    kind: 'customer',
    session: { id: 's-customer', customerAccountId: CUSTOMER_ID },
  },
  [IMPERSONATION_COOKIE]: {
    kind: 'impersonation',
    session: {
      id: 's-impersonation',
      customerAccountId: CUSTOMER_ID,
      impersonatorAdminUserId: ADMIN_ID,
    },
  },
};

const sessionService = {
  loadSession: async (cookieValue: string) => sessions[cookieValue] ?? null,
  touchLastSeen: async () => undefined,
} as unknown as SessionService;

async function buildTenantContext(request: FastifyRequest) {
  const actor: Actor = request.actor;
  if (actor.kind === 'customer') {
    return resolveTenantContext({
      kind: 'customer',
      customerAccountId: actor.customerAccountId,
      organizationId: actor.organizationId || null,
      impersonatorAdminUserId: actor.impersonatorAdminUserId ?? null,
    });
  }
  if (actor.kind === 'admin') {
    return resolveTenantContext(
      { kind: 'admin', adminUserId: actor.adminUserId },
      { allowAll: false, allowedOrganizationIds: [ADMIN_REACH] },
    );
  }
  if (actor.kind === 'api_key') {
    return resolveTenantContext({
      kind: 'api_key',
      apiKeyId: actor.apiKeyId,
      organizationId: actor.organizationId ?? null,
      customerAccountId: actor.customerAccountId ?? null,
    });
  }
  return systemTenantContext('actor:anonymous');
}

interface Observation {
  readonly actor: string;
  readonly scope: string;
  readonly scopeActor: string;
  readonly auditAdmin: string | null;
  readonly auditImpersonated: string | null;
}

function observe(request: FastifyRequest): Observation {
  const tenant = getTenantContext();
  if (!tenant) throw new Error('the handler ran with no tenant context');
  const command = resolveCommandActor();
  const reach =
    tenant.mode === 'single-org'
      ? `single-org:${tenant.organizationId ?? ''}`
      : tenant.mode === 'allowed-set'
        ? `allowed-set:${(tenant.allowedOrganizationIds ?? []).join(',')}`
        : tenant.mode;
  return {
    actor: request.actor.kind,
    scope: reach,
    scopeActor: tenant.actor.kind,
    auditAdmin: command.actorAdminUserId,
    auditImpersonated: command.impersonatedCustomerAccountId,
  };
}

const REFUSED = 401;

const asAdmin: Observation = {
  actor: 'admin',
  scope: `allowed-set:${ADMIN_REACH}`,
  scopeActor: 'admin',
  auditAdmin: ADMIN_ID,
  auditImpersonated: null,
};
const asCustomer: Observation = {
  actor: 'customer',
  scope: `single-org:${CUSTOMER_ORG}`,
  scopeActor: 'customer',
  auditAdmin: null,
  auditImpersonated: null,
};
const asImpersonatedCustomer: Observation = {
  ...asCustomer,
  auditAdmin: ADMIN_ID,
  auditImpersonated: CUSTOMER_ID,
};
const asBoundKey: Observation = {
  actor: 'api_key',
  scope: `single-org:${KEY_ORG}`,
  scopeActor: 'api_key',
  auditAdmin: null,
  auditImpersonated: null,
};
const asNobody: Observation = {
  actor: 'anonymous',
  scope: 'system',
  scopeActor: 'system',
  auditAdmin: null,
  auditImpersonated: null,
};

interface Credentials {
  readonly cookies?: Readonly<Record<string, string>>;
  readonly bearer?: string;
}

type Expected = Observation | typeof REFUSED;

interface Row {
  readonly name: string;
  readonly credentials: Credentials;
  readonly admin: Expected;
  readonly customer: Expected;
  readonly open: Expected;
}

const bothCookies = {
  [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE,
  [SESSION_COOKIE_NAME]: CUSTOMER_COOKIE,
};

const TABLE: readonly Row[] = [
  { name: 'no session', credentials: {}, admin: REFUSED, customer: REFUSED, open: asNobody },
  {
    name: 'an admin session alone',
    credentials: { cookies: { [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE } },
    admin: asAdmin,
    customer: REFUSED,
    open: asAdmin,
  },
  {
    name: 'a customer session alone',
    credentials: { cookies: { [SESSION_COOKIE_NAME]: CUSTOMER_COOKIE } },
    admin: REFUSED,
    customer: asCustomer,
    open: asCustomer,
  },
  {
    name: 'an admin session and a customer session',
    credentials: { cookies: bothCookies },
    admin: asAdmin,
    customer: asCustomer,
    open: asCustomer,
  },
  {
    name: 'an admin session and the impersonation session it started',
    credentials: {
      cookies: {
        [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE,
        [SESSION_COOKIE_NAME]: IMPERSONATION_COOKIE,
      },
    },
    admin: asAdmin,
    customer: asImpersonatedCustomer,
    open: asImpersonatedCustomer,
  },
  {
    name: 'an impersonation session alone',
    credentials: { cookies: { [SESSION_COOKIE_NAME]: IMPERSONATION_COOKIE } },
    admin: REFUSED,
    customer: asImpersonatedCustomer,
    open: asImpersonatedCustomer,
  },
  {
    name: 'an API key beside both cookies',
    credentials: { cookies: bothCookies, bearer: API_KEY },
    admin: REFUSED,
    customer: REFUSED,
    open: asBoundKey,
  },
  {
    name: 'an unknown bearer token beside both cookies',
    credentials: { cookies: bothCookies, bearer: 'sk_live_unknown' },
    admin: REFUSED,
    customer: REFUSED,
    open: asNobody,
  },
  {
    name: 'a session cookie that resolves to nothing, beside an admin session',
    credentials: {
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE, [SESSION_COOKIE_NAME]: 'stale.token' },
    },
    admin: asAdmin,
    customer: REFUSED,
    open: asAdmin,
  },
  {
    name: 'an admin session presented in the customer cookie',
    credentials: { cookies: { [SESSION_COOKIE_NAME]: ADMIN_COOKIE } },
    admin: REFUSED,
    customer: REFUSED,
    open: asNobody,
  },
];

describe('the route decides which session a request runs as', () => {
  let app: FastifyInstance;
  const permitted = new Set(['orders:read']);

  beforeAll(async () => {
    app = Fastify();
    // What `@fastify/cookie` contributes to this plugin: `request.cookies`.
    app.decorateRequest('cookies', null as never);
    app.addHook('onRequest', async (request) => {
      const header = request.headers.cookie ?? '';
      (request as unknown as { cookies: Record<string, string> }).cookies = Object.fromEntries(
        header
          .split(';')
          .map((pair) => pair.trim())
          .filter((pair) => pair.includes('='))
          .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
      );
    });
    await app.register(authPlugin, {
      sessionService,
      apiKeyResolver: async (token) =>
        token === API_KEY
          ? { apiKeyId: 'key-1', scopes: [], organizationId: KEY_ORG, customerAccountId: null }
          : null,
      customerOrgResolver: async () => CUSTOMER_ORG,
    });
    await registerRequestScopeHook(app, { buildTenantContext });

    const permissionService = {
      hasPermission: async (_adminUserId: string, code: string) => permitted.has(code),
      isActiveAdministrator: async () => true,
    };
    const requireAdmin = createRequireAdmin({ permissionService });
    const requireAdminAny = createRequireAdminAny({ permissionService });
    const requireCustomer = createRequireCustomer();

    app.get('/admin', { preHandler: requireAdmin() }, async (request) => observe(request));
    app.get('/admin/any', { preHandler: requireAdminAny(['orders:read']) }, async (request) =>
      observe(request),
    );
    app.get('/admin/forbidden', { preHandler: requireAdmin('orders:write') }, async (request) =>
      observe(request),
    );
    app.get('/customer', { preHandler: requireCustomer }, async (request) => observe(request));
    app.get('/open', async (request) => observe(request));
    // The shape twenty-odd modules mount: the guard resolved per request,
    // behind a function of the module's own. Nothing about the route says
    // "admin" until that function runs.
    app.get(
      '/admin/wrapped',
      { preHandler: (request, reply) => requireAdmin('orders:read')(request, reply) },
      async (request) => observe(request),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function ask(url: string, credentials: Credentials): Promise<Expected> {
    const cookie = Object.entries(credentials.cookies ?? {})
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const response = await app.inject({
      method: 'GET',
      url,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(credentials.bearer ? { authorization: `Bearer ${credentials.bearer}` } : {}),
      },
    });
    if (response.statusCode === REFUSED) return REFUSED;
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  describe.each(TABLE)('with $name', (row) => {
    it('an admin route', async () => {
      expect(await ask('/admin', row.credentials)).toEqual(row.admin);
      expect(await ask('/admin/any', row.credentials)).toEqual(row.admin);
      expect(await ask('/admin/wrapped', row.credentials)).toEqual(row.admin);
    });

    it('a customer route', async () => {
      expect(await ask('/customer', row.credentials)).toEqual(row.customer);
    });

    it('a route with no gate', async () => {
      expect(await ask('/open', row.credentials)).toEqual(row.open);
    });
  });

  it('refuses an admin who lacks the permission as an admin, not as the customer beside it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/forbidden',
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${ADMIN_COOKIE}; ${SESSION_COOKIE_NAME}=${CUSTOMER_COOKIE}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
