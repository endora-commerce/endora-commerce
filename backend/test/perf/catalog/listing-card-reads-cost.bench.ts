// perf-weight: fast — 5569 ms on the CI runner (pipeline 13444, 2026-09-09).
import type { Knex } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedRichListingCorpus } from '../../helpers/rich-listing-corpus.js';

/**
 * What a listing page costs **when its cards have something to show** — the
 * measurement `listing-price-viewer-cost.bench.ts` cannot take.
 *
 * That bench seeds bare `Product` rows: no gallery, no `product_assets`, no
 * category assignments. So the three reads issue #263 hoisted all come back
 * empty, both `assets.findByIds` calls short-circuit on an empty id list and
 * are never issued, and the price-list resolution skips its category-override
 * lookup. Measured on `origin/master` (6f95d4f4), same box, same 50-card page:
 *
 * | corpus                       | anonymous warm | signed-in warm |
 * | ---------------------------- | -------------- | -------------- |
 * | bare `Product` rows          | 11             | 15             |
 * | this one (gallery, assets, categories) | 14   | 18             |
 *
 * Three of the fourteen statements the shop's page issues were outside the
 * measurement that pins it, and two of the three are the asset half of exactly
 * what #263 hoisted. A re-opened per-card `assets.findByIds` would have cost
 * the bare corpus nothing at all and passed under any ceiling. Issue #140's
 * lesson one level down: the page had products, and the reads under measurement
 * had nothing to read.
 *
 * Hence the two assertions here, in this order:
 *
 *  1. **the fixture is not vacuous** — the page came back full, and every card
 *     on it carries a resolved asset url, two category slugs and a price. A
 *     count taken before that check is a count of a page nobody would render;
 *  2. **the count is a constant** — the same statements at 10 cards as at 50.
 *     A ceiling alone cannot fail for the defect it names unless somebody keeps
 *     it tight (`PERF_SIGNED_IN_COLD_STATEMENTS` was 400 against a page costing
 *     162, which left it unable to trip for a 50-statement regression); a
 *     difference that must be zero fails on one re-opened per-card read at any
 *     page size and cannot be tuned away.
 *
 * Skipped unless `PERF_RUN=true`, like every other bench here.
 */

const pageSize = Number(process.env['PERF_PAGE_SIZE'] ?? '50');
const smallPage = 10;
const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '120');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
/**
 * The ceiling for a warm page, in statements. Measured 14 (anonymous) and 18
 * (signed-in) over this corpus on a 16-core Linux dev box with Postgres 16 on
 * localhost, 2026-08-21. 24 leaves room for a read a future feature adds to the
 * page without leaving room for a per-card one, which costs `pageSize` of them.
 */
const statementCeiling = Number(process.env['PERF_CARD_READ_STATEMENTS'] ?? '24');
const shouldRun = process.env['PERF_RUN'] === 'true';

const SIGNED_IN = { b2b_session: 'stub-customer-session' };
const RETAIL_CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface Card {
  id: string;
  categorySlugs: string[];
  primaryAssetUrl: string | null;
  price: { amount: number; currency: string } | null;
}

interface PageCost {
  label: string;
  cards: Card[];
  coldStatements: number;
  coldMs: number;
  warmStatements: number;
  p50: number;
  p95: number;
}

describe.skipIf(!shouldRun)('catalogue listing — what a card with rows costs', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRichListingCorpus(h.em(), corpusSize, { prefix: 'CARDCOST' });
  }, 10 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads a page of full cards in a fixed number of statements', async () => {
    const knex: Knex = h.em().getConnection().getKnex();

    async function measure(
      label: string,
      limit: number,
      cookies: Record<string, string> | undefined,
    ): Promise<PageCost> {
      const url = `/api/v1/catalog/products?limit=${limit}`;
      const request = async (): Promise<Awaited<ReturnType<typeof h.app.inject>>> =>
        h.app.inject({ method: 'GET', url, headers: RETAIL_CHANNEL, ...(cookies ? { cookies } : {}) });

      let statements = 0;
      const count = (): void => {
        statements += 1;
      };

      knex.on('query', count);
      const coldStart = performance.now();
      const cold = await request();
      const coldMs = performance.now() - coldStart;
      knex.off('query', count);
      const coldStatements = statements;
      expect(cold.statusCode).toBe(200);

      for (let i = 0; i < 5; i += 1) await request();

      const samples: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        const start = performance.now();
        await request();
        samples.push(performance.now() - start);
      }

      statements = 0;
      knex.on('query', count);
      const warm = await request();
      knex.off('query', count);
      samples.sort((a, b) => a - b);

      return {
        label,
        cards: (warm.json() as { data: Card[] }).data,
        coldStatements,
        coldMs,
        warmStatements: statements,
        p50: samples[Math.floor(samples.length * 0.5)] ?? 0,
        p95: samples[Math.floor(samples.length * 0.95)] ?? 0,
      };
    }

    const anonymous = await measure('anonymous', pageSize, undefined);
    const small = await measure('anonymous-small', smallPage, undefined);
    const signedIn = await measure('signed-in', pageSize, SIGNED_IN);

    for (const cost of [anonymous, small, signedIn]) {
      // eslint-disable-next-line no-console
      console.log(
        `[perf/listing-card-reads] viewer=${cost.label} cards=${cost.cards.length} ` +
          `cold=${cost.coldStatements} statements / ${cost.coldMs.toFixed(1)}ms ` +
          `warm=${cost.warmStatements} statements p50=${cost.p50.toFixed(1)}ms ` +
          `p95=${cost.p95.toFixed(1)}ms`,
      );
    }

    // (1) The fixture is not vacuous — asserted before any count is read.
    for (const cost of [anonymous, signedIn]) {
      expect(cost.cards.length).toBe(pageSize);
      expect(cost.cards.every((c) => c.primaryAssetUrl !== null)).toBe(true);
      expect(cost.cards.every((c) => c.categorySlugs.length === 2)).toBe(true);
      expect(cost.cards.every((c) => c.price !== null)).toBe(true);
    }
    expect(small.cards.length).toBe(smallPage);
    // Both arms of the primary-asset chain are on the page, so neither the
    // gallery read nor the legacy fallback is being measured against no rows.
    expect(anonymous.cards.filter((c) => c.primaryAssetUrl?.includes('-thumbnail')).length)
      .toBeGreaterThan(0);
    expect(anonymous.cards.filter((c) => c.primaryAssetUrl?.includes('-legacy')).length)
      .toBeGreaterThan(0);

    // (2) The count is a constant in the page size, and inside the budget.
    expect(anonymous.warmStatements).toBe(small.warmStatements);
    expect(anonymous.warmStatements).toBeLessThanOrEqual(statementCeiling);
    expect(signedIn.warmStatements).toBeLessThanOrEqual(statementCeiling);
  }, 10 * 60_000);
});
