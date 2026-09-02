import type { Knex } from '@mikro-orm/postgresql';
import { PriceList, PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * What a **personalised** catalogue page costs, next to the anonymous one.
 *
 * `listing-price-cost.bench.ts` times the anonymous page and is the budget
 * gate; this one exists to answer the question the owner's ruling rests on —
 * per-organisation pricing largely destroys the pricing cache's hit rate
 * (99.0% anonymous, 5.3% at 50 organisations, measured), so the number that
 * matters is what a page costs **cold**, once that cache stops absorbing it.
 * Before MR !793 batched the listing resolution, a cold page was 502
 * statements; the whole reason the personalisation was affordable is that the
 * loop, not the personalisation, was the expensive part.
 *
 * So both viewers are measured twice: **cold**, on the first request for their
 * own cache key, and **warm**, once the LRU holds their page. The two viewers
 * have different keys by construction (`organizationId` is part of it), which
 * is also why the cold measurement for the second one is genuinely cold.
 *
 * The signed-in buyer's Organization carries its own price list over the whole
 * corpus, because that is the shape the ruling is about: a B2B buyer whose
 * negotiated list outranks the channel's. A buyer who merely matches the same
 * `all` list would understate the work — the organisation chain would be read
 * and then land on the answer the anonymous page already had.
 *
 * Measured 2026-08-20, `PERF_PAGE_SIZE=50`, corpus 120, on a 16-core Linux dev
 * box with Postgres 16 on localhost:
 *
 * | viewer    | cold           | warm | p50    | p95    |
 * | --------- | -------------- | ---- | ------ | ------ |
 * | anonymous | 161 / 87.8 ms  | 158  | 30.1ms | 41.8ms |
 * | signed-in | 162 / 41.4 ms  | 162  | 32.4ms | 35.8ms |
 *
 * Four statements, and no measurable wall clock, is what the personalisation
 * costs: the organisation row, and the extra list the buyer's chain reaches.
 * The warm and cold columns barely differ, which is the point — after !793 the
 * page no longer depends on the LRU absorbing a per-card loop, so a cache the
 * personalisation empties is a cache the page can afford to miss.
 *
 * Re-measured the same day on the same box, after issue #263 hoisted the last
 * three per-card reads — the gallery, the legacy `product_assets` fallback and
 * the category-slug join — to the page:
 *
 * | viewer    | cold          | warm | p50    | p95    |
 * | --------- | ------------- | ---- | ------ | ------ |
 * | anonymous | 14 / 61.9 ms  | 11   | 19.4ms | 22.0ms |
 * | signed-in | 15 / 32.1 ms  | 15   | 21.0ms | 22.4ms |
 *
 * Those three were 150 of the 158 statements the warm anonymous page cost, and
 * the personalisation's four became three — the organisation row and the extra
 * list, with nothing per-card left for the third to be spent on.
 *
 * **What this corpus cannot measure.** Its products carry no gallery, no
 * `product_assets` row and no category assignment, so all three of those reads
 * come back empty: both `assets.findByIds` calls short-circuit on an empty id
 * list and are never issued, and the price-list resolution skips its
 * category-override lookup. That is the whole of the difference between the 11
 * warm statements above and the 14 the same page costs over a corpus whose
 * cards have rows. A per-asset loop re-opened inside `resolvePrimaryAssetUrls`
 * costs this page **nothing** and passes here (measured: 11 warm, unchanged,
 * while the same regression took the other page from 14 to 87). The numbers
 * here are the pricing ones and stay the pricing ones;
 * `listing-card-reads-cost.bench.ts` is where a card's own reads are measured,
 * over `rich-listing-corpus.ts`.
 *
 * Skipped unless `PERF_RUN=true`, like every other bench here.
 */

const pageSize = Number(process.env['PERF_PAGE_SIZE'] ?? '50');
const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '120');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
/**
 * The ceiling for a **cold signed-in** page, in statements. The anonymous cold
 * page is the reference; a personalised one may not cost a different order of
 * magnitude, which is precisely the claim "the loop was the expensive part"
 * makes. A regression tripwire for a re-introduced per-card resolution, not a
 * budget to tune.
 *
 * It was 400 while the page cost 162, which left it unable to trip for the very
 * thing it names: re-opening one of the three per-card reads issue #263 hoisted
 * would have cost 50 statements on this page and passed. 60 keeps generous
 * headroom over the measured 15 and still fails on a single re-opened loop —
 * and the count is a constant, so a larger `PERF_PAGE_SIZE` does not raise it.
 */
const coldStatementCeiling = Number(process.env['PERF_SIGNED_IN_COLD_STATEMENTS'] ?? '60');
const shouldRun = process.env['PERF_RUN'] === 'true';

const ORG_LIST_ID = '00000000-0000-4000-8000-00000000e001';
const SIGNED_IN = { b2b_session: 'stub-customer-session' };

