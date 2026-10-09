import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deliveryMethodAdapterOptionSchema,
  deliveryMethodAdminListItemSchema,
} from '@endora-commerce/contracts';
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
    expect(seeded!.statusOnSuccess).toBe('shipment_sent');
    expect(seeded!.statusOnFailure).toBe('processing');
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
        statusOnFailure: 'processing',
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data.statusOnSuccess).toBe('completed');
    // The adapter is preserved (not reset to the code) when omitted from the body.
    expect(data.adapter).toBe('personal_pickup');
  });
  it('lists the registered adapters with the module that contributed each', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods/adapters',
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(200);
    const data = deliveryMethodAdapterOptionSchema.array().parse(res.json().data);
    // The two bundled offline adapters are this module's own contribution.
    expect(data).toEqual(
      expect.arrayContaining([
        { key: 'manual_courier', ownerModule: 'delivery_methods' },
        { key: 'personal_pickup', ownerModule: 'delivery_methods' },
      ]),
    );
    // A row's code is not an adapter: nothing registered `in_person_pickup`.
    expect(data.map((a) => a.key)).not.toContain('in_person_pickup');
  });

  it('refuses the adapter list to a caller with no session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods/adapters',
    });
    expect(res.statusCode).toBe(401);
  });

  it('admin list says whether each method can be offered, and why not', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods',
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(200);
    const rows = deliveryMethodAdminListItemSchema.array().parse(res.json().data);
    const seeded = rows.find((r) => r.code === 'in_person_pickup');
    expect(seeded!.availability.available).toBe(true);
    expect(seeded!.availability.ownerModule).toBe('delivery_methods');
    expect(seeded!.availability.ownerPresence?.present).toBe(true);
  });

  it('keeps the code default for a creation that names no adapter, and says the result is not offered', async () => {
    // The pre-adapter payload stays valid (the contract's promise), but the
    // answer is no longer silent: nothing registered `adapterless_probe`.
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/adapterless_probe',
      cookies: adminCookies,
      payload: { name: { 'en-US': 'Adapterless' }, cost: 0, currency: 'PLN' },
    });
    expect(res.statusCode).toBe(200);
    const row = deliveryMethodAdminListItemSchema.parse(res.json().data);
    expect(row.adapter).toBe('adapterless_probe');
    expect(row.availability).toEqual({
      ownerModule: null,
      available: false,
      ownerPresence: null,
    });

    const publicList = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
    const offered = (publicList.json() as { data: Array<{ code: string }> }).data;
    expect(offered.map((m) => m.code)).not.toContain('adapterless_probe');
  });

  it('lets an edit repeat an unregistered adapter the row already carries', async () => {
    // The form sends the adapter it was shown. Re-pricing or deactivating a
    // row whose carrier is gone must not become a 400.
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/adapterless_probe',
      cookies: adminCookies,
      payload: {
        name: { 'en-US': 'Adapterless' },
        cost: 4,
        currency: 'PLN',
        adapter: 'adapterless_probe',
      },
    });
    expect(res.statusCode).toBe(200);
    const row = deliveryMethodAdminListItemSchema.parse(res.json().data);
    expect(row.cost.amount).toBe(4);
    expect(row.availability.available).toBe(false);
  });

  it('still refuses changing a row to an adapter nobody registered', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/adapterless_probe',
      cookies: adminCookies,
      payload: {
        name: { 'en-US': 'Adapterless' },
        cost: 4,
        currency: 'PLN',
        adapter: 'another_unknown_adapter',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('repairs the row by choosing a registered adapter, after which checkout offers it', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/adapterless_probe',
      cookies: adminCookies,
      payload: {
        name: { 'en-US': 'Adapterless' },
        cost: 4,
        currency: 'PLN',
        adapter: 'manual_courier',
      },
    });
    expect(res.statusCode).toBe(200);
    const row = deliveryMethodAdminListItemSchema.parse(res.json().data);
    expect(row.adapter).toBe('manual_courier');
    expect(row.availability.available).toBe(true);

    const publicList = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
    const offered = (publicList.json() as { data: Array<{ code: string }> }).data;
    expect(offered.map((m) => m.code)).toContain('adapterless_probe');
  });
});
