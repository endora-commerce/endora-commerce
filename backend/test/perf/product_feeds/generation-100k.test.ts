// perf-weight: heavy — seeding 110 000 products, then a 100 000-item generation the header below measures at 207 s. It has been excluded from the nightly since the job was written.
import { setFlagsFromString } from 'node:v8';
import { PriceList } from '../../helpers/package-entities.js';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { FeedArtefact } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T111 — the streaming budget (FR-034, SC-004, `plan.md`
 * § Performance Goals).
 *
 * The claim under test is **not** "generation produces the right file" — six
 * integration tests already cover that. It is the one property a correctness
 * test on a three-product fixture can never see:
 *
 *   peak incremental heap is **flat with respect to item count**.
 *
 * So the same feed pipeline is run twice, at two scales an order of magnitude
 * apart, and the peak heap growth of each is compared. An implementation that
 * buffered items, or joined the XML into one string, or forgot an `em.clear()`,
 * would grow roughly linearly with the catalogue and blow the ratio; the
 * streaming one stays inside the batch (500 items) whatever the catalogue does.
 * An absolute ceiling (`plan.md`: ~150 MB) is asserted as well, because a ratio
 * alone would pass an implementation that is uniformly wasteful.
 *
 * Opt-in: `PERF_RUN=true pnpm --filter backend run test:perf`. Seeding 100 000
 * products takes minutes and the resulting artefact is tens of megabytes, so
 * this never runs in an ordinary suite.
 *
 * Env knobs:
 *   PERF_FEED_ITEM_COUNT   — the large catalogue (default 100 000)
 *   PERF_FEED_SMALL_COUNT  — the reference catalogue (default 10 000)
 *   PERF_FEED_BUDGET_MS    — wall-clock budget for the large run (default 600 000)
 *   PERF_FEED_HEAP_MB      — absolute peak-incremental-heap ceiling (default 150)
 *   PERF_FEED_HEAP_BYTES   — allowed peak-heap growth per extra item (default 256)
 *   PERF_FEED_SAMPLE_MS    — heap probe period (default 250)
 *   PERF_RUN               — 'true' to enable
 *
 * ## What the numbers looked like when this landed
 *
 * 100 000 products, one developer machine, Postgres on localhost:
 * 10 000 items → peak live heap **+8.1 MB**; 100 000 items → **+18.4 MB**, 38 MB
 * of XML, 207 s. So the pipeline is flat **per item** to within ~120 bytes, and
 * the residual is not the items: it is
 * `ProductSelectionService.channelProductIds`, which materialises the channel's
 * whole membership id list (~90 bytes per product) before paging. That is O(the
 * channel), not O(the feed), and at the plan's stated ceiling it is tens of
 * megabytes — inside budget, and recorded here so the next person to read a
 * memory graph knows which line it is.
 *
 * ## The test is not vacuous
 *
 * It found one. `ProductSelectionService.iterateProductIds` opened an
 * `EntityManager` for the life of the generator and never cleared it — and
 * `emFactory()` **forks**, so that manager's identity map retained every
 * `Product` the run walked past. Measured at 30 000 items: **+184.7 MB** peak
 * live heap, 6.3 kB per item, against **+9.4 MB** with the `em.clear()` that
 * now sits in that loop. The correctness suite could not see it; nothing was
 * wrong with the output.
 */

const itemCount = Number(process.env['PERF_FEED_ITEM_COUNT'] ?? '100000');
const smallCount = Number(process.env['PERF_FEED_SMALL_COUNT'] ?? '10000');
const budgetMs = Number(process.env['PERF_FEED_BUDGET_MS'] ?? String(10 * 60_000));
const heapBudgetMb = Number(process.env['PERF_FEED_HEAP_MB'] ?? '150');
const heapBytesPerItem = Number(process.env['PERF_FEED_HEAP_BYTES'] ?? '256');
const shouldRun = process.env['PERF_RUN'] === 'true';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * Sampling period for the heap probe. Each sample forces a collection, so this
 * trades measurement resolution against the probe's own cost; 250 ms gives tens
 * of samples across a run of any interesting length.
 */
const HEAP_SAMPLE_MS = Number(process.env['PERF_FEED_SAMPLE_MS'] ?? '250');

/**
 * A real collection before each baseline, without needing `--expose-gc` on the
 * vitest command line (which nothing else in this repo passes).
 *
 * Without it the baseline is whatever garbage the previous phase left behind:
 * the collector then runs mid-measurement, the increment comes out near zero or
 * negative, and the flatness ratio becomes noise rather than evidence.
 */
