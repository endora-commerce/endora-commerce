import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moneyDifference } from '@endora-commerce/contracts';

import { Product, Tax } from '../../helpers/package-entities.js';
import { seedBasePriceSql } from '../../helpers/price-book-sql.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * Issue #436 — the cart shows the VAT the order charges, to the cent.
 *
 * The storefront used to derive the cart's gross as net × a flat 23 %, so a
 * basket holding lines at other rates showed a gross the order that followed
 * it did not charge. The cart read now answers the VAT per rate, computed from
 * the rates the tax rules resolve for each line, by the one VAT method; this
 * file reads a mixed-rate basket (23 % + 8 % + 5 %), places it, and holds the
 * two answers equal. Delivery and the payment surcharge are chosen at checkout,
 * untaxed, so the order total less them is the cart's gross grand total.
 */

const SESSION = { b2b_session: 'stub-customer-session' };

interface CartVat {
  currency: string;
  rows: Array<{ taxRate: number; net: number; vat: number; gross: number }>;
  vatTotal: number;
  subtotalGross: number;
  grandTotalGross: number;
}

describe('#436 — cart VAT per rate equals the placed order', () => {
  let h: BackendServerHandle;
  const taxCodes: string[] = [];

  async function createProduct(type: 'simple' | 'virtual' | 'configurable', price: string, stamp: string) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `VAT436-${type}-${stamp}`,
        type,
        name: `VAT ${type} ${stamp}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
        // A virtual product is delivered by download, and only a virtual one is.
        ...(type === 'virtual' ? { downloadUrl: 'https://example.com/vat436.pdf' } : {}),
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await h.em().nativeUpdate(Product, { id }, { manageStock: false });
    await seedBasePriceSql(h.em(), id, price);
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const em = h.em();
    // One rule per product tax class; a rule naming a class outranks the default.
    for (const [productType, rate] of [
      ['simple', '0.2300'],
      ['virtual', '0.0800'],
      ['configurable', '0.0500'],
    ] as const) {
      const code = `vat436-${productType}-${stamp}`;
      taxCodes.push(code);
      em.create(Tax, { code, name: code, rate, productType, priority: 1000 });
    }
    await em.flush();

    const simpleId = await createProduct('simple', '16.50', stamp);
    const virtualId = await createProduct('virtual', '8.25', stamp);
    const configurableId = await createProduct('configurable', '7.77', stamp);
    await (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
      .handle.pricingGeneration.bump();

    // The seeded basket carries 2 × 19.99 of a simple product, at 23 %.
    await seedCartForStubCustomer(em);
    const customer = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(em),
    };
    const cartService = h.cartService()!;
    await cartService.addItem({ customer }, { productId: simpleId, quantity: 1 });
    await cartService.addItem({ customer }, { productId: virtualId, quantity: 2 });
    await cartService.addItem({ customer }, { productId: configurableId, quantity: 3 });
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeDelete(Tax, { code: { $in: taxCodes } });
    await teardownBackendServer(h);
  });

  it('answers the order’s VAT and gross on the cart read, and the order agrees', async () => {
    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(view.statusCode, view.body).toBe(200);
    const cart = (
      view.json() as {
        data: {
          subtotal: { amount: number };
          items: Array<{ taxRate?: number | null; lineGross?: { amount: number } | null; unavailable: boolean }>;
          vat: CartVat | null;
        };
      }
    ).data;
    expect(cart.items).toHaveLength(4);
    expect(cart.items.every((l) => !l.unavailable)).toBe(true);
    expect(cart.vat).not.toBeNull();
    const vat = cart.vat!;
    expect(vat.rows.map((r) => r.taxRate)).toEqual([0.05, 0.08, 0.23]);
    // 23 %: (39.98 + 16.50) × 0.23 = 12.9904 → 12.99; 8 %: 16.50 × 0.08 = 1.32;
    // 5 %: 23.31 × 0.05 = 1.1655 → 1.17.
    expect(vat.rows).toEqual([
      { taxRate: 0.05, net: 23.31, vat: 1.17, gross: 24.48 },
      { taxRate: 0.08, net: 16.5, vat: 1.32, gross: 17.82 },
      { taxRate: 0.23, net: 56.48, vat: 12.99, gross: 69.47 },
    ]);
    expect(vat.vatTotal).toBe(15.48);
    expect(vat.subtotalGross).toBe(111.77);
    // The flat 23 % the storefront applied: 96.29 × 1.23 = 118.44.
    expect(vat.subtotalGross).not.toBe(118.44);
    expect(cart.items.map((l) => l.taxRate).sort()).toEqual([0.05, 0.08, 0.23, 0.23]);

    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: SESSION,
    });
    expect(place.statusCode, place.body).toBe(201);
    const order = (
      place.json() as {
        data: { subtotal: number; taxTotal: number; deliveryTotal: number; paymentSurcharge?: number; total: number };
      }
    ).data;
    expect(order.subtotal).toBe(cart.subtotal.amount);
    expect(order.taxTotal).toBe(vat.vatTotal);
    const beforeCheckoutCharges = moneyDifference(
      moneyDifference(order.total, order.deliveryTotal),
      order.paymentSurcharge ?? 0,
    );
    expect(Number(beforeCheckoutCharges)).toBe(vat.grandTotalGross);
  });
});
