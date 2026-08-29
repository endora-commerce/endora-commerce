import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Address } from '../../helpers/package-entities.js';

/**
 * Feature 039 — admin org-addresses read endpoint.
 *
 * `GET /admin/organizations/:id/addresses` feeds the default-preferences
 * panel's billing / shipping address pickers on the Organization edit page.
 * It returns the org's non-deleted addresses (with ids) so an operator can
 * pick one as the org's default billing / shipping address.
 */
describe('Admin organization addresses (feature 039)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let billingId: string;
  let deliveryId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const org = em.create(Organization, {
      name: 'Addresses Co',
      taxId: `PL039A${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Adresowa 1',
        city: 'Warszawa',
        postalCode: '00-007',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    orgId = org.id;

    const billing = em.create(Address, {
      organizationId: orgId,
      kind: 'billing',
      recipientName: 'Addresses Co',
      street: 'ul. Rozliczeniowa 2',
      city: 'Warszawa',
      postalCode: '00-008',
      country: 'PL',
      isDefault: true,
    });
    const delivery = em.create(Address, {
      organizationId: orgId,
      kind: 'delivery',
      recipientName: 'Addresses Co Magazyn',
      street: 'ul. Wysyłkowa 3',
      city: 'Kraków',
      postalCode: '30-001',
      country: 'PL',
    });
    await em.persistAndFlush([billing, delivery]);
    billingId = billing.id;
    deliveryId = delivery.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the org addresses with ids and kinds', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/addresses`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; organizationId: string; kind: string; isDefault: boolean }>;
    };
    expect(body.data).toHaveLength(2);
    const byId = new Map(body.data.map((a) => [a.id, a]));
    expect(byId.get(billingId)?.kind).toBe('billing');
    expect(byId.get(deliveryId)?.kind).toBe('delivery');
    expect(byId.get(billingId)?.organizationId).toBe(orgId);
  });
});
