import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  convertToCartResponseSchema,
  shoppingListListResponseSchema,
  shoppingListSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Product } from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/** Strict copies: a key a shopping-list reply carries that the contract does not declare fails (issue #599 §6). */
const strictList = deepStrict(shoppingListSchema);
const strictLists = deepStrict(shoppingListListResponseSchema);
const strictConvertToCart = deepStrict(convertToCartResponseSchema);

/**
 * T196 — `POST /shopping-lists` + add items + convert to Cart.
 * Round-trip: create list → add an item → convert-to-cart → expect
 * the cart's item count to grow.
 */

describe('Shopping list CRUD + convert-to-cart', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a list, adds an item, converts to cart', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Weekly restock' },
    });
    expect(create.statusCode).toBe(201);
    const list = (create.json() as { data: { id: string; name: string } }).data;
    expect(list.name).toBe('Weekly restock');
    expect(disagreements(strictList, list)).toEqual([]);

    const list1 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(list1.statusCode).toBe(200);
    expect((list1.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);
    expect(disagreements(strictLists, list1.json())).toEqual([]);

    const addItem = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    });
    expect(addItem.statusCode).toBe(201);
    const afterAdd = (addItem.json() as { data: { items: unknown[] } }).data;
    expect(afterAdd.items.length).toBe(1);
    expect(disagreements(strictList, afterAdd)).toEqual([]);

    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/convert-to-cart`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const result = (
      convert.json() as { data: { added: number; skipped: unknown[] } }
    ).data;
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(disagreements(strictConvertToCart, result)).toEqual([]);
  });

  it('clears all items from a list while keeping the list', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'To be cleared' },
    });
    const list = (create.json() as { data: { id: string } }).data;

    const addItem = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    expect(addItem.statusCode).toBe(201);
    expect((addItem.json() as { data: { items: unknown[] } }).data.items.length).toBe(1);

    const clear = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(clear.statusCode).toBe(204);

    // The list still exists but is now empty.
    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { data: { items: unknown[] } }).data.items.length).toBe(0);
    expect(disagreements(strictList, (after.json() as { data: unknown }).data)).toEqual([]);

    // Clearing an already-empty list is idempotent.
    const clearAgain = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(clearAgain.statusCode).toBe(204);
  });

  it('renames + deletes a list', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Temporary' },
    });
    const list = (create.json() as { data: { id: string } }).data;

    const rename = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as { data: { name: string } }).data.name).toBe('Renamed');
    expect(disagreements(strictList, (rename.json() as { data: unknown }).data)).toEqual([]);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(del.statusCode).toBe(204);
  });

  /**
   * Feature 155, Phase 9 (T068) — list → cart adds what it may and skips the
   * lines below a minimum with the minimum (US4 #3), on both routes that reach
   * `convertToCart`; a line whose product is now hidden from the buyer is
   * skipped exactly like a deleted product (FR-035, US4 #16, threat F1).
   */
  describe('155 — order minimums', () => {
    const COOKIE = { b2b_session: 'stub-customer-session' };
    const RUN = minimumFixtureRun();
    let A: MinimumProductFixture;
    let D: MinimumProductFixture;
    let H: MinimumProductFixture;

    beforeAll(async () => {
      const em = h.em();
      const channels = await buyerChannelIds(em);
      A = await createMinimumProduct(em, {
        sku: `SLM-A-${RUN}`,
        nameEn: `Anchor ${RUN}`,
        namePl: `Kotwa ${RUN}`,
        minOrderQuantity: 10,
        channelIds: channels,
      });
      D = await createMinimumProduct(em, {
        sku: `SLM-D-${RUN}`,
        nameEn: `Dowel ${RUN}`,
        namePl: `Kolek ${RUN}`,
        channelIds: channels,
      });
      H = await createMinimumProduct(em, {
        sku: `SLM-H-${RUN}`,
        nameEn: `Hinge ${RUN}`,
        namePl: `Zawias ${RUN}`,
        minOrderQuantity: 10,
        channelIds: channels,
      });
    }, 60_000);

    const closeBasket = () =>
      h
        .em()
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);

    async function listWith(lines: Array<{ productId: string; quantity: number }>): Promise<{
      id: string;
      itemIdOf: Map<string, string>;
    }> {
      const create = await h.app.inject({
        method: 'POST',
        url: '/api/v1/shopping-lists',
        cookies: COOKIE,
        payload: { name: `Minimums ${RUN} ${Math.random().toString(36).slice(2, 6)}` },
      });
      expect(create.statusCode, create.body).toBe(201);
      const id = (create.json() as { data: { id: string } }).data.id;
      let items: Array<{ id: string; productId: string }> = [];
      for (const line of lines) {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/shopping-lists/${id}/items`,
          cookies: COOKIE,
          payload: line,
        });
        expect(res.statusCode, res.body).toBe(201);
        items = (res.json() as { data: { items: Array<{ id: string; productId: string }> } }).data.items;
      }
      return { id, itemIdOf: new Map(items.map((i) => [i.productId, i.id])) };
    }

    it('US4 #3 — convert-to-cart adds D and skips A below_minimum with the minimum', async () => {
      await closeBasket();
      const list = await listWith([
        { productId: A.id, quantity: 5 },
        { productId: D.id, quantity: 1 },
      ]);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-lists/${list.id}/convert-to-cart`,
        cookies: COOKIE,
        payload: {},
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: { added: number; skipped: unknown[] } }).data;
      expect(data.added).toBe(1);
      expect(data.skipped).toEqual([
        { itemId: list.itemIdOf.get(A.id), productId: A.id, reason: 'below_minimum', minimum: 10 },
      ]);
    });

    it('US4 #3 — POST /api/v1/cart/from-shopping-list/:id reports A dropped below_minimum with the minimum', async () => {
      await closeBasket();
      const list = await listWith([
        { productId: A.id, quantity: 5 },
        { productId: D.id, quantity: 1 },
      ]);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/cart/from-shopping-list/${list.id}`,
        cookies: COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (
        res.json() as {
          data: { appendedLineCount: number; droppedLines: Array<{ productId: string; reason: string; minimum?: number }> };
        }
      ).data;
      expect(data.appendedLineCount).toBe(1);
      expect(data.droppedLines).toEqual([
        expect.objectContaining({ productId: A.id, reason: 'below_minimum', minimum: 10 }),
      ]);
    });

    it('a line whose product is now hidden is skipped product_not_found, with no minimum [F1]', async () => {
      await closeBasket();
      const list = await listWith([
        { productId: H.id, quantity: 5 },
        { productId: D.id, quantity: 1 },
      ]);
      await h.em().nativeUpdate(Product, { id: H.id }, { visibility: 'organization_restricted' });
      try {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/shopping-lists/${list.id}/convert-to-cart`,
          cookies: COOKIE,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(200);
        const data = (res.json() as { data: { added: number; skipped: unknown[] } }).data;
        expect(data.added).toBe(1);
        expect(data.skipped).toEqual([
          { itemId: list.itemIdOf.get(H.id), productId: H.id, reason: 'product_not_found' },
        ]);
        expect(res.body).not.toContain(H.nameEn);
      } finally {
        await h.em().nativeUpdate(Product, { id: H.id }, { visibility: 'public' });
      }
    });
  });
});
