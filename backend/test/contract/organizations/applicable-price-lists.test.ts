import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, PriceList } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

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
  let channelListId: string;

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

    // A channel-bound list, evaluated against the system-default channel's
    // **id** — the criterion the panel used to be unable to match (D-48 / L1).
    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const channelList = em.create(PriceList, {
      code: `us5-channel-${Date.now()}`,
      name: 'Channel-bound Price List for Applicable Lists Co',
      status: 'active',
      currency: 'PLN',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'salesChannel',
        values: [systemDefault.id],
      },
    });
    await em.persistAndFlush(channelList);
    channelListId = channelList.id;
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

  /**
   * D-48 / L1. `resolveDefaultSalesChannelId` was
   * `(await getSystemDefault())?.id ?? 'default'` — a channel *code* landing in
   * `ResolutionContext.salesChannelId`, which the price-list evaluator compares
   * as `values.includes(ctx.salesChannelId)` against channel **uuids**. On any
   * deployment that took the fallback, every `salesChannel` criterion evaluated
   * false and this panel reported channel-scoped lists as not applying. The
   * fallback branch is deleted, not patched: the resolver cannot fail to find a
   * default, so there is nothing left to fall back to.
   */
  it('matches a salesChannel criterion bound to the system-default channel', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ priceListId: string; reasons: string[] }>;
    };
    const ours = body.items.find((it) => it.priceListId === channelListId);
    expect(ours).toBeDefined();
    expect(ours!.reasons).toContain('sales_channel_inheritance');
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
