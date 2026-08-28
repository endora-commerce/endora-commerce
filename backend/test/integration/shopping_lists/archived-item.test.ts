import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';

/**
 * T199 — When an item on a shopping list points at an archived product,
 * conversion (to either Cart or RFQ) MUST skip that row and surface a
 * `product_archived` reason in the `skipped` report — not fail outright.
 */

describe('Archived product on shopping list — skipped on conversion', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('skips the archived row, converts the rest, and reports the skip', async () => {
    // 1. Build a list with two items.
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Mixed list' },
    });
    const list = (create.json() as { data: { id: string } }).data;

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_102_ID, quantity: 4 },
    });

    // 2. Archive the second product directly via the EM (admin route exists too,
    //    but we want a deterministic state for the conversion check).
    const em = h.em();
    const archived = await em.findOneOrFail(Product, { id: SEED_PRODUCT_102_ID });
    archived.status = 'inactive';
    await em.flush();

    // 3. Convert to cart — the archived row is skipped + reported.
    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/convert-to-cart`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const result = (
      convert.json() as {
        data: {
          added: number;
          skipped: Array<{ productId: string; reason: string }>;
        };
      }
    ).data;
    expect(result.added).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.productId).toBe(SEED_PRODUCT_102_ID);
    expect(result.skipped[0]?.reason).toBe('product_archived');

    // 4. Restore for following tests in the same suite.
    archived.status = 'active';
    await em.flush();
  });
});
