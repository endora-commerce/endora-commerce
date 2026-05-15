import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — T023. Public product read picks the per-language slot per
 * the `Accept-Language` header and falls back deterministically when the
 * requested language is missing on the baseline JSONB.
 *
 * Channel context (`x-sales-channel`) sets the channel-defaultLanguage
 * leg of the fallback chain (R-3); for US1 this is sufficient because
 * the resolver fully drives storefront output via Phase 6 polish (T060).
 * Per the contract, the public read currently delegates to
 * `CatalogQueryService.pickLang`, which is the canonical fallback chain
 * pending the resolver migration tracked by T060/T061.
 */
describe('US1 — public product language resolution', () => {
  let h: BackendServerHandle;
  let plOnlySlug: string;
  let bothLanguagesSlug: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const both = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `PUB-BOTH-${Date.now()}`,
        type: 'simple',
        name: { 'pl-PL': 'Klucz nasadowy', 'en-US': 'Socket wrench' },
        description: { 'pl-PL': 'Opis PL', 'en-US': 'Description EN' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(both.statusCode).toBe(201);
    bothLanguagesSlug = (both.json() as { data: { slug: string } }).data.slug;

    // PL-only — the EN slot is missing so the storefront should fall back.
    const plOnly = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `PUB-PL-ONLY-${Date.now()}`,
        type: 'simple',
        name: { 'pl-PL': 'Tylko polski' },
        description: { 'pl-PL': 'Tylko opis' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(plOnly.statusCode).toBe(201);
    plOnlySlug = (plOnly.json() as { data: { slug: string } }).data.slug;

    // Attach both products to the seeded `pl_retail` channel so the
    // public-read visibility gate lets them through.
    const conn = h.em().getConnection();
    const rows = await conn.execute<Array<{ id: string }>>(
      `select id from sales_channels where code = 'pl_retail'`,
      [],
      'all',
    );
    const channelId = rows[0]!.id;
    const productIds = [
      (both.json() as { data: { id: string } }).data.id,
      (plOnly.json() as { data: { id: string } }).data.id,
    ];
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)
       on conflict do nothing`,
      [channelId, productIds[0], channelId, productIds[1]],
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('Accept-Language: en-US returns the EN slot when present on the baseline', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${bothLanguagesSlug}`,
      headers: {
        'x-sales-channel': 'pl_retail',
        'accept-language': 'en-US',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Socket wrench');
  });

  it('Accept-Language: pl-PL returns the PL slot when present on the baseline', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${bothLanguagesSlug}`,
      headers: {
        'x-sales-channel': 'pl_retail',
        'accept-language': 'pl-PL',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Klucz nasadowy');
  });

  it('Accept-Language: en-US falls back to the channel default (pl-PL) when EN is missing on the baseline', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${plOnlySlug}`,
      headers: {
        'x-sales-channel': 'pl_retail',
        'accept-language': 'en-US',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Tylko polski');
  });
});
