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
 * Issue #227 — the seams that take a product id or SKU from the caller.
 *
 * The public catalogue is where a restricted product is *disclosed*; these are
 * the paths that let a caller act on one they were never shown, and then have
 * the platform render its name and price back to them on every later read of
 * the container. Each of them held a `CatalogProductRecord` — which carries
 * both `visibility` and `allowedOrganizationIds` — and applied neither.
 *
 * `quick-order/import` is the one that discloses on its own. The type-ahead
 * beside it has scoped by organisation since issue #174; the pasted-SKU list
 * had not, so it resolved any SKU on the platform to a product id. A SKU list
 * is the easier of the two to enumerate, which is why the closure is at the
 * lookup: a restricted SKU and an unknown one must come back as the same
 * `product_not_found`, or the rejection reason is the oracle the lookup was.
 *
 * One signed-in buyer, three products, and the direction of the restriction
 * flipped between them — that is what tells "refuses everything" apart from
 * "refuses the right thing":
 *
 *   - `OTHER_ORG_SKU`      allow-list names an organisation that is not the
 *                          buyer's → refused, though `visibility` says
 *                          `public`;
 *   - `ORG_RESTRICTED_SKU` `organization_restricted` with an empty allow-list
 *                          → refused for everybody;
 *   - `ALLOWED_ORG_SKU`    allow-list names the buyer's organisation → served,
 *                          though `visibility` says `organization_restricted`.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

const ORG_RESTRICTED_SKU = 'ACQ-VIS-RESTRICTED-0001';
const OTHER_ORG_SKU = 'ACQ-VIS-OTHERORG-0001';
const ALLOWED_ORG_SKU = 'ACQ-VIS-ALLOWED-0001';

const ids = new Map<string, string>();
const idOf = (sku: string): string => {
  const id = ids.get(sku);
  if (!id) throw new Error(`fixture ${sku} was not seeded`);
  return id;
};

