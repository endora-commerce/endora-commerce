import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T164 — DeliveryMethod + PaymentMethod admin CRUD round-trips.
 */

describe('Admin delivery + payment methods', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts a delivery method by code, then deletes it by id', async () => {
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/courier_dpd',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'courier_dpd',
        name: { 'en-US': 'DPD courier' },
        cost: 12.5,
        currency: 'PLN',
      },
    });
    expect(upsert.statusCode).toBe(200);
    const created = (upsert.json() as { data: { id: string; code: string } }).data;
    expect(created.code).toBe('courier_dpd');

    // Re-upsert (mutation path)
    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/courier_dpd',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'courier_dpd',
        name: { 'en-US': 'DPD courier (next-day)' },
        cost: 14.0,
        currency: 'PLN',
        status: 'active',
      },
    });
    expect(update.statusCode).toBe(200);
    expect(
      (update.json() as { data: { cost: { amount: number } } }).data.cost.amount,
    ).toBeCloseTo(14);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
  });

  it('upserts a payment method by code, then deletes it by id', async () => {
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/stripe_card',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'stripe_card',
        name: { 'en-US': 'Card (Stripe)' },
        kind: 'gateway',
      },
    });
    expect(upsert.statusCode).toBe(200);
    const created = (upsert.json() as { data: { id: string; kind: string } }).data;
    expect(created.kind).toBe('gateway');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
  });
});
