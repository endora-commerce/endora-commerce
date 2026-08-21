import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * A catalogue listing resolves its page **once** — its prices (issue #132
 * follow-up) and, since issue #263, its cards' assets and category slugs too.
 *
 * `resolveListingPrices` takes a set and always has, but `toSummary` called it
 * with a batch of one, so a 50-card page made 50 calls: 502 statements and
 * 273 ms for one page, 350 of those statements pricing. Batching the engine
 * alone would not have shown up in a single request — the caller has to hand it
 * the page — which is why the guard lives here, at the route, and counts
 * statements rather than milliseconds.
 *
 * The signal is `price_lists`' own tables. Each resolution reads the active
 * lists once, the brackets once per fall-through level the page needs, and the
 * display-mode overrides once per scope it consults — small constants. The
 * claim is that they are constants: the counts below do not move when the page
 * grows from three cards to thirty-three.
 *
 * The second test makes the same claim about the three reads that survived
 * !793 and !796 — `gallery_items`, the legacy `product_assets` fallback and the
 * category-slug join — which between them were 150 of the ~158 statements a
 * 50-item page still cost. They are counted the same way and for the same
 * reason: each takes an id list already, so batching the helper proves nothing
 * about the page unless the page is what calls it.
 */

const EXTRA_PRODUCTS = 30;
describe('catalogue listing prices its page in one resolution', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    // A three-card page cannot tell a batch from a loop. Thirty-three can.
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const stamp = Date.now();
    const extra = Array.from({ length: EXTRA_PRODUCTS }, (_, i) => {
      const idx = String(i).padStart(3, '0');
      return em.create(Product, {
        sku: `BATCHPAGE-${stamp}-${idx}`,
        slug: `batchpage-${stamp}-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Batch page product ${idx}` },
        description: { 'en-US': 'Fixture for the listing batching guard.' },
        visibility: 'public',
        attributeValues: {},
      });
    });
    await em.persistAndFlush(extra);
    for (const product of extra) {
      await h.salesChannels.membershipService.addToChannel(channel.id, 'product', product.id);
    }

    const priced = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID, ...extra.map((p) => p.id)];
    for (const productId of priced) {
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, productId);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, productId, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '42.00' }],
      });
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads the active price lists once, not once per card', async () => {
    const url = '/api/v1/catalog/products?limit=50';
    const headers = { 'x-sales-channel': 'pl_retail' };
    // Warm every lazily-built singleton so the count is the page's own work.
    await h.app.inject({ method: 'GET', url, headers });

    const connection = h.em().getConnection() as unknown as {
      execute: (...args: unknown[]) => Promise<unknown>;
    };
    const original = connection.execute.bind(connection);
    const statements: string[] = [];
    connection.execute = (...args: unknown[]) => {
      const query = args[0];
      statements.push(
        typeof query === 'string'
          ? query
          : String((query as { toString(): string } | undefined)?.toString?.() ?? ''),
      );
      return original(...args);
    };

    let response;
    try {
      response = await h.app.inject({ method: 'GET', url, headers });
    } finally {
      connection.execute = original;
    }

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ id: string; price: unknown }> };
    const priced = body.data.filter((p) => p.price !== null);
    // The guard is worthless if the page it counted priced nothing — and it is
    // weak if the page is small enough for a loop to look like a batch.
    expect(priced.length).toBeGreaterThan(EXTRA_PRODUCTS);

    const reads = (table: string): number =>
      statements.filter((sql) => sql.includes(`"${table}"`)).length;
    expect(reads('price_lists')).toBe(1);
    expect(reads('price_list_price_brackets')).toBe(1);
    // Two scopes are consulted for the page — product, then category, because
    // the seeded products belong to one. Both are set reads.
    expect(reads('price_display_mode_overrides')).toBe(2);
  });

  it('reads each card\'s asset and category slugs once for the page, not once per card', async () => {
    const url = '/api/v1/catalog/products?limit=50';
    const headers = { 'x-sales-channel': 'pl_retail' };
    await h.app.inject({ method: 'GET', url, headers });

    const { statements, body } = await countStatements(url, headers);
    expect(body.data.length).toBeGreaterThan(EXTRA_PRODUCTS);

    // Raw SQL, so these are matched on the text the helper writes rather than
    // on a quoted identifier the ORM would emit.
    const raw = (fragment: string): number =>
      statements.filter((sql) => sql.includes(fragment)).length;
    expect(raw('from gallery_items gi')).toBe(1);
    // The legacy fallback runs at most once, for whatever the gallery read did
    // not answer — the whole page here, since the fixture seeds no gallery.
    expect(raw('from product_assets pa')).toBe(1);
    // **Two** set reads of the bridge, and both are the port's one statement:
    // the cards' category slugs, and the memberships `price_lists` evaluates a
    // category rule against. The second used to be `price_lists`' own
    // un-aliased `select … from product_categories`, so this count read 1 while
    // the page made the same two round trips — the read was there, it just did
    // not match the fragment. Feature 075 / D-87 moved it onto
    // `catalogCategoryReadPort` and it became visible here.
    //
    // The claim this file makes is unchanged and is what the number has to
    // show: a constant, on a 33-card page. Once per card would be 33.
    expect(raw('from product_categories pc')).toBe(2);
  });

  async function countStatements(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ statements: string[]; body: { data: Array<{ id: string }> } }> {
    const connection = h.em().getConnection() as unknown as {
      execute: (...args: unknown[]) => Promise<unknown>;
    };
    const original = connection.execute.bind(connection);
    const statements: string[] = [];
    connection.execute = (...args: unknown[]) => {
      const query = args[0];
      statements.push(
        typeof query === 'string'
          ? query
          : String((query as { toString(): string } | undefined)?.toString?.() ?? ''),
      );
      return original(...args);
    };

    let response;
    try {
      response = await h.app.inject({ method: 'GET', url, headers });
    } finally {
      connection.execute = original;
    }
    expect(response.statusCode).toBe(200);
    return { statements, body: response.json() as { data: Array<{ id: string }> } };
  }
});