describe('a caller cannot acquire or probe a product they may not see', () => {
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
      { sku: ORG_RESTRICTED_SKU, visibility: 'organization_restricted', allowedOrganizationIds: [] },
      { sku: OTHER_ORG_SKU, visibility: 'public', allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID] },
      { sku: ALLOWED_ORG_SKU, visibility: 'organization_restricted', allowedOrganizationIds: [TEST_ORGANIZATION_ID] },
    ];

    for (const fixture of fixtures) {
      const product = em.create(Product, {
        sku: fixture.sku,
        slug: fixture.sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Acquisition visibility probe ${fixture.sku}` },
        description: { 'en-US': 'Bound to pl_retail.' },
        visibility: fixture.visibility,
        allowedOrganizationIds: fixture.allowedOrganizationIds,
        attributeValues: { defaultPrice: 10 },
      });
      await em.persistAndFlush(product);
      ids.set(fixture.sku, product.id);
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

  describe('POST /api/v1/cart/items', () => {
    const add = (sku: string, cookies?: Record<string, string>) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        headers: CHANNEL,
        ...(cookies ? { cookies } : {}),
        payload: { productId: idOf(sku), quantity: 1 },
      });

    it('refuses a product restricted to another organisation', async () => {
      expect((await add(OTHER_ORG_SKU, BUYER)).statusCode).toBe(404);
    });

    it('refuses an organization_restricted product with an empty allow-list', async () => {
      expect((await add(ORG_RESTRICTED_SKU, BUYER)).statusCode).toBe(404);
    });

    it('refuses an anonymous shopper any restricted product', async () => {
      expect((await add(ALLOWED_ORG_SKU)).statusCode).toBe(404);
    });

    it('accepts the product whose allow-list names the buyer’s organisation', async () => {
      expect((await add(ALLOWED_ORG_SKU, BUYER)).statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/comparisons/me/products', () => {
    const add = (sku: string, cookies?: Record<string, string>) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        headers: CHANNEL,
        ...(cookies ? { cookies } : {}),
        payload: { productId: idOf(sku) },
      });

    it('refuses a product restricted to another organisation', async () => {
      expect((await add(OTHER_ORG_SKU, BUYER)).statusCode).toBe(404);
    });

    it('refuses an anonymous shopper a product restricted to an organisation', async () => {
      expect((await add(ALLOWED_ORG_SKU)).statusCode).toBe(404);
    });

    it('accepts the product whose allow-list names the buyer’s organisation', async () => {
      const res = await add(ALLOWED_ORG_SKU, BUYER);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/shopping-lists/default/items', () => {
    const add = (sku: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/shopping-lists/default/items',
        headers: CHANNEL,
        cookies: BUYER,
        payload: { productId: idOf(sku), quantity: 1 },
      });

    it('refuses a product restricted to another organisation', async () => {
      expect((await add(OTHER_ORG_SKU)).statusCode).toBe(404);
    });

    it('refuses an organization_restricted product with an empty allow-list', async () => {
      expect((await add(ORG_RESTRICTED_SKU)).statusCode).toBe(404);
    });

    it('accepts the product whose allow-list names the buyer’s organisation', async () => {
      expect((await add(ALLOWED_ORG_SKU)).statusCode).toBe(201);
    });
  });

  describe('POST /api/v1/quote-requests', () => {
    const submit = (sku: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        headers: CHANNEL,
        cookies: BUYER,
        payload: { items: [{ productId: idOf(sku), quantity: 1 }] },
      });

    it('refuses a line naming a product restricted to another organisation', async () => {
      expect((await submit(OTHER_ORG_SKU)).statusCode).toBe(404);
    });

    it('accepts a line naming the buyer’s own restricted product', async () => {
      expect((await submit(ALLOWED_ORG_SKU)).statusCode).toBe(201);
    });
  });

  describe('POST /api/v1/quick-order/import — the SKU oracle', () => {
    async function reasonsFor(sku: string): Promise<{
      recognizedSkus: string[];
      reasons: string[];
    }> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/import',
        headers: CHANNEL,
        cookies: BUYER,
        payload: { csv: ['sku,quantity', `${sku},1`].join('\n') },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          recognized: Array<{ sku: string }>;
          rejected: Array<{ reason: string }>;
        };
      };
      return {
        recognizedSkus: body.data.recognized.map((r) => r.sku),
        reasons: body.data.rejected.map((r) => r.reason),
      };
    }

    it('does not resolve a SKU restricted to another organisation to a product id', async () => {
      const { recognizedSkus, reasons } = await reasonsFor(OTHER_ORG_SKU);
      expect(recognizedSkus).toHaveLength(0);
      expect(reasons).toEqual(['product_not_found']);
    });

    it('answers a restricted SKU exactly as it answers a SKU nobody sells', async () => {
      // The point of the assertion: a distinct rejection reason would keep the
      // oracle open with one more step of inference.
      const restricted = await reasonsFor(ORG_RESTRICTED_SKU);
      const nonexistent = await reasonsFor('ACQ-VIS-NO-SUCH-SKU-0001');
      expect(restricted).toEqual(nonexistent);
    });

    it('still resolves the buyer’s own restricted SKU', async () => {
      const { recognizedSkus } = await reasonsFor(ALLOWED_ORG_SKU);
      expect(recognizedSkus).toEqual([ALLOWED_ORG_SKU]);
    });
  });

  describe('the anonymous storefront probes', () => {
    it('does not price a product restricted to an organisation for an anonymous caller', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${idOf(ALLOWED_ORG_SKU)}/resolved-price`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(404);
    });

    it('does not report a display mode for one either', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/pricing/display-mode/${idOf(ORG_RESTRICTED_SKU)}`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(404);
    });

    it('does not report stock for a product restricted to another organisation', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/inventory/stock/${idOf(OTHER_ORG_SKU)}`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(404);
    });

    it('still prices a product the buyer’s organisation is allowed', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${idOf(ALLOWED_ORG_SKU)}/resolved-price`,
        headers: CHANNEL,
        cookies: BUYER,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
