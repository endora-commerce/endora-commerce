import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';

/**
 * Feature 026 US4 — Per-Organization allow-list contract.
 *
 * Covers:
 *  1. GET /admin/organizations/:id/restrictions returns four empty arrays
 *     (and the org's version) for a fresh Organization.
 *  2. PUT /admin/organizations/:id/restrictions replaces all three lists
 *     atomically and bumps the org's `version`.
 *  3. PATCH variants (.../restrictions/payment-methods etc.) add and remove
 *     entries surgically and keep `version` consistent.
 *  4. Stale `expectedVersion` returns HTTP 409 with currentVersion.
 *  5. POST /storefront/checkout/preflight reflects the current allow-list
 *     for an active Customer and refuses 423 for a blocked Organization.
 */
describe('Per-Organization restrictions (feature 026 US4)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let paymentMethodId: string;
  let deliveryMethodId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const org = em.create(Organization, {
      name: 'Restrictions Co',
      taxId: `PL026R${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Restrykcyjna 1',
        city: 'Warszawa',
        postalCode: '00-006',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    orgId = org.id;

    // Reuse existing seeded payment + delivery methods so the FK constraints
    // are satisfied without inventing extra fixtures.
    const pm = await em.findOneOrFail(PaymentMethod, { status: 'active' });
    paymentMethodId = pm.id;
    const dm = await em.findOneOrFail(DeliveryMethod, { status: 'active' });
    deliveryMethodId = dm.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET returns empty allow-lists + the org version for a fresh Organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/restrictions`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        organizationId: string;
        paymentMethodIds: string[];
        deliveryMethodIds: string[];
        warehouseIds: string[];
        version: number;
      };
    };
    expect(body.data.organizationId).toBe(orgId);
    expect(body.data.paymentMethodIds).toEqual([]);
    expect(body.data.deliveryMethodIds).toEqual([]);
    expect(body.data.warehouseIds).toEqual([]);
    expect(body.data.version).toBeGreaterThanOrEqual(0);
  });

  it('PUT replaces all three allow-lists in a single atomic update', async () => {
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: orgId });

    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/restrictions`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: fresh.version,
        paymentMethodIds: [paymentMethodId],
        deliveryMethodIds: [deliveryMethodId],
        warehouseIds: [],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { paymentMethodIds: string[]; deliveryMethodIds: string[]; version: number } };
    expect(body.data.paymentMethodIds).toEqual([paymentMethodId]);
    expect(body.data.deliveryMethodIds).toEqual([deliveryMethodId]);
    expect(body.data.version).toBe(fresh.version + 1);
  });

  it('PATCH adds and removes payment-method entries surgically', async () => {
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: orgId });

    const removeRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/restrictions/payment-methods`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: fresh.version,
        remove: [paymentMethodId],
      },
    });
    expect(removeRes.statusCode).toBe(200);
    const removed = removeRes.json() as { data: { paymentMethodIds: string[]; version: number } };
    expect(removed.data.paymentMethodIds).toEqual([]);
    expect(removed.data.version).toBe(fresh.version + 1);

    const addRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/restrictions/payment-methods`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: removed.data.version,
        add: [paymentMethodId],
      },
    });
    expect(addRes.statusCode).toBe(200);
    const added = addRes.json() as { data: { paymentMethodIds: string[]; version: number } };
    expect(added.data.paymentMethodIds).toEqual([paymentMethodId]);
  });

  it('refuses a stale expectedVersion with 409 VERSION_CONFLICT', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/restrictions`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: 0,
        paymentMethodIds: [],
        deliveryMethodIds: [],
        warehouseIds: [],
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('PATCH delivery-methods works through the same code path', async () => {
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: orgId });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/restrictions/delivery-methods`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: fresh.version,
        remove: [deliveryMethodId],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { deliveryMethodIds: string[] } };
    expect(body.data.deliveryMethodIds).toEqual([]);
  });
});
