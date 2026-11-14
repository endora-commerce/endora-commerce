import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertToRfqResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { Product } from '../../helpers/package-entities.js';

/** A key the convert-to-RFQ reply carries that the contract does not declare fails (issue #599 §6). */
const strictConvertToRfq = deepStrict(convertToRfqResponseSchema);

/**
 * T197 — `POST /shopping-lists/:id/convert-to-rfq` with an explicit
 * `itemIds` array converts only the selected items, leaving the rest on
 * the list. Returns the RFQ id so the caller can deep-link the buyer.
 */

interface ListData {
  id: string;
  items: Array<{ id: string; productId: string }>;
}

describe('Shopping list convert-selected-to-RFQ', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('only converts the selected items', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Quoting list' },
    });
    const list = (create.json() as { data: ListData }).data;

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_102_ID, quantity: 5 },
    });
    const after = (second.json() as { data: ListData }).data;
    const selectedItem = after.items.find((it) => it.productId === SEED_PRODUCT_102_ID);
    expect(selectedItem).toBeDefined();

    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/convert-to-rfq`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { itemIds: [selectedItem!.id] },
    });
    expect(convert.statusCode).toBe(200);
    const result = (
      convert.json() as { data: { rfqId: string; added: number; skipped: unknown[] } }
    ).data;
    expect(result.added).toBe(1);
    expect(result.rfqId).toBeTruthy();
    expect(disagreements(strictConvertToRfq, result)).toEqual([]);

    // The RFQ now contains exactly the one selected item.
    const rfq = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${result.rfqId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(rfq.statusCode).toBe(200);
    const rfqBody = (
      rfq.json() as { data: { items: Array<{ productId: string }> } }
    ).data;
    expect(rfqBody.items.some((it) => it.productId === SEED_PRODUCT_102_ID)).toBe(true);
  });

  // Issue #1159 (architect ruling A) — nothing to quote is a valid answer, not an error: `200`,
  // `rfqId: null`, `added: 0` and the skips, which is what the contract now declares.
  it('answers rfqId null and the skip when the only selected item is archived', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Nothing to quote' },
    });
    const list = (create.json() as { data: ListData }).data;
    const added = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_102_ID, quantity: 3 },
    });
    const item = (added.json() as { data: ListData }).data.items.find(
      (it) => it.productId === SEED_PRODUCT_102_ID,
    );
    expect(item).toBeDefined();

    const readQuoteRequests = async (): Promise<unknown> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/quote-requests',
        cookies: { b2b_session: 'stub-customer-session' },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: unknown }).data;
    };

    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_102_ID });
    product.archivedAt = new Date();
    await em.flush();
    try {
      const before = await readQuoteRequests();
      const convert = await h.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-lists/${list.id}/convert-to-rfq`,
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { itemIds: [item!.id] },
      });
      expect(convert.statusCode, convert.body).toBe(200);
      const result = (
        convert.json() as {
          data: { rfqId: string | null; added: number; skipped: Array<{ itemId: string; reason: string }> };
        }
      ).data;
      expect(result.rfqId).toBeNull();
      expect(result.added).toBe(0);
      expect(result.skipped).toEqual([
        { itemId: item!.id, productId: SEED_PRODUCT_102_ID, reason: 'product_archived' },
      ]);
      expect(disagreements(strictConvertToRfq, result)).toEqual([]);
      // No quote request was created or changed.
      expect(await readQuoteRequests()).toEqual(before);
    } finally {
      product.archivedAt = null;
      await em.flush();
    }
  });
});
