import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';

/**
 * Feature 026 US5 — Applicable price-lists panel contract.
 *
 *   GET /api/v1/admin/organizations/:id/applicable-price-lists
 *
 * Returns the set of Price Lists currently applicable to the Organization,
 * each tagged with the `reasons[]` array explaining why (direct match,
 * customer-group inheritance, channel inheritance, segment-rule match).
 */
describe('Applicable price lists (feature 026 US5)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let directListId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const org = em.create(Organization, {
      name: 'Applicable Lists Co',
      taxId: `PL026P${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Listowa 1',
        city: 'Warszawa',
        postalCode: '00-007',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    orgId = org.id;

    // Create a direct-organization-matching Price List.
    const directList = em.create(PriceList, {
      code: `us5-direct-${Date.now()}`,
      name: 'Direct-Org Price List for Applicable Lists Co',
      status: 'active',
      currency: 'PLN',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [orgId],
      },
    });
    await em.persistAndFlush(directList);
    directListId = directList.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the directly-attached Price List with direct_organization_match reason', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ priceListId: string; name: string; priority: number; reasons: string[] }>;
    };
    const ours = body.items.find((it) => it.priceListId === directListId);
    expect(ours).toBeDefined();
    expect(ours!.reasons).toContain('direct_organization_match');
  });

  it('omits a Price List whose application rule targets a different Organization', async () => {
    // Fresh org without any direct-attached Price List.
    const em = h.em();
    const otherOrg = em.create(Organization, {
      name: 'Other Org for Negative Case',
      taxId: `PL026Q${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Negatywna 1',
        city: 'Warszawa',
        postalCode: '00-008',
        country: 'PL',
      },
    });
    await em.persistAndFlush(otherOrg);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${otherOrg.id}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ priceListId: string }>;
    };
    const sneaked = body.items.find((it) => it.priceListId === directListId);
    expect(sneaked).toBeUndefined();
  });

  it('returns empty items for a non-existent Organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/00000000-0000-4000-8000-0000000aaaaa/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
