import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';

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
});
