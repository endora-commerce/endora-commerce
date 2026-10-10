import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The four `carts` customer routes that declare a body schema answer a caller
 * with no customer session before they validate the body.
 *
 * Each used to check the session inside its handler, which runs after schema
 * validation: an anonymous request with a malformed body was told which fields
 * were wrong (400) instead of that it needs to sign in (401). The guard is
 * declared on the route now, and the platform runs a declared guard ahead of
 * validation. A signed-in customer still gets the 400.
 */
describe('carts customer routes — session before validation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const routes = [
    {
      method: 'PATCH',
      url: '/api/v1/organization/policies/cart-approval',
      invalid: { requiresCartApproval: 'yes' },
    },
    {
      method: 'POST',
      url: `/api/v1/organization/carts/${randomUUID()}/reject`,
      invalid: { reason: '' },
    },
    {
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      invalid: { note: 42 },
    },
    {
      method: 'POST',
      url: `/api/v1/cart/items/${randomUUID()}/save-to-shopping-list`,
      invalid: { shoppingListId: 'not-a-uuid' },
    },
  ] as const;

  for (const route of routes) {
    it(`${route.method} ${route.url.replace(/[0-9a-f-]{36}/, ':id')} — anonymous + invalid body is 401`, async () => {
      const res = await h.app.inject({ method: route.method, url: route.url, payload: route.invalid });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it(`${route.method} ${route.url.replace(/[0-9a-f-]{36}/, ':id')} — customer + invalid body is 400`, async () => {
      const res = await h.app.inject({
        method: route.method,
        url: route.url,
        cookies: { b2b_session: 'stub-customer-session' },
        payload: route.invalid,
      });
      expect(res.statusCode).toBe(400);
    });
  }
});
