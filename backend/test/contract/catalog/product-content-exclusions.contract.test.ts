import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-040 – FR-047,
 * research R-14, R-15) — every phase-1 exclusion of a Page Builder content
 * attribute, asserted as a refusal or an omission. Most hold **structurally**:
 * a content attribute cannot carry the capability flag a consumer selects on
 * (research R-6), so nothing in the consumer changes.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CONTENT_KEY = 'pbx_buying_guide';

describe('Product content exclusions (feature 172)', () => {
  let h: BackendServerHandle;
  let contentAttributeId: string;
  let setId: string;
  let productId: string;
  let readToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const attribute = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN,
      payload: {
        key: CONTENT_KEY,
        label: { 'en-US': 'Buying guide', 'pl-PL': 'Poradnik zakupowy' },
        type: 'page_builder',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);
    contentAttributeId = (attribute.json() as { data: { id: string } }).data.id;

    const set = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: ADMIN,
      payload: { code: 'pbx_power_tools', name: { 'en-US': 'Power tools' }, attributeIds: [contentAttributeId] },
    });
    expect(set.statusCode, set.body).toBe(201);
    setId = (set.json() as { data: { id: string } }).data.id;

    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: 'PBX-DRILL-1',
        type: 'simple',
        name: 'Exclusion drill',
        description: 'A drill',
        categoryIds: [],
        attributeSetId: setId,
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(product.statusCode, product.body).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;

    const key = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: { name: 'Content exclusion reader', scopes: ['catalog:read'] },
    });
    expect(key.statusCode, key.body).toBe(201);
    readToken = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('definition-driven exclusions', () => {
    it('refuses a channel override for the content key (FR-040)', async () => {
      const channels = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select id from sales_channels where code = 'pl_retail'`, [], 'all');
      const channelId = channels[0]!.id;
      await h
        .em()
        .getConnection()
        .execute(
          `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
          [channelId, productId],
        );
      // Feature 174 — channel values are written through the scoped save; `…/value-overrides` is gone.
      const read = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/products/${productId}/scoped-values?channelId=${channelId}`,
        cookies: ADMIN,
      });
      expect(read.statusCode, read.body).toBe(200);
      const version = (read.json() as { data: { version: string } }).data.version;
      for (const scope of [{ channelId }, { channelId, languageCode: 'pl-PL' }]) {
        const res = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/catalog/products/${productId}/scoped-values`,
          cookies: ADMIN,
          payload: { scope, version, changes: { attributes: { [CONTENT_KEY]: 'x' } } },
        });
        expect(res.statusCode, res.body).toBe(422);
      }
      const stored = await h
        .em()
        .getConnection()
        .execute<Array<{ n: number }>>(
          `select count(*)::int as n from product_value_overrides where attribute_key = ?`,
          [CONTENT_KEY],
          'all',
        );
      expect(stored[0]!.n).toBe(0);
    });

    it('is not offered to bulk edit, and a bulk update naming it is refused (FR-043)', async () => {
      const byFlag = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/attributes/by-flag?flag=isMassEditable',
        cookies: ADMIN,
      });
      expect(byFlag.statusCode).toBe(200);
      const keys = (byFlag.json() as { data: { items: Array<{ key: string }> } }).data.items.map((i) => i.key);
      expect(keys).not.toContain(CONTENT_KEY);

      const bulk = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/bulk-update',
        cookies: ADMIN,
        payload: { productIds: [productId], fields: { attributeValues: { [CONTENT_KEY]: 'text' } } },
      });
      expect(bulk.statusCode, bulk.body).toBe(400);
      expect((bulk.json() as { error: { code: string } }).error.code).toBe('ATTRIBUTE_NOT_MASS_EDITABLE');
    });

    it('is omitted from the promotions, price-list, comparison and filter pickers (FR-046)', async () => {
      const promo = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/promotions/rule-targets/attributes',
        cookies: ADMIN,
      });
      expect(promo.statusCode, promo.body).toBe(200);
      expect((promo.json() as { data: { items: Array<{ key: string }> } }).data.items.map((i) => i.key)).not.toContain(
        CONTENT_KEY,
      );

      const priceRule = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/price-books/targets/attributes',
        cookies: ADMIN,
      });
      expect(priceRule.statusCode, priceRule.body).toBe(200);
      expect(
        (priceRule.json() as { data: { items: Array<{ key: string }> } }).data.items.map((i) => i.key),
      ).not.toContain(CONTENT_KEY);

      const query = h.container.resolve<{ comparableAttributeKeys(): Promise<string[]> }>('catalogQueryPort');
      expect(await query.comparableAttributeKeys()).not.toContain(CONTENT_KEY);

      const filters = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/filters',
        headers: { 'x-sales-channel': 'pl_retail' },
      });
      expect(filters.statusCode).toBe(200);
      expect((filters.json() as { data: Array<{ attributeKey: string }> }).data.map((f) => f.attributeKey)).not.toContain(
        CONTENT_KEY,
      );
    });

    it('omits the member from the integration set read, and keeps it on the admin read (FR-042)', async () => {
      const external = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/attribute-sets/${setId}`,
        headers: { authorization: `Bearer ${readToken}` },
      });
      expect(external.statusCode, external.body).toBe(200);
      const externalKeys = (external.json() as { data: { attributes: Array<{ key: string }> } }).data.attributes.map(
        (a) => a.key,
      );
      expect(externalKeys).not.toContain(CONTENT_KEY);

      const admin = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/attribute-sets/${setId}`,
        cookies: ADMIN,
      });
      const adminKeys = (admin.json() as { data: { attributes: Array<{ key: string }> } }).data.attributes.map(
        (a) => a.key,
      );
      expect(adminKeys).toContain(CONTENT_KEY);
    });

    it('is not offered as a feed field, and a template naming it is refused (FR-044)', async () => {
      const sources = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/feed-templates/field-sources',
        cookies: ADMIN,
      });
      expect(sources.statusCode, sources.body).toBe(200);
      const offered = (
        sources.json() as { data: { groups: Array<{ sources: Array<{ sourceKey: string | null }> }> } }
      ).data.groups.flatMap((group) => group.sources.map((source) => source.sourceKey));
      expect(offered).toContain('color');
      expect(offered).not.toContain(CONTENT_KEY);

      const template = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/feed-templates',
        cookies: ADMIN,
        payload: {
          name: 'Content template 172',
          fields: [{ outputName: 'guide', sourceKind: 'attribute', sourceKey: CONTENT_KEY, sortOrder: 0 }],
        },
      });
      expect(template.statusCode, template.body).toBe(400);
      expect((template.json() as { error: { details?: { sourceKey?: string } } }).error.details?.sourceKey).toBe(
        CONTENT_KEY,
      );
    });
  });

  describe('ordinary value path', () => {
    type Refusal = { error: { code: string; details?: Array<{ path: string; issue: string }> } };
    const expectRefusal = (res: { statusCode: number; body: string; json: () => unknown }): void => {
      expect(res.statusCode, res.body).toBe(400);
      const body = res.json() as Refusal;
      expect(body.error.code).toBe('ATTRIBUTE_VALUE_REJECTED');
      expect(body.error.details?.map((detail) => detail.path)).toContain(`attributeValues.${CONTENT_KEY}`);
    };

    it('refuses the content key on an admin create (FR-014)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        cookies: ADMIN,
        payload: {
          sku: 'PBX-CREATE-REFUSED',
          type: 'simple',
          name: 'Refused',
          description: 'Refused',
          categoryIds: [],
          attributeSetId: setId,
          attributeValues: { [CONTENT_KEY]: { languages: {} } },
          visibility: 'public',
        },
      });
      expectRefusal(res);
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ n: number }>>(`select count(*)::int as n from products where sku = 'PBX-CREATE-REFUSED'`, [], 'all');
      expect(rows[0]!.n).toBe(0);
    });

    it('refuses the content key on an admin PATCH, even when it is resent as already stored (FR-014)', async () => {
      const patch = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}`,
        cookies: ADMIN,
        payload: { attributeValues: { [CONTENT_KEY]: 'smuggled text' } },
      });
      expectRefusal(patch);

      // A value under the key that is somehow already on the row does not
      // exempt it: the refusal comes before the "already stored" exemption.
      await h
        .em()
        .getConnection()
        .execute(`update products set attribute_values = attribute_values || ?::jsonb where id = ?`, [
          JSON.stringify({ [CONTENT_KEY]: 'legacy' }),
          productId,
        ]);
      try {
        const resent = await h.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/catalog/products/${productId}`,
          cookies: ADMIN,
          payload: { attributeValues: { [CONTENT_KEY]: 'legacy' } },
        });
        expectRefusal(resent);
      } finally {
        await h
          .em()
          .getConnection()
          .execute(`update products set attribute_values = attribute_values - ? where id = ?`, [CONTENT_KEY, productId]);
      }
    });

    it('refuses the content key on the integration upsert by SKU (FR-042 inbound)', async () => {
      const key = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        cookies: ADMIN,
        payload: { name: 'Content exclusion writer', scopes: ['catalog:write'] },
      });
      expect(key.statusCode, key.body).toBe(201);
      const writeToken = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/catalog/products/by-sku/PBX-UPSERT-REFUSED',
        headers: { authorization: `Bearer ${writeToken}` },
        payload: {
          sku: 'PBX-UPSERT-REFUSED',
          type: 'simple',
          name: 'Upsert refused',
          description: 'Upsert refused',
          categoryIds: [],
          attributeSetId: setId,
          attributeValues: { [CONTENT_KEY]: '<p>html</p>' },
          visibility: 'public',
        },
      });
      expectRefusal(res);
    });
  });

  describe('stored content never leaks', () => {
    const DEFAULT_ATTRIBUTE_SET_ID = 'defa0017-0000-4000-8000-000000000000';
    const WORD = 'zygomorphicquartz';
    let retailChannelId: string;
    let listBefore: string;
    let searchBefore: string;
    let listed: Array<{ id: string; slug: string }>;

    const list = (query = '') =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=100${query}`,
        headers: { 'x-sales-channel': 'pl_retail' },
      });

    beforeAll(async () => {
      const channels = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select id from sales_channels where code = 'pl_retail'`, [], 'all');
      retailChannelId = channels[0]!.id;

      const before = await list();
      expect(before.statusCode).toBe(200);
      listBefore = before.body;
      listed = (before.json() as { data: Array<{ id: string; slug: string }> }).data;
      expect(listed.length).toBeGreaterThan(0);
      searchBefore = (await list('&q=drill')).body;

      const assigned = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/attribute-sets/${DEFAULT_ATTRIBUTE_SET_ID}/attributes`,
        cookies: ADMIN,
        payload: { assignments: [{ attributeId: contentAttributeId, position: 99 }] },
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      const document = {
        root: { props: {} },
        content: [{ type: 'RichContent', props: { id: 'leak', html: `<p>${WORD} drill guide</p>` } }],
      };
      for (const product of listed) {
        const put = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/catalog/products/${product.id}/content/${CONTENT_KEY}`,
          cookies: ADMIN,
          payload: { content: { languages: { 'en-US': document, 'pl-PL': document } } },
        });
        expect(put.statusCode, `${product.slug}: ${put.body}`).toBe(200);
      }
    });

    it('leaves the product list and the search response byte-identical (FR-011, FR-036, SC-006)', async () => {
      expect((await list()).body).toBe(listBefore);
      expect((await list('&q=drill')).body).toBe(searchBefore);
    });

    it('matches no product on a word found only in content, nor in quick search (FR-045)', async () => {
      const search = await list(`&q=${WORD}`);
      expect(search.statusCode).toBe(200);
      expect((search.json() as { data: unknown[] }).data).toEqual([]);

      const quick = h.container.resolve<{
        quickSearch(params: Record<string, unknown>): Promise<unknown[]>;
      }>('catalogQuickSearchPort');
      expect(
        await quick.quickSearch({
          q: WORD,
          limit: 20,
          salesChannelId: retailChannelId,
          organizationId: TEST_ORGANIZATION_ID,
        }),
      ).toEqual([]);
    });

    it('keeps content out of the external product detail (FR-042 outbound)', async () => {
      const key = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        cookies: ADMIN,
        payload: {
          name: 'Content leak external reader',
          scopes: ['catalog:read'],
          binding: {
            organizationId: TEST_ORGANIZATION_ID,
            salesChannelId: retailChannelId,
            customerAccountId: TEST_CUSTOMER_ID,
          },
        },
      });
      expect(key.statusCode, key.body).toBe(201);
      const token = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/external/catalog/products/${listed[0]!.slug}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain('contentAttributes');
      expect(res.body).not.toContain(WORD);
      expect(res.body).not.toContain(CONTENT_KEY);
    });

    it('exports neither the content key nor any document text (FR-041 export)', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', cookies: ADMIN });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      expect(res.body).not.toContain(CONTENT_KEY);
      expect(res.body).not.toContain(WORD);
    });
  });
});
