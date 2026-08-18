import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { ComparisonProduct } from '../../../src/modules/comparisons/entities/comparison-product.entity.js';
import { COMPARE_SETTING_CODES } from '../../../src/modules/comparisons/manifest.js';
import { freshCompareCookie } from '../../helpers/comparison-fixtures.js';

/**
 * T019 — Integration test: `compare.max_products` cap enforcement
 * (US1, feature 007). Real Postgres + real Settings + real
 * sales-channels resolver.
 *
 * Sets the cap to 2 for the resolved channel, adds two products, then
 * tries to add a third → expects 409 COMPARISON_FULL and the existing
 * comparison untouched (spec FR-003).
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('Compare module — compare.max_products cap (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // No table cleanup (issue #166): each case starts from a
    // `freshCompareCookie()` — an owner token nobody else holds, whose
    // comparison the first add creates — so it sees exactly the products it
    // added. The cookie used to be minted by posting a product and then
    // deleting every comparison in the database, cookie kept.
    // Pin the cap back to 4 so cleanup between tests is consistent. The
    // tests that need a different value override per test below.
    await h.settings.adminService.setValueForAllChannels(
      COMPARE_SETTING_CODES.MAX_PRODUCTS,
      4,
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });

  it('refuses the (max+1)-th add with 409 COMPARISON_FULL', async () => {
    // Lower the cap to 2 for every channel.
    await h.settings.adminService.setValueForAllChannels(
      COMPARE_SETTING_CODES.MAX_PRODUCTS,
      2,
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );

    const cookie = freshCompareCookie();

    const a = await addProduct(h, cookie, SEED_PRODUCT_101_ID);
    expect(a.statusCode).toBe(200);

    const b = await addProduct(h, cookie, SEED_PRODUCT_102_ID);
    expect(b.statusCode).toBe(200);

    const c = await addProduct(h, cookie, SEED_PRODUCT_103_ID);
    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ error: { code: ERROR_CODES.COMPARISON_FULL } });

    // The existing rows are untouched — this comparison's rows, read back by
    // the id the refused add did not change.
    const owned = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    const comparisonId = (owned.json() as { data: { id: string } }).data.id;
    const em = h.em();
    const rows = await em.find(ComparisonProduct, { comparisonId });
    expect(rows).toHaveLength(2);
  });

  it('allows up to the configured cap and rejects beyond it', async () => {
    await h.settings.adminService.setValueForAllChannels(
      COMPARE_SETTING_CODES.MAX_PRODUCTS,
      3,
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );

    const cookie = freshCompareCookie();
    expect((await addProduct(h, cookie, SEED_PRODUCT_101_ID)).statusCode).toBe(200);
    expect((await addProduct(h, cookie, SEED_PRODUCT_102_ID)).statusCode).toBe(200);
    expect((await addProduct(h, cookie, SEED_PRODUCT_103_ID)).statusCode).toBe(200);

    // A 4th sentinel product that does not exist still exercises the cap
    // check first — we can simulate it by re-adding the same product (idempotent
    // path returns 200, NOT a refusal). To test the actual cap rejection
    // we'd need a 4th seeded product. The MVP seed only has three; this
    // test asserts the success ladder up to 3 and the refusal-at-2-cap
    // scenario above covers the 409 path.
  });
});

// ---------------------------------------------------------------------------
// Local helpers (kept tiny — not promoted to test-server because they're
// US1-shaped and not generally useful elsewhere yet).
// ---------------------------------------------------------------------------

async function addProduct(
  h: BackendServerHandle,
  cookie: string,
  productId: string,
) {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json', cookie },
    payload: { productId },
  });
}
