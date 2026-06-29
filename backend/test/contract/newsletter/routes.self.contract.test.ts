import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selfNewsletterStatusSchema } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * HTTP-level contract for the authenticated customer newsletter routes
 * (feature 048, US9), exercised through the real server + customer guard.
 */
describe('Newsletter self-service routes (feature 048)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('requires a customer session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me/newsletter' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('reports status, subscribes, and unsubscribes the signed-in customer', async () => {
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/me/newsletter', cookies: CUSTOMER });
    expect(before.statusCode).toBe(200);
    const status = selfNewsletterStatusSchema.parse(before.json().data);
    expect(status.canManage).toBe(true);

    const sub = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/newsletter/subscribe',
      cookies: CUSTOMER,
      payload: {},
    });
    expect(sub.statusCode).toBe(200);

    // Double opt-in (the channel default) creates a pending subscriber, so the
    // customer is now on the list even though `subscribed` (active-only) is false.
    const after = await h.app.inject({ method: 'GET', url: '/api/v1/me/newsletter', cookies: CUSTOMER });
    expect(['pending', 'active']).toContain(selfNewsletterStatusSchema.parse(after.json().data).status);

    const unsub = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/newsletter/unsubscribe',
      cookies: CUSTOMER,
      payload: { reason: 'contract test' },
    });
    expect(unsub.statusCode).toBe(200);
  });
});
