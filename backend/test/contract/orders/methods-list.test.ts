import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';

/**
 * T157 — public GET endpoints feeding the storefront checkout step.
 * Anonymous callers must see active delivery + payment methods so the
 * checkout form has options to render before the user signs in.
 */

describe('GET /api/v1/delivery-methods + /api/v1/payment-methods', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists active delivery methods (anonymous)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; code: string; status: string; cost: { amount: number } }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((m) => m.id === SEED_DELIVERY_METHOD_ID)).toBe(true);
    body.data.forEach((m) => expect(m.status).toBe('active'));
  });

  it('lists active payment methods (anonymous)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; code: string; kind: string; status: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((m) => m.id === SEED_PAYMENT_METHOD_ID)).toBe(true);
    body.data.forEach((m) => expect(m.status).toBe('active'));
  });
});
