import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import { authPlugin } from './plugin.js';
import type { SessionService } from './services/session-service.js';

/**
 * Which session a request keeps fresh
 * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §CAL-B3).
 *
 * `sessions.last_seen_at` is the platform's one record of "this person is
 * here". Feature 040 stamped it for customers; an administrator's stayed at
 * the sign-in time, so nothing could say whether an administrator is online.
 * The plugin now stamps the session behind the **admin cookie** too — the same
 * fire-and-forget call, throttled inside the session service — and nothing
 * else changes: what a customer cookie stamps is what it stamped before.
 *
 * The session store is a stand-in that records the calls; how a stamp is
 * throttled and stored is the service's, and is measured against a real
 * database and Redis in `backend/test/integration/auth/admin-presence.test.ts`.
 */

const ADMIN_COOKIE = 'admin-session.token';
const CUSTOMER_COOKIE = 'customer-session.token';
const IMPERSONATION_COOKIE = 'impersonation-session.token';

const sessions: Record<string, { kind: string; session: Record<string, unknown> }> = {
  [ADMIN_COOKIE]: { kind: 'admin', session: { id: 's-admin', adminUserId: 'admin-1' } },
  [CUSTOMER_COOKIE]: { kind: 'customer', session: { id: 's-customer', customerAccountId: 'customer-1' } },
  [IMPERSONATION_COOKIE]: {
    kind: 'impersonation',
    session: { id: 's-impersonation', customerAccountId: 'customer-1', impersonatorAdminUserId: 'admin-1' },
  },
};

describe('auth plugin — presence', () => {
  let app: FastifyInstance;
  let touched: string[];
  let touch: (sessionId: string) => Promise<void>;

  beforeEach(async () => {
    touched = [];
    touch = async (sessionId) => {
      touched.push(sessionId);
    };
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
        loadSession: async (cookieValue: string) => sessions[cookieValue] ?? null,
        touchLastSeen: (sessionId: string) => touch(sessionId),
      } as unknown as SessionService,
      customerOrgResolver: async () => 'org-1',
    });
    app.get('/anything', async (request) => ({ actor: request.actor.kind }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const ask = async (cookies: Record<string, string>) => {
    const cookie = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    const response = await app.inject({ method: 'GET', url: '/anything', headers: cookie ? { cookie } : {} });
    expect(response.statusCode, response.body).toBe(200);
    // The stamp is not awaited by the request; one turn of the loop lets it land.
    await new Promise((resolve) => setImmediate(resolve));
    return (response.json() as { actor: string }).actor;
  };

  it('stamps the admin session of a request that carries the admin cookie', async () => {
    expect(await ask({ [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE })).toBe('admin');
    expect(touched).toEqual(['s-admin']);
  });

  it('stamps both sessions of a request that carries both', async () => {
    await ask({ [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE, [SESSION_COOKIE_NAME]: CUSTOMER_COOKIE });
    expect(touched.sort()).toEqual(['s-admin', 's-customer']);
  });

  it('stamps a customer session and an impersonation, as before', async () => {
    expect(await ask({ [SESSION_COOKIE_NAME]: CUSTOMER_COOKIE })).toBe('customer');
    expect(await ask({ [SESSION_COOKIE_NAME]: IMPERSONATION_COOKIE })).toBe('customer');
    expect(touched).toEqual(['s-customer', 's-impersonation']);
  });

  it('stamps nothing for a request that is nobody', async () => {
    expect(await ask({})).toBe('anonymous');
    expect(await ask({ [ADMIN_SESSION_COOKIE_NAME]: 'stale.token' })).toBe('anonymous');
    expect(touched).toEqual([]);
  });

  it('does not take a session of another kind in the admin cookie for an administrator’s presence', async () => {
    expect(await ask({ [ADMIN_SESSION_COOKIE_NAME]: CUSTOMER_COOKIE })).toBe('anonymous');
    // Nor an admin session presented in the customer cookie, which the plugin ignores.
    expect(await ask({ [SESSION_COOKIE_NAME]: ADMIN_COOKIE })).toBe('anonymous');
    expect(touched).toEqual([]);
  });

  it('answers the request whatever becomes of the stamp', async () => {
    touch = async () => {
      throw new Error('redis is away');
    };
    expect(await ask({ [ADMIN_SESSION_COOKIE_NAME]: ADMIN_COOKIE })).toBe('admin');
  });
});
