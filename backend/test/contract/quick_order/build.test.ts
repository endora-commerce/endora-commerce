import { Cart, CartItem } from '../../helpers/package-entities.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, QUICK_ORDER_BUILD_MAX_ITEMS, quickOrderBuildResponseSchema } from '@endora-commerce/contracts';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';

import exceljs from 'exceljs';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';


/**
 * Feature 039 (US1) — quick-order Excel import + build to Cart / Quote Request.
 *
 * Seed SKUs come from the seed-catalog fixture (EXAMPLE-SIMPLE-001 /
 * EXAMPLE-BLUE-002). The `stub-customer-session` actor belongs to
 * TEST_ORGANIZATION, so the build → quote_request path is exercised too.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const SIMPLE_SKU = 'EXAMPLE-SIMPLE-001';
const BLUE_SKU = 'EXAMPLE-BLUE-002';

async function xlsxBase64(rows: Array<Array<string | number>>): Promise<string> {
  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString('base64');
}

describe('Quick-order Excel import + build', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('imports an .xlsx file and recognizes valid rows', async () => {
    const contentBase64 = await xlsxBase64([
      ['sku', 'quantity'],
      [SIMPLE_SKU, 3],
      ['NOT-A-REAL-SKU', 2],
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: COOKIE,
      payload: { file: { filename: 'order.xlsx', contentBase64 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        recognized: Array<{ sku: string; quantity: number }>;
        rejected: Array<{ reason: string }>;
        summary: { recognizedCount: number; rejectedCount: number };
      };
    };
    expect(body.data.recognized).toHaveLength(1);
    expect(body.data.recognized[0]?.sku).toBe(SIMPLE_SKU);
    expect(body.data.recognized[0]?.quantity).toBe(3);
    expect(body.data.rejected[0]?.reason).toBe('product_not_found');
    expect(body.data.summary.recognizedCount).toBe(1);
  });

  it('builds a Cart from recognized lines', async () => {
    // Resolve the seed product ids via an import first.
    const importRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: COOKIE,
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},2\n${BLUE_SKU},1` },
    });
    const recognized = (importRes.json() as { data: { recognized: Array<{ productId: string; variantId: string | null; quantity: number }> } })
      .data.recognized;
    expect(recognized.length).toBe(2);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      cookies: COOKIE,
      payload: {
        target: 'cart',
        items: recognized.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
        })),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { target: string; cartId: string; checkoutUrl: string } };
    expect(body.data.target).toBe('cart');
    expect(body.data.cartId).toBeTruthy();
    expect(body.data.checkoutUrl).toContain(body.data.cartId);

    // The cart for this customer now carries the imported lines.
    const em = h.em();
    const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    expect(cart).not.toBeNull();
    const items = await em.find(CartItem, { cartId: cart!.id });
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a Quote Request from recognized lines', async () => {
    const importRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: COOKIE,
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},4` },
    });
    const recognized = (importRes.json() as { data: { recognized: Array<{ productId: string; variantId: string | null; quantity: number }> } })
      .data.recognized;

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      cookies: COOKIE,
      payload: {
        target: 'quote_request',
        items: recognized.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
        })),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { target: string; quoteRequestId: string } };
    expect(body.data.target).toBe('quote_request');
    expect(body.data.quoteRequestId).toBeTruthy();
  });

  /**
   * Feature 155, Phase 9 (T067) — the buyer's build judges the batch with the
   * cart and reports the lines below a minimum; the preview judges the file
   * (US4 #1, #1b, #16, #17; FR-011, FR-035, FR-038; threats F1, F4).
   *
   * A: simple, minimum 10. D: simple, no minimum. H: minimum 10, published on
   * no channel — hidden from every buyer request. The buyer's basket is closed
   * before every case, so each one starts from an empty cart.
   */
  describe('155 — order minimums', () => {
    const RUN = minimumFixtureRun();
    let A: MinimumProductFixture;
    let D: MinimumProductFixture;
    let H: MinimumProductFixture;

    interface BuildBody {
      data: {
        target: string;
        cartId?: string;
        rejected?: Array<{
          productId: string;
          variantId: string | null;
          quantity: number;
          productName: string;
          reason: string;
          kind: string;
          minimum: number;
        }>;
      };
    }
    interface ErrorBody {
      error: { code: string; message: string; details?: Record<string, unknown> };
    }

    beforeAll(async () => {
      const em = h.em();
      const channels = await buyerChannelIds(em);
      A = await createMinimumProduct(em, {
        sku: `QOB-A-${RUN}`,
        nameEn: `Anchor ${RUN}`,
        namePl: `Kotwa ${RUN}`,
        minOrderQuantity: 10,
        channelIds: channels,
      });
      D = await createMinimumProduct(em, {
        sku: `QOB-D-${RUN}`,
        nameEn: `Dowel ${RUN}`,
        namePl: `Kolek ${RUN}`,
        channelIds: channels,
      });
      H = await createMinimumProduct(em, {
        sku: `QOB-H-${RUN}`,
        nameEn: `Hidden hinge ${RUN}`,
        namePl: `Ukryty zawias ${RUN}`,
        minOrderQuantity: 10,
        channelIds: [],
      });
    }, 60_000);

    beforeEach(async () => {
      await h
        .em()
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
    });

    const fixtureLines = async () => {
      const em = h.em();
      em.clear();
      const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
      if (!cart) return [];
      const items = await em.find(CartItem, { cartId: cart.id }, { filters: false });
      return items
        .filter((i) => [A.id, D.id, H.id].includes(i.productId))
        .map((i) => [i.productId, i.quantity] as const);
    };

    const build = (items: Array<{ productId: string; quantity: number }>, acceptLanguage = 'en') =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/build',
        cookies: COOKIE,
        headers: { 'accept-language': acceptLanguage },
        payload: { target: 'cart', items },
      });

    it('US4 #1 — A × 5 and D × 1 to the cart: D added, A rejected below_minimum with 10', async () => {
      const res = await build(
        [
          { productId: A.id, quantity: 5 },
          { productId: D.id, quantity: 1 },
        ],
        'pl',
      );
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as BuildBody;
      expect(body.data.rejected).toEqual([
        {
          productId: A.id,
          variantId: null,
          quantity: 5,
          // Feature 172 (FR-030) — named at the basket's (channel, language): the request names
          // no channel, the system default offers en-US alone, so the Global name.
          productName: A.nameEn,
          reason: 'below_minimum',
          kind: 'pieces',
          minimum: 10,
        },
      ]);
      // The wire shape is the contract's: parsing strips nothing. `packagingUnitName`
      // is optional and set only on a `packaging_unit` refusal — a build line carries
      // no packaging unit today, so that case is pinned by the service's unit test.
      expect(quickOrderBuildResponseSchema.parse(body.data)).toEqual(body.data);
      expect(body.data.rejected?.[0]).not.toHaveProperty('packagingUnitName');
      expect(await fixtureLines()).toEqual([[D.id, 1]]);
    });

    it('US4 #1b — the cart holds A × 8: the preview rejects A × 5, the build adds it (total 13)', async () => {
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: TEST_CUSTOMER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
        },
        [{ productId: A.id, quantity: 8, unitPrice: '10.00', currency: 'PLN' }],
      );

      const preview = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/import',
        cookies: COOKIE,
        payload: { csv: `sku,quantity\n${A.sku},5` },
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const previewBody = preview.json() as {
        data: { recognized: unknown[]; rejected: Array<{ reason: string; minimum?: number; productTotal?: number }> };
      };
      expect(previewBody.data.recognized).toEqual([]);
      expect(previewBody.data.rejected).toEqual([
        { line: 2, raw: `${A.sku},5`, reason: 'below_minimum', minimum: 10, productTotal: 5 },
      ]);

      const res = await build([{ productId: A.id, quantity: 5 }]);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as BuildBody).data.rejected).toEqual([]);
      const aTotal = (await fixtureLines())
        .filter(([productId]) => productId === A.id)
        .reduce((sum, [, quantity]) => sum + quantity, 0);
      expect(aTotal).toBe(13);
    });

    it('US4 #16 — a hidden product in a build answers the unknown id 404, and nothing of the batch is added [F1]', async () => {
      const hidden = await build([
        { productId: D.id, quantity: 1 },
        { productId: H.id, quantity: 5 },
      ]);
      const unknown = await build([
        { productId: D.id, quantity: 1 },
        { productId: randomUUID(), quantity: 5 },
      ]);
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(unknown.statusCode, unknown.body).toBe(404);
      const hiddenError = (hidden.json() as ErrorBody).error;
      const unknownError = (unknown.json() as ErrorBody).error;
      expect(hiddenError.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect({ code: hiddenError.code, message: hiddenError.message, details: hiddenError.details }).toEqual({
        code: unknownError.code,
        message: unknownError.message,
        details: unknownError.details,
      });
      expect(hidden.body).not.toContain(H.nameEn);
      expect(hidden.body).not.toContain('below_minimum');
      expect(await fixtureLines()).toEqual([]);
    });

    it('US4 #17 — 201 items refused 422 too_many_items, nothing added', async () => {
      const items = Array.from({ length: QUICK_ORDER_BUILD_MAX_ITEMS + 1 }, () => ({ productId: D.id, quantity: 1 }));
      const res = await build(items);
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(error.details).toMatchObject({ code: 'too_many_items', maximum: QUICK_ORDER_BUILD_MAX_ITEMS });
      expect(await fixtureLines()).toEqual([]);

      const quote = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/build',
        cookies: COOKIE,
        payload: { target: 'quote_request', items },
      });
      expect(quote.statusCode, quote.body).toBe(422);
      expect((quote.json() as ErrorBody).error.details).toMatchObject({ code: 'too_many_items' });
    });
  });
});
