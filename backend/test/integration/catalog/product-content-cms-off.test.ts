import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, US5, FR-050 – FR-052,
 * SC-004; research R-13, owner ruling OR-8) — product content while the CMS is
 * off.
 *
 * `catalog` owns the content rows and the admin routes, and `cms` owns the
 * Page Builder. With `cms` off — on **either** axis:
 *
 * - the product page's `contentAttributes` is `[]` (FR-051, backend half): the
 *   catalogue's presence probe gates the projection, so no API consumer renders
 *   content the operator switched off;
 * - the admin card list and the single read still answer (FR-050), so the card
 *   keeps showing per-language status;
 * - no stored row is touched (SC-004) — `md5(content::text)` is identical
 *   before, during and after;
 * - once `cms` is back, the page carries the content again and a save works,
 *   with no operator action (FR-052).
 *
 * This is a consumer's off-state test, so it uses `withModuleOff`;
 * `cms`' own `expectModuleAbsent` proof lives with `cms`.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

const tree = (text: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'RichContent', props: { id: `rc-${text.length}`, html: `<p>${text}</p>` } }],
});

interface Detail {
  contentAttributes?: Array<{ key: string; language: string; content: Record<string, unknown> }>;
}

describe('Product content with the CMS off (feature 172, US5)', () => {
  let h: BackendServerHandle;
  let setId: string;
  let retailChannelId: string;
  const run = Math.random().toString(36).slice(2, 8);
  const key = `pco_guide_${run}`;
  const products: Array<{ id: string; slug: string }> = [];

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params, 'all')) as T;
  }

  async function createVisibleProduct(serial: number): Promise<{ id: string; slug: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `PCO-172-${run}-${serial}`,
        type: 'simple',
        status: 'active',
        name: `Cms off drill ${run} ${serial}`,
        description: 'Plain description',
        categoryIds: [],
        attributeSetId: setId,
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const data = (res.json() as { data: { id: string; slug: string } }).data;
    await sql(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
      [retailChannelId, data.id],
    );
    products.push(data);
    return data;
  }

  const pdp = (slug: string) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slug}?include=content`,
      headers: { 'x-sales-channel': 'pl_retail', 'accept-language': 'en-US' },
    });
  const list = (productId: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}/content`, cookies: ADMIN });
  const getOne = (productId: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}/content/${key}`, cookies: ADMIN });
  const put = (productId: string, content: unknown) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/content/${key}`,
      cookies: ADMIN,
      payload: { content },
    });

  async function digests(): Promise<Record<string, string>> {
    const ids = products.map((p) => p.id);
    const rows = await sql<Array<{ product_id: string; digest: string }>>(
      `select product_id, md5(content::text) as digest from product_content_values
        where product_id in (${ids.map(() => '?').join(', ')}) order by product_id`,
      ids,
    );
    return Object.fromEntries(rows.map((row) => [row.product_id, row.digest]));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const channel = await sql<Array<{ id: string }>>(`select id from sales_channels where code = 'pl_retail'`);
    retailChannelId = channel[0]!.id;

    const attribute = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN,
      payload: {
        key,
        label: { 'en-US': 'Guide' },
        labelDefault: 'Guide',
        type: 'page_builder',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);
    const attributeId = (attribute.json() as { data: { id: string } }).data.id;

    const set = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: ADMIN,
      payload: { code: `pco_set_${run}`, name: { 'en-US': 'Cms off set' } },
    });
    expect(set.statusCode, set.body).toBe(201);
    setId = (set.json() as { data: { id: string } }).data.id;
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      cookies: ADMIN,
      payload: { assignments: [{ attributeId, position: 0 }] },
    });
    expect(assign.statusCode, assign.body).toBe(200);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const axes: OffStateAxis[] = ['deactivated', 'platform-unavailable'];

  for (const [index, axis] of axes.entries()) {
    it(`hides the page's content, keeps the admin reads and every row, and restores on return (${axis})`, async () => {
      const product = await createVisibleProduct(index);
      expect((await put(product.id, { languages: { 'en-US': tree(`Guide ${axis}`) } })).statusCode).toBe(200);

      // Positive control: with the CMS on, the page carries the content.
      const on = await pdp(product.slug);
      expect(on.statusCode, on.body).toBe(200);
      expect((on.json() as { data: Detail }).data.contentAttributes?.map((entry) => entry.key)).toEqual([key]);
      const before = await digests();

      await withModuleOff('cms', axis, async () => {
        // FR-051 — the page answers, and carries no content.
        const off = await pdp(product.slug);
        expect(off.statusCode, off.body).toBe(200);
        expect((off.json() as { data: Detail }).data.contentAttributes).toEqual([]);
        expect(off.body).not.toContain(`Guide ${axis}`);

        // FR-050 — the catalogue's admin reads keep answering.
        const cards = await list(product.id);
        expect(cards.statusCode, cards.body).toBe(200);
        const attributes = (cards.json() as { data: { attributes: Array<{ key: string; languages: unknown[] }> } }).data
          .attributes;
        expect(attributes.find((entry) => entry.key === key)?.languages).toHaveLength(1);
        const one = await getOne(product.id);
        expect(one.statusCode, one.body).toBe(200);
        expect((one.json() as { data: { content: unknown } }).data.content).toEqual({
          languages: { 'en-US': tree(`Guide ${axis}`) },
        });

        // SC-004 — nothing stored moved.
        expect(await digests()).toEqual(before);
      });

      // FR-052 — back on: content returns and a save works, with no operator action.
      expect(await digests()).toEqual(before);
      const back = await pdp(product.slug);
      expect((back.json() as { data: Detail }).data.contentAttributes?.map((entry) => entry.key)).toEqual([key]);
      const saved = await put(product.id, { languages: { 'en-US': tree(`Edited ${axis}`) } });
      expect(saved.statusCode, saved.body).toBe(200);
      const edited = await pdp(product.slug);
      expect(edited.body).toContain(`Edited ${axis}`);
    });
  }
});