interface ViewerCost {
  label: string;
  coldStatements: number;
  coldMs: number;
  warmStatements: number;
  p50: number;
  p95: number;
  priced: number;
}

describe.skipIf(!shouldRun)('priced catalogue listing — anonymous vs signed-in', () => {
  let h: BackendServerHandle;
  let productIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

    const products = Array.from({ length: corpusSize }, (_, i) => {
      const idx = String(i).padStart(6, '0');
      return em.create(Product, {
        sku: `VPRICED-${idx}`,
        slug: `vpriced-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Viewer-priced product ${idx}` },
        description: { 'en-US': `Synthetic product ${idx}.` },
        visibility: 'public',
        attributeValues: { defaultPrice: 10 + (i % 100) },
      });
    });
    await em.persistAndFlush(products);
    productIds = products.map((p) => p.id);
    for (const product of products) {
      await h.salesChannels.membershipService.addToChannel(channel.id, 'product', product.id);
    }

    // The channel answer: the seeded system Default, matching every caller.
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    for (const product of products) {
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '99.00' }],
      });
    }

    // The buyer's answer: one list naming their Organization, outranking the
    // Default at the `organization` level of the priority chain.
    const orgList = em.create(PriceList, {
      id: ORG_LIST_ID,
      code: 'viewer-perf-org-list',
      name: 'Viewer perf organisation list',
      currency: 'PLN',
      isDefault: false,
      priority: 0,
      type: 'base',
      status: 'active',
      startsAt: null,
      endsAt: null,
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [TEST_ORGANIZATION_ID],
      },
      isSystem: false,
      modifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await em.persistAndFlush(orgList);
    for (const productId of productIds) {
      em.create(PriceListProduct, { priceListId: ORG_LIST_ID, productId });
    }
    await em.flush();
    for (const productId of productIds) {
      em.create(PriceListPriceBracket, {
        priceListId: ORG_LIST_ID,
        productId,
        currencyCode: 'PLN',
        minQuantity: 1,
        maxQuantity: null,
        amount: '89.00',
      });
    }
    await em.flush();
  }, 10 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('costs a signed-in buyer no different order of magnitude than an anonymous visitor', async () => {
    const url = `/api/v1/catalog/products?limit=${pageSize}`;
    const headers = { 'x-sales-channel': 'pl_retail' };
    const knex: Knex = h.em().getConnection().getKnex();

    async function measure(
      label: string,
      cookies: Record<string, string> | undefined,
      expectedAmount: number,
    ): Promise<ViewerCost> {
      const request = async (): Promise<Awaited<ReturnType<typeof h.app.inject>>> =>
        h.app.inject({ method: 'GET', url, headers, ...(cookies ? { cookies } : {}) });

      let statements = 0;
      const count = (): void => {
        statements += 1;
      };

      // Cold: the first request for this viewer's cache key.
      knex.on('query', count);
      const coldStart = performance.now();
      const cold = await request();
      const coldMs = performance.now() - coldStart;
      knex.off('query', count);
      const coldStatements = statements;

      expect(cold.statusCode).toBe(200);
      const coldBody = cold.json() as {
        data: Array<{ price: { amount: number } | null }>;
      };
      const priced = coldBody.data.filter((p) => p.price !== null).length;
      // The measurement is worthless if it timed a page priced for somebody
      // else: the two viewers have to have been quoted their own figures.
      expect(coldBody.data[0]?.price?.amount).toBe(expectedAmount);

      for (let i = 0; i < 5; i += 1) await request();

      const samples: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        await request();
        samples.push(performance.now() - start);
      }

      statements = 0;
      knex.on('query', count);
      await request();
      knex.off('query', count);
      const warmStatements = statements;

      samples.sort((a, b) => a - b);
      return {
        label,
        coldStatements,
        coldMs,
        warmStatements,
        p50: samples[Math.floor(samples.length * 0.5)] ?? 0,
        p95: samples[Math.floor(samples.length * 0.95)] ?? 0,
        priced,
      };
    }

    const anonymous = await measure('anonymous', undefined, 99);
    const signedIn = await measure('signed-in', SIGNED_IN, 89);

    for (const cost of [anonymous, signedIn]) {
      // eslint-disable-next-line no-console
      console.log(
        `[perf/listing-price-viewer] viewer=${cost.label} page=${pageSize} priced=${cost.priced} ` +
          `cold=${cost.coldStatements} statements / ${cost.coldMs.toFixed(1)}ms ` +
          `warm=${cost.warmStatements} statements p50=${cost.p50.toFixed(1)}ms ` +
          `p95=${cost.p95.toFixed(1)}ms`,
      );
    }

    expect(anonymous.priced).toBeGreaterThan(0);
    expect(signedIn.priced).toBe(anonymous.priced);
    expect(signedIn.coldStatements).toBeLessThan(coldStatementCeiling);
  }, 10 * 60_000);
});
