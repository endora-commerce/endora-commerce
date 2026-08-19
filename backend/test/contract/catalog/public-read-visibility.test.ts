import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Issue #227 — the public catalogue is the surface issue #174 was the warning
 * about.
 *
 * `catalog`'s own storefront read paths filtered `status`, `deleted_at` and
 * channel membership, and nothing else. `visibility` and
 * `allowed_organization_ids` were read by no query on this surface, so a
 * product an operator marked `organization_restricted` — or `public` with an
 * allow-list naming one distributor — was served to an anonymous `GET` of the
 * product detail, and listed by `GET /api/v1/catalog/products`. The two columns
 * have been settable from the product editor and the bulk-edit dialog the whole
 * time, which is what makes this a live disclosure rather than a gap in an
 * unshipped feature.
 *
 * Three callers, because the answer differs for each and a fix that collapses
 * them is not a fix:
 *
 *   - **anonymous** — the crawler and the logged-out shopper;
 *   - **a buyer of another organisation** — signed in, and still not on this
 *     product's allow-list. Without this caller "not disclosed" cannot be told
 *     apart from "disclosed to everybody who is logged in";
 *   - **a buyer of the allow-listed organisation** — the restoration half. A
 *     filter that returns nothing to nobody passes every refusal assertion.
 *
 * Every fixture is bound to `pl_retail`, so the channel filter that already
 * worked cannot be what excludes any of these rows.
 */

const ALLOWED_BUYER = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_BUYER = { b2b_session: 'stub-customer-session-other-org' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

const ORG_RESTRICTED_SKU = 'CAT-VIS-RESTRICTED-0001';
const OTHER_ORG_SKU = 'CAT-VIS-OTHERORG-0001';
const ALLOWED_ORG_SKU = 'CAT-VIS-ALLOWED-0001';
const LOGGED_IN_SKU = 'CAT-VIS-LOGGEDIN-0001';
const PUBLIC_SKU = 'CAT-VIS-PUBLIC-0001';

const slugFor = (sku: string): string => sku.toLowerCase();

async function listSkus(
  h: BackendServerHandle,
  sku: string,
  cookies?: Record<string, string>,
): Promise<string[]> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/catalog/products?q=${encodeURIComponent(sku)}`,
    headers: CHANNEL,
    ...(cookies ? { cookies } : {}),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Array<{ sku: string }> }).data.map((p) => p.sku);
}

async function detailStatus(
  h: BackendServerHandle,
  sku: string,
  cookies?: Record<string, string>,
): Promise<number> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/catalog/products/${slugFor(sku)}`,
    headers: CHANNEL,
    ...(cookies ? { cookies } : {}),
  });
  return res.statusCode;
}

