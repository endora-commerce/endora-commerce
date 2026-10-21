import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CartPlacementApplyPort } from '../../../../packages/modules/carts/src/ports/index.js';

import { CartItem, PriceDisplayModeOverride, ProductVariant } from '../../helpers/package-entities.js';
import { ensureBaseBookSql, seedBasePriceSql } from '../../helpers/price-book-sql.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { TEST_CUSTOMER_EMPTY_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { createTieredProduct, TIER_UNIT_PRICE } from '../../helpers/tiered-product-fixture.js';

/**
 * Issue #168 — `GET /api/v1/cart` shows exactly the price placement charges.
 *
 * The cart read re-priced every line through a second chain — a plain list
 * price per line, with no agreed quote price, no Product's-own-price fallback
 * and no display-mode check — while placement's drift check (and every add,
 * merge and quantity change) priced through `CartLinePricing`. So a
 * quote-seeded line read at the list price and was charged the agreed one, a
 * product priced only by its own attribute read at its stale snapshot, and a
 * product sold on request only read as orderable while placement refused it.
 *
 * The property, line by line on one basket: the price the read shows is the
 * price the placement drift check accepts as current, and a line the check
 * has no price for reads as unavailable. Every stored price is overwritten
 * with a figure no chain produces first, so the drift check reports every
 * line and the comparison covers all of them.
 */

const SESSION = { b2b_session: 'stub-empty-draft-customer-session' };
const AGREED_PRICE = '5.00';
/** Feature 160 — a product priced by its base-book row (the old own-price arm is gone, FR-018). */
const BASE_PRICE = 12;

interface ViewLine {
  id: string;
  productId: string;
  unitPrice: { amount: number; currency: string };
  unavailable: boolean;
  unavailableReason: string | null;
}

describe('#168 — the cart read shows the price placement charges', () => {
  let h: BackendServerHandle;
  let agreedProductId: string;
  let ownPriceProductId: string;
  let hiddenProductId: string;
  let variantProductId: string;
  let variantId: string;
  let customer: { customerAccountId: string; organizationId: string; salesChannelId: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    agreedProductId = await createTieredProduct(h, `read-agreed-${stamp}`);
    hiddenProductId = await createTieredProduct(h, `read-hidden-${stamp}`);
    const own = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `READ-OWN-${stamp}`,
        type: 'simple',
        name: { 'en-US': `Own price ${stamp}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(own.statusCode, own.body).toBe(201);
    ownPriceProductId = (own.json() as { data: { id: string } }).data.id;
    await seedBasePriceSql(h.em(), ownPriceProductId, BASE_PRICE);
    // D — a variant line, charged its variant's base row (base + 10 %).
    variantProductId = await createTieredProduct(h, `read-variant-${stamp}`);
    const variant = h.em().create(ProductVariant, {
      parentProductId: variantProductId,
      sku: `READ-VAR-${stamp}`,
      variantAttributeValues: {},
    });
    await h.em().persistAndFlush(variant);
    variantId = variant.id;
    const baseBook = await ensureBaseBookSql(h.em());
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "variant_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
         values (?, ?, ?, ?, 1, 'percent', 10, now(), now())`,
        [randomUUID(), baseBook, variantProductId, variantId],
      );
    await seedBasePriceSql(h.em(), variantProductId, BASE_PRICE);
    customer = {
      customerAccountId: TEST_CUSTOMER_EMPTY_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
  });

  afterAll(async () => {
    await h.em().nativeDelete(PriceDisplayModeOverride, { scope: 'product', targetId: hiddenProductId });
    await h.cartService()?.clearForCustomer(customer);
    await teardownBackendServer(h);
  });

  it('agrees with the placement drift check on every line', async () => {
    // A — seeded from an accepted quote at an agreed price below the list's.
    const seeded = await cartWritePortOf(h).replaceItemsForCustomer(
      customer,
      [{ productId: agreedProductId, quantity: 10, unitPrice: AGREED_PRICE, currency: 'PLN' }],
      { sourceQuoteRequestId: randomUUID() },
    );
    const cartId = seeded.cart.id;
    const cartService = h.cartService()!;
    // B — priced by its base-book row.
    await cartService.addItem({ customer }, { productId: ownPriceProductId, quantity: 2 });
    // D — a variant line.
    await cartService.addItem({ customer }, { productId: variantProductId, variantId, quantity: 1 });
    // C — added while orderable, then switched to "sold on request only".
    await cartService.addItem({ customer }, { productId: hiddenProductId, quantity: 1 });
    const em = h.em();
    em.create(PriceDisplayModeOverride, { scope: 'product', targetId: hiddenProductId, mode: 'none' });
    await em.flush();
    // A stored figure no chain produces, so the drift check reports every line.
    await em.nativeUpdate(CartItem, { cartId }, { unitPrice: '999.99' });

    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(view.statusCode, view.body).toBe(200);
    const lines = (view.json() as { data: { items: ViewLine[] } }).data.items;
    expect(lines).toHaveLength(4);

    const placement = (h.container.cradle as unknown as { cartPlacementApplyPort: CartPlacementApplyPort })
      .cartPlacementApplyPort;
    const drift = await placement.findPriceDrift(h.em().fork(), {
      cartId,
      organizationId: TEST_ORGANIZATION_ID,
    });
    expect(drift).toHaveLength(4);

    for (const line of lines) {
      const charged = drift.find((d) => d.cartItemId === line.id)!;
      if (charged.currentUnitPrice === null) {
        // Placement refuses the line; the read must not present it as orderable.
        expect(line.unavailable, line.productId).toBe(true);
        expect(line.unavailableReason).toBe('not_purchasable');
      } else {
        expect(line.unavailable, line.productId).toBe(false);
        expect(line.unitPrice.amount.toFixed(2), line.productId).toBe(charged.currentUnitPrice);
        expect(line.unitPrice.currency).toBe(charged.currentCurrency);
      }
    }

    const byProduct = new Map(lines.map((l) => [l.productId, l]));
    expect(byProduct.get(agreedProductId)!.unitPrice.amount.toFixed(2)).toBe(AGREED_PRICE);
    expect(byProduct.get(agreedProductId)!.unitPrice.amount.toFixed(2)).not.toBe(TIER_UNIT_PRICE);
    expect(byProduct.get(ownPriceProductId)!.unitPrice.amount).toBe(BASE_PRICE);
    expect(byProduct.get(variantProductId)!.unitPrice.amount).toBe(13.2);
    expect(byProduct.get(hiddenProductId)!.unavailable).toBe(true);

    // Feature 160 (FR-030) — the line records the tier placement prices it at.
    await placement.refreshLinePrices({ cartId, organizationId: TEST_ORGANIZATION_ID });
    const stored = await h.em().fork().find(CartItem, { cartId });
    const sourceOf = new Map(stored.map((it) => [it.productId, it.priceSource ?? null]));
    for (const d of drift) {
      if (d.currentUnitPrice === null) continue;
      expect(sourceOf.get(d.productId), d.productId).toBe(d.currentPriceSource);
    }
    expect(sourceOf.get(ownPriceProductId)).toBe('base');
    expect(sourceOf.get(agreedProductId)).toBe('agreed');
  });
});
