import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 039 (US5) — one-click buy eligibility endpoint wiring. The setting
 * defaults to off, so a buyer is not eligible until it is enabled and all four
 * defaults are set (the service logic is unit-tested in one-click-service.test.ts).
 */

const COOKIE = { b2b_session: 'stub-customer-session' };

describe('Quick-order one-click eligibility', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('requires an authenticated session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
    });
    expect(res.statusCode).toBe(401);
  });

  it('reports not-eligible while the setting is disabled', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
      cookies: COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  it('refuses a one-click order when not eligible', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: COOKIE,
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
    });
    expect(res.statusCode).toBe(422);
  });
});
