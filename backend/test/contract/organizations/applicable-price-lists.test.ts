import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 026 US5 — Applicable price-lists panel contract.
 *
 *   GET /api/v1/admin/organizations/:id/applicable-price-lists
 *
 * Returns the price books currently applicable to the Organization, each
 * tagged with the `reasons[]` array explaining why. Since feature 160 (FR-032)
 * those are the books whose audience names the organization, an ancestor or
 * its customer group; a channel catalogue book is everyone's price and is not
 * listed (the ancestor and group cases are in
 * `test/integration/organizations/effective-price-books.test.ts`).
 */
describe('Applicable price lists (feature 026 US5)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let directListId: string;
  let channelBookId: string;

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

    // A book whose audience names the organization.
    directListId = await seedPriceBookSql(em, {
      name: 'Direct-Org price book for Applicable Lists Co',
      audience: { organizations: [orgId] },
      rows: [],
    });
    // A channel catalogue book: everyone's price, not the organization's.
    channelBookId = await seedPriceBookSql(em, {
      name: 'Channel catalogue book',
      audience: 'everyone',
      rows: [],
    });
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

  it('does not list a channel catalogue book (everyone) as an organization price (160 FR-032)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ priceListId: string; reasons: string[] }>;
    };
    expect(body.items.find((it) => it.priceListId === channelBookId)).toBeUndefined();
  });

  it('omits a price book whose audience names a different Organization', async () => {
    // Fresh org without any book of its own.
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
