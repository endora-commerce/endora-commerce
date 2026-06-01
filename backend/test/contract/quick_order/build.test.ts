import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import exceljs from 'exceljs';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';

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
});