describe('public catalog reads honour visibility and the organisation allow-list', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
    expect(retail, 'the harness seeds pl_retail').not.toBeNull();

    const fixtures: Array<{
      sku: string;
      visibility: 'public' | 'logged_in_only' | 'organization_restricted';
      allowedOrganizationIds: string[];
    }> = [
      // Restricted, naming nobody — visible to nobody, not to everybody.
      { sku: ORG_RESTRICTED_SKU, visibility: 'organization_restricted', allowedOrganizationIds: [] },
      // `public`, with an allow-list. The allow-list restricts on its own.
      { sku: OTHER_ORG_SKU, visibility: 'public', allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID] },
      { sku: ALLOWED_ORG_SKU, visibility: 'organization_restricted', allowedOrganizationIds: [TEST_ORGANIZATION_ID] },
      { sku: LOGGED_IN_SKU, visibility: 'logged_in_only', allowedOrganizationIds: [] },
      { sku: PUBLIC_SKU, visibility: 'public', allowedOrganizationIds: [] },
    ];

    for (const fixture of fixtures) {
      const product = em.create(Product, {
        sku: fixture.sku,
        slug: slugFor(fixture.sku),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Catalog visibility probe ${fixture.sku}` },
        description: { 'en-US': 'Bound to pl_retail.' },
        visibility: fixture.visibility,
        allowedOrganizationIds: fixture.allowedOrganizationIds,
        attributeValues: { defaultPrice: 10 },
      });
      await em.persistAndFlush(product);
      await em
        .getConnection()
        .execute(
          `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
          [retail!.id, product.id],
        );
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('GET /api/v1/catalog/products — the listing', () => {
    it('withholds an organization_restricted product with an empty allow-list from everybody', async () => {
      expect(await listSkus(h, ORG_RESTRICTED_SKU)).not.toContain(ORG_RESTRICTED_SKU);
      expect(await listSkus(h, ORG_RESTRICTED_SKU, OTHER_ORG_BUYER)).not.toContain(ORG_RESTRICTED_SKU);
      expect(await listSkus(h, ORG_RESTRICTED_SKU, ALLOWED_BUYER)).not.toContain(ORG_RESTRICTED_SKU);
    });

    it('withholds a product whose allow-list names another organisation', async () => {
      expect(
        await listSkus(h, OTHER_ORG_SKU),
        'anonymous callers are not on any allow-list',
      ).not.toContain(OTHER_ORG_SKU);
      expect(
        await listSkus(h, OTHER_ORG_SKU, ALLOWED_BUYER),
        'a non-empty allow-list restricts whatever the visibility column says',
      ).not.toContain(OTHER_ORG_SKU);
    });

    it('withholds a logged_in_only product from an anonymous caller', async () => {
      expect(await listSkus(h, LOGGED_IN_SKU)).not.toContain(LOGGED_IN_SKU);
    });

    it('serves a restricted product to the organisation on its allow-list', async () => {
      expect(await listSkus(h, ALLOWED_ORG_SKU, ALLOWED_BUYER)).toContain(ALLOWED_ORG_SKU);
      expect(await listSkus(h, OTHER_ORG_SKU, OTHER_ORG_BUYER)).toContain(OTHER_ORG_SKU);
    });

    it('serves a logged_in_only product to any signed-in buyer, and a public one to everybody', async () => {
      expect(await listSkus(h, LOGGED_IN_SKU, OTHER_ORG_BUYER)).toContain(LOGGED_IN_SKU);
      expect(await listSkus(h, PUBLIC_SKU)).toContain(PUBLIC_SKU);
    });
  });

  describe('GET /api/v1/catalog/products/:idOrSlug — the product detail', () => {
    it('404s an organization_restricted product with an empty allow-list, for everybody', async () => {
      expect(await detailStatus(h, ORG_RESTRICTED_SKU)).toBe(404);
      expect(await detailStatus(h, ORG_RESTRICTED_SKU, ALLOWED_BUYER)).toBe(404);
    });

    it('404s a product whose allow-list names another organisation', async () => {
      expect(await detailStatus(h, OTHER_ORG_SKU)).toBe(404);
      expect(await detailStatus(h, OTHER_ORG_SKU, ALLOWED_BUYER)).toBe(404);
    });

    it('404s a logged_in_only product for an anonymous caller', async () => {
      expect(await detailStatus(h, LOGGED_IN_SKU)).toBe(404);
    });

    it('serves the restricted product to the organisation on its allow-list', async () => {
      expect(await detailStatus(h, ALLOWED_ORG_SKU, ALLOWED_BUYER)).toBe(200);
      expect(await detailStatus(h, OTHER_ORG_SKU, OTHER_ORG_BUYER)).toBe(200);
      expect(await detailStatus(h, LOGGED_IN_SKU, ALLOWED_BUYER)).toBe(200);
      expect(await detailStatus(h, PUBLIC_SKU)).toBe(200);
    });
  });

  describe('GET /api/v1/catalog/products/:idOrSlug/links — the related-products strip', () => {
    it('404s before it can name a restricted product as the strip’s subject', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${slugFor(ORG_RESTRICTED_SKU)}/links`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