function forceGc(): void {
  try {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as (() => void) | undefined;
    gc?.();
  } catch {
    // No collector available — the absolute ceiling still applies, the ratio
    // is simply noisier. Never fail a measurement over the instrument.
  } finally {
    try {
      setFlagsFromString('--no-expose-gc');
    } catch {
      /* ignore */
    }
  }
}

interface RunMeasurement {
  emitted: number;
  /** Wall clock minus the probe's own forced collections — the honest figure. */
  elapsedMs: number;
  wallClockMs: number;
  gcOverheadMs: number;
  peakHeapMb: number;
  bytes: number;
}

describe.skipIf(!shouldRun)('product feed generation — 100k perf', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let priceListId: string;
  let smallChannelId: string;
  let largeChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const conn = em.getConnection();

    // Two channels over one product pool: membership is what makes a feed
    // "small" or "large", which is also the cheapest honest way to hold every
    // other variable (template, prices, language, storefront origin) equal.
    const small = em.create(SalesChannel, {
      code: 'perf_feed_small',
      name: { 'en-US': 'Perf small' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    const large = em.create(SalesChannel, {
      code: 'perf_feed_large',
      name: { 'en-US': 'Perf large' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    // Catch-all rather than `isSystem` (issue #50): the system flag marks the
    // platform's one seeded `Default` row and is now a database singleton.
    const priceList = em.create(PriceList, {
      code: 'perf_feed_list',
      name: 'Perf feed list',
      currency: 'PLN',
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date(),
    });
    await em.persistAndFlush([small, large, priceList]);
    smallChannelId = small.id;
    largeChannelId = large.id;
    priceListId = priceList.id;

    await setChannelStorefrontUrl(h, 'perf_feed_small');
    await setChannelStorefrontUrl(h, 'perf_feed_large');

    // Seeded in SQL rather than through the ORM: 100 000 entities through the
    // identity map would measure MikroORM's insert path, take far longer than
    // the run under test, and risk the seed itself becoming the memory story.
    await conn.execute(
      `insert into products (id, sku, slug, type, status, visibility, name, description,
                             attribute_values, allowed_organization_ids, created_at, updated_at)
       select
         ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         'PERF-' || i,
         'perf-product-' || i,
         'simple', 'active', 'public',
         jsonb_build_object('en-US', 'Perf product ' || i),
         jsonb_build_object('en-US', 'Description of perf product ' || i),
         '{}'::jsonb, '[]'::jsonb, now(), now()
       from generate_series(1, ?) as i`,
      [itemCount],
    );
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       select ?, ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
       from generate_series(1, ?) as i`,
      [largeChannelId, itemCount],
    );
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       select ?, ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
       from generate_series(1, ?) as i`,
      [smallChannelId, smallCount],
    );
    await conn.execute(
      `insert into price_list_products (price_list_id, product_id)
       select ?, ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
       from generate_series(1, ?) as i`,
      [priceListId, itemCount],
    );
    await conn.execute(
      `insert into price_list_price_brackets
         (price_list_id, product_id, currency_code, min_quantity, amount)
       select ?, ('a0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
              'PLN', 1, 19.99
       from generate_series(1, ?) as i`,
      [priceListId, itemCount],
    );
    em.clear();

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
  }, 30 * 60_000);

  afterAll(async () => {
    if (h) {
      // The artefacts are tens of megabytes each; do not leave them behind.
      const artefacts = await h.em().find(FeedArtefact, {});
      for (const artefact of artefacts) {
        await h.productFeeds.artefactStore
          .delete({ backend: artefact.storageBackend, locator: artefact.storageLocator })
          .catch(() => undefined);
      }

      // And neither the catalogue. `setupBackendServer()` truncates on the next
      // file that calls it, but the other perf benches use `setupTestDb`, which
      // does not — leaving 100 000 products behind would quietly change the
      // numbers a neighbouring benchmark reports.
      const conn = h.em().getConnection();
      const perfIds = `'a0000000-0000-4000-8000-%'`;
      for (const table of [
        'price_list_price_brackets',
        'price_list_products',
        'sales_channel_products',
      ]) {
        await conn.execute(`delete from ${table} where product_id::text like ${perfIds}`);
      }
      await conn.execute(`delete from products where id::text like ${perfIds}`);

      await teardownBackendServer(h);
    }
  }, 5 * 60_000);

  async function createFeed(salesChannelId: string, name: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name,
        slug: `perf-${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
        feedTemplateId: templateId,
        salesChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        // The named list is used verbatim (FR-020) — one indexed read per item.
        // The anonymous resolution would drag the whole price-list rule engine
        // into a measurement that is about this module's streaming, not that one.
        priceListId,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  /**
   * Runs one generation while sampling **live** heap, and reports the peak
   * increment over the pre-run baseline.
   *
   * Each sample forces a collection first. Raw `heapUsed` is dominated by
   * garbage the collector has not got to yet, which scales with throughput and
   * therefore with the run — so a raw-`heapUsed` comparison would report a
   * streaming pipeline as growing and prove nothing either way. Collecting
   * first costs wall-clock time, so the probe accounts for its own cost and the
   * duration assertion uses the corrected figure; both are printed.
   */
  async function measureRun(feedId: string): Promise<RunMeasurement> {
    forceGc();
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    let gcOverheadMs = 0;
    const probe = setInterval(() => {
      const t0 = performance.now();
      forceGc();
      gcOverheadMs += performance.now() - t0;
      const used = process.memoryUsage().heapUsed;
      if (used > peak) peak = used;
    }, HEAP_SAMPLE_MS);
    probe.unref();

    const startedAt = performance.now();
    let run;
    try {
      run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    } finally {
      clearInterval(probe);
    }
    const wallClockMs = performance.now() - startedAt;

    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    const artefact = await h.em().findOneOrFail(FeedArtefact, { id: String(run.artefactId) });

    return {
      emitted: run.emittedCount,
      elapsedMs: wallClockMs - gcOverheadMs,
      wallClockMs,
      gcOverheadMs,
      peakHeapMb: (peak - baseline) / 1024 / 1024,
      bytes: Number(artefact.byteSize),
    };
  }

  it(
    'generates a 100k-product feed within budget, with peak heap flat in item count',
    async () => {
      const smallFeedId = await createFeed(smallChannelId, 'Small');
      const largeFeedId = await createFeed(largeChannelId, 'Large');

      const small = await measureRun(smallFeedId);
      const large = await measureRun(largeFeedId);

      const line = (label: string, m: RunMeasurement, items: number): string =>
        `[perf/feed] ${label} items=${items} emitted=${m.emitted} ` +
        `elapsed=${(m.elapsedMs / 1000).toFixed(1)}s ` +
        `(wall=${(m.wallClockMs / 1000).toFixed(1)}s, gcProbe=${(m.gcOverheadMs / 1000).toFixed(1)}s) ` +
        `bytes=${(m.bytes / 1024 / 1024).toFixed(1)}MB ` +
        `peakLiveHeap=+${m.peakHeapMb.toFixed(1)}MB`;
      // eslint-disable-next-line no-console
      console.log(line('small', small, smallCount));
      // eslint-disable-next-line no-console
      console.log(line('large', large, itemCount));
      const growthBytesPerItem =
        ((large.peakHeapMb - small.peakHeapMb) * 1024 * 1024) / (itemCount - smallCount);
      const meanItemBytes = large.bytes / large.emitted;
      // eslint-disable-next-line no-console
      console.log(
        `[perf/feed] growth=${growthBytesPerItem.toFixed(0)}B/item ` +
          `meanSerializedItem=${meanItemBytes.toFixed(0)}B ` +
          `ratio=${(large.peakHeapMb / Math.max(small.peakHeapMb, 0.1)).toFixed(2)} ` +
          `budget=${budgetMs}ms heapCeiling=${heapBudgetMb}MB`,
      );

      // Every eligible product is in the file — a fast run that dropped items
      // would otherwise look like a win.
      expect(small.emitted).toBe(smallCount);
      expect(large.emitted).toBe(itemCount);
      expect(large.bytes).toBeGreaterThan(small.bytes);

      expect(large.elapsedMs).toBeLessThan(budgetMs);
      expect(large.peakHeapMb).toBeLessThan(heapBudgetMb);

      /*
       * The flatness claim, stated as a per-item bound rather than a ratio: an
       * extra item must cost less than `heapBytesPerItem` of live heap.
       *
       * The threshold is deliberately **below the mean serialized size of one
       * item** (~380 bytes for the shipped Google template on this fixture), so
       * the test cannot pass an implementation that merely accumulates the
       * output document — never mind one that keeps the hydrated items, which
       * are several kilobytes each. The assertion below pins that relationship
       * so tuning the threshold upwards past an item's own size fails loudly.
       */
      expect(heapBytesPerItem).toBeLessThan(meanItemBytes);
      expect(growthBytesPerItem).toBeLessThan(heapBytesPerItem);
    },
    30 * 60_000,
  );
});
