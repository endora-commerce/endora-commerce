import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T015 / T025 / T055 — adapter-aware delivery-method routes.
 *
 * Admin list exposes the adapter + status mappings + rendererKey; the public
 * list applies eligibility (registered adapter + validateUseOnStorefront);
 * upsert validates explicit adapters and Order-status references.
 */
const adminCookies = { b2b_session: 'stub-admin-session' };

describe('Delivery-method adapter framework — routes', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('admin list returns adapter, status mappings and rendererKey', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods',
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
    const seeded = rows.find((r) => r.code === 'in_person_pickup');
    expect(seeded).toBeDefined();
    expect(seeded!.adapter).toBe('personal_pickup');
    expect(seeded!.statusOnSuccess).toBe('shipped');
    expect(seeded!.statusOnFailure).toBe('in_fulfilment');
    expect(seeded).toHaveProperty('rendererKey');
  });

  it('public list returns the seeded method with adapter + rendererKey', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
    const seeded = rows.find((r) => r.code === 'in_person_pickup');
    expect(seeded).toBeDefined();
    expect(seeded!.adapter).toBe('personal_pickup');
    expect(seeded).toHaveProperty('rendererKey');
  });

  it('rejects an explicitly-provided unknown adapter (400)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/bad_adapter_method',
      cookies: adminCookies,
      payload: {
        code: 'bad_adapter_method',
        name: { 'en-US': 'Bad' },
        cost: 0,
        currency: 'PLN',
        adapter: 'no_such_adapter',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid statusOnSuccess reference (400) — T055', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/in_person_pickup',
      cookies: adminCookies,
      payload: {
        code: 'in_person_pickup',
        name: { 'en-US': 'In-person pickup' },
        cost: 0,
        currency: 'PLN',
        statusOnSuccess: 'not_a_real_status',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists valid status mappings on the seeded (adapter-backed) method', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/in_person_pickup',
      cookies: adminCookies,
      payload: {
        code: 'in_person_pickup',
        name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbiór osobisty' },
        cost: 0,
        currency: 'PLN',
        statusOnSuccess: 'completed',
        statusOnFailure: 'in_fulfilment',
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data.statusOnSuccess).toBe('completed');
    // The adapter is preserved (not reset to the code) when omitted from the body.
    expect(data.adapter).toBe('personal_pickup');
  });
});
