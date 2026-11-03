/**
 * The member's role travels on the request actor (`specs/170-organization-roles/`
 * WP-01 T010; research R-15).
 *
 * The request hook already reads the account behind every customer session —
 * to bind its Organization and to decide whether it may act at all — so the
 * same read answers which role the member holds, and a permission check on the
 * cart path costs no database read of its own. `customerOrgResolver` gains the
 * field in WP-02b; until then it answers none, and the request is bound exactly
 * as before with a `null` role id rather than refused.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import { authPlugin, type CustomerSessionAccount } from './plugin.js';
import { createRequireCustomer } from './require-customer.js';
import type { SessionService } from './services/session-service.js';

const ROLE_ID = '6f1c1d5e-6a4b-4c43-9d43-2b8a3c2e7f10';

const accounts: Record<string, CustomerSessionAccount> = {
  withRole: { organizationId: 'org-1', active: true, organizationRoleId: ROLE_ID },
  withoutRole: { organizationId: 'org-1', active: true },
  nullRole: { organizationId: 'org-1', active: true, organizationRoleId: null },
  blockedWithRole: { organizationId: 'org-1', active: false, organizationRoleId: ROLE_ID },
};

function sessionFor(kind: 'customer' | 'impersonation', customerAccountId: string) {
  return {
    kind,
    session: {
      id: `s-${kind}-${customerAccountId}`,
      customerAccountId,
      impersonatorAdminUserId: kind === 'impersonation' ? 'admin-1' : null,
    },
  };
}

describe('auth plugin — the role behind a customer session (feature 170, R-15)', () => {
  let app: FastifyInstance;

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
      sessionService: {
        loadSession: async (cookieValue: string) => {
          const [kind, id] = cookieValue.split('.') as ['customer' | 'impersonation', string];
          return sessionFor(kind, id);
        },
        touchLastSeen: async () => undefined,
      } as unknown as SessionService,
      customerAccountResolver: async (id) => accounts[id] ?? null,
    });
    const requireCustomer = createRequireCustomer();
    app.get('/customer', { preHandler: requireCustomer }, async (request) => request.actor);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const ask = (cookie: string) =>
    app.inject({ method: 'GET', url: '/customer', headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } });

  it('stamps the role id the resolver answers onto the customer actor', async () => {
    const res = await ask('customer.withRole');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      kind: 'customer',
      organizationId: 'org-1',
      organizationRoleId: ROLE_ID,
    });
  });

  it.each(['withoutRole', 'nullRole'])(
    'binds the session with a null role id when the resolver answers none (%s), and does not refuse it',
    async (id) => {
      const res = await ask(`customer.${id}`);
      expect(res.statusCode).toBe(200);
      const actor = res.json() as Record<string, unknown>;
      expect(actor).toMatchObject({ kind: 'customer', organizationId: 'org-1' });
      expect(actor['organizationRoleId']).toBeNull();
    },
  );

  it("stamps the impersonated member's role id, so the impersonation is judged as that member", async () => {
    const res = await ask('impersonation.blockedWithRole');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      kind: 'customer',
      impersonatorAdminUserId: 'admin-1',
      organizationRoleId: ROLE_ID,
    });
  });

  it('still refuses the session of a blocked account, whatever role it holds', async () => {
    const res = await ask('customer.blockedWithRole');
    expect(res.statusCode).toBe(401);
  });
});
