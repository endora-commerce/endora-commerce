import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T062-T064 partial (feature 027 US3) — smoke tests for the three
 * conversion endpoints. Full happy-path coverage that depends on
 * pre-arranged QR/list rows is deferred until US3 ships with the
 * frontend; these tests cover the route plumbing and the error-handler
 * contract.
 */

describe('POST /api/v1/cart/convert-to-quote-request', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      payload: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/cart/from-quote-request/:quoteRequestId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/from-quote-request/00000000-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/cart/from-shopping-list/:shoppingListId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/from-shopping-list/00000000-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });
});
