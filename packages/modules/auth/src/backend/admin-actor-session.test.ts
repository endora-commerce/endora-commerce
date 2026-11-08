import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import { authPlugin } from './plugin.js';
import type { SessionService } from './services/session-service.js';

/**
 * Issue #349, E-349-1 — a write that ends other administrators' sessions
 * spares the one it was made from. A route could resolve that session from the
 * cookie itself (`admin_users` does), but a write that reaches its consequence
 * through an event cannot carry the cookie, which is a credential. So the
 * admin actor names the id of the session it was resolved from: not a secret
 * on its own, and already resolved for every admin request.
 */
const ADMIN_COOKIE = 's-admin.token';

describe('auth plugin — the admin actor names its session', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
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
        loadSession: async (cookieValue: string) =>
          cookieValue === ADMIN_COOKIE
            ? { kind: 'admin', session: { id: 's-admin', adminUserId: 'admin-1' } }
            : null,
        touchLastSeen: async () => undefined,
      } as unknown as SessionService,
    });
    app.get('/anything', async (request) => ({ adminActor: request.adminActor }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('carries the session id beside the administrator', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/anything',
      headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${ADMIN_COOKIE}` },
    });
    expect(response.json()).toEqual({
      adminActor: { kind: 'admin', adminUserId: 'admin-1', sessionId: 's-admin' },
    });
  });
});
