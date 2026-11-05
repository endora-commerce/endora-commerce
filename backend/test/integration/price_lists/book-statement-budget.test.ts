import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product, type ProductRow } from '../../helpers/package-entities.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (SC-004, `contracts/pricing-resolution-v2.md` §3) — a 50-product
 * listing page costs a constant number of statements whatever the number of
 * price books that apply. Replaces `matrix-statement-budget.test.ts`.
 */
async function countStatements<T>(h: BackendServerHandle, work: () => Promise<T>): Promise<number> {
  const conn = h.em().getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
  const original = conn.execute.bind(conn);
  let statements = 0;
  conn.execute = (...args: unknown[]) => {
    statements += 1;
    return original(...args);
  };
  try {
    await work();
    return statements;
  } finally {
    conn.execute = original;
  }
}

describe('price books — a listing page costs a constant number of statements', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let page: ProductRow[];

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    const em = h.em();
    page = Array.from({ length: 50 }, (_, i) =>
      em.create(Product, {
        sku: `BUDGET-${i}-${randomUUID().slice(0, 6)}`,
        slug: `budget-${i}-${randomUUID().slice(0, 6)}`,
        type: 'simple',
        status: 'active',
        name: `Budget ${i}`,
        description: '',
        visibility: 'public',
        attributeValues: { color: i % 2 === 0 ? 'red' : 'blue' },
      }),
    );
    await em.persistAndFlush(page);
    for (const product of page) {
      await f.setBase(product, { product: [{ minQuantity: 1, maxQuantity: null, amount: '10' }], variants: {} });
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const listing = () =>
    f.pricing.resolveListingPrices({
      products: page,
      context: { organization: f.orgs.Acme, salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
    });

  it('one book and twenty books cost the same', async () => {
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [{ percent: '-1' }, { category: f.categories.screws, percent: '-2' }, { attribute: ['color', 'red'], percent: '-3' }],
    });
    await listing();
    const one = await countStatements(h, listing);
    for (let i = 0; i < 19; i += 1) {
      await f.book({
        audience: i % 2 === 0 ? { organizations: [f.orgs.Acme] } : { groups: [f.groups.VIP] },
        rows: [
          { product: page[i]!, fixed: '9' },
          { category: f.categories.screws, percent: '-2' },
          { attribute: ['color', 'red'], percent: '-3' },
        ],
      });
    }
    await listing();
    const twenty = await countStatements(h, listing);
    expect(twenty).toBe(one);
    expect(one).toBeLessThanOrEqual(15);
  });
});
