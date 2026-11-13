import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PriceBookWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import {
  PRICE_LISTS_TABLE_MAINTENANCE_QUEUE,
  createTableMaintenanceProducer,
  startTableMaintenanceWorker,
  vacuumAnalyzeTable,
  type TableMaintenanceProducer,
} from '../../../../packages/modules/price_lists/src/backend/workers/table-maintenance-worker.js';

/**
 * Issue #409 — a bulk write of price-book rows asks for `VACUUM (ANALYZE)` of
 * `price_list_matrix_entries` and `price_list_product_lines` in the background,
 * so the editor's index-only reads have a visibility map before autovacuum's
 * first pass (spec 161 R14).
 *
 * Three things, each against the real thing it is about: the writes that ask
 * (the harness composition, with the module's producer replaced by a
 * recorder); the job's statement (the test Postgres records the vacuum and
 * the analyse, and the tables have statistics afterwards); and the queue's
 * one-job-per-table window (a real Redis and BullMQ).
 */

describe('price_lists table maintenance — the writes that ask for it', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let requests = 0;
  const recorder: TableMaintenanceProducer = {
    request: async () => {
      requests += 1;
      return true;
    },
    close: async () => undefined,
  };
  const version = async (id: string) => (await api.get<{ data: { version: number } }>(`/api/v1/admin/price-books/${id}`)).body.data.version;

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: { priceListsTableMaintenance: recorder } });
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  beforeEach(() => {
    requests = 0;
  });

  afterEach(async () => {
    await f.clearBooks();
    await f.resetBase();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a row batch asks once it committed; a dry run and a refused batch do not', async () => {
    const book = await f.book({ audience: 'everyone', activate: false, rows: [{ product: f.products.P1, fixed: '90' }] });
    requests = 0;
    const upsert = [{ selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'fixed', amount: '40' } }];

    const dry = await api.put(`/api/v1/admin/price-books/${book.id}/rows?dryRun=true`, { expectedVersion: await version(book.id), upsert });
    expect(dry.status, dry.raw).toBe(200);
    expect(requests).toBe(0);

    const refused = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { expectedVersion: (await version(book.id)) + 7, upsert });
    expect(refused.status, refused.raw).toBe(409);
    expect(requests).toBe(0);

    const written = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { expectedVersion: await version(book.id), upsert });
    expect(written.status, written.raw).toBe(200);
    expect(requests).toBe(1);
  });

  it('a base-price write (the PIM price import’s seam) and a book duplicate ask too', async () => {
    const port = (h.container as unknown as { resolve<T>(name: string): T }).resolve<PriceBookWritePort>('priceBookWritePort');
    await f.system(() =>
      port.replaceProductBaseTiers(f.products.P1.id, { PLN: [{ minQuantity: 1, maxQuantity: null, amount: '101.0000' }] }),
    );
    expect(requests).toBe(1);

    const book = await f.book({ audience: 'everyone', activate: false, rows: [{ product: f.products.P1, fixed: '90' }] });
    requests = 0;
    const copy = await api.post(`/api/v1/admin/price-books/${book.id}/duplicate`, {
      name: 'Copy for #409',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'PLN',
      audience: { kind: 'everyone', memberIds: [] },
    });
    expect(copy.status, copy.raw).toBe(201);
    expect(requests).toBe(1);
  });
});

describe('price_lists table maintenance — the job, on the test Postgres', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  // Which pages end all-visible depends on the oldest snapshot open anywhere
  // in the database, which this test does not own; that the table was vacuumed
  // and analysed, and has statistics now, it does.
  it('vacuums and analyses both tables, which then have statistics', async () => {
    const conn = h.em().getConnection();
    await f.book({ audience: 'everyone', activate: false, rows: [{ product: f.products.P1, fixed: '90' }, { product: f.products.P2, fixed: '40' }] });
    for (const table of ['price_list_matrix_entries', 'price_list_product_lines']) {
      const [{ before }] = (await conn.execute(`select clock_timestamp() as "before"`)) as [{ before: string | Date }];
      await vacuumAnalyzeTable(conn, table);
      await conn.execute(`select pg_stat_clear_snapshot()`);
      const [stats] = await conn.execute<Array<{ reltuples: number; last_vacuum: string | Date | null; last_analyze: string | Date | null }>>(
        `select c."reltuples"::float8 as "reltuples", s."last_vacuum", s."last_analyze"
           from "pg_class" c join "pg_stat_user_tables" s on s."relid" = c."oid" where c."oid" = ?::regclass`,
        [table],
      );
      expect(Number(stats!.reltuples), table).toBeGreaterThan(0);
      expect(stats!.last_vacuum ? new Date(stats!.last_vacuum).getTime() : 0, table).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(stats!.last_analyze ? new Date(stats!.last_analyze).getTime() : 0, table).toBeGreaterThanOrEqual(new Date(before).getTime());
    }
  });
});

describe('price_lists table maintenance — one job per table per window (real BullMQ)', () => {
  let redis: Redis;
  let queue: Queue;
  let producer: TableMaintenanceProducer;
  let worker: Worker | undefined;
  const WINDOW_MS = 300;

  const start = (run: (table: string) => Promise<void>) => {
    const started = startTableMaintenanceWorker({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      connection: () => ({
        execute: async (sql: string) => {
          await run(/"(.+)"/.exec(sql)![1]!);
          return [];
        },
      }),
      log: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } as never,
      attach: (built) => {
        worker = built;
      },
    });
    expect(started).toBe(true);
  };
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(PRICE_LISTS_TABLE_MAINTENANCE_QUEUE, { connection: redis });
    await queue.obliterate({ force: true });
    producer = createTableMaintenanceProducer({ redis, windowMs: WINDOW_MS });
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await producer.close();
    await queue.close();
    await redis.quit();
  });

  it('a burst of requests costs one vacuum per table, run after the window', async () => {
    const ran: string[] = [];
    start(async (table) => {
      ran.push(table);
    });
    for (let i = 0; i < 5; i += 1) await producer.request();
    await settle(WINDOW_MS / 3);
    expect(ran).toEqual([]);
    await settle(WINDOW_MS * 4);
    expect(ran.sort()).toEqual(['price_list_matrix_entries', 'price_list_product_lines']);
  });

  it('a request while a vacuum runs gets one follow-up, never more', async () => {
    const ran: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    start(async (table) => {
      ran.push(table);
      if (ran.length <= 2) await gate;
    });
    await producer.request();
    await settle(WINDOW_MS * 2);
    expect(ran.length).toBeGreaterThanOrEqual(1);
    // While the first job of a table runs: three more requests.
    for (let i = 0; i < 3; i += 1) await producer.request();
    release();
    await settle(WINDOW_MS * 6);
    // The table whose vacuum was running when asked runs once more; the one
    // still waiting absorbed the request, and runs once.
    const count = (table: string) => ran.filter((t) => t === table).length;
    expect([count('price_list_matrix_entries'), count('price_list_product_lines')].sort()).toEqual([1, 2]);
  }, 20_000);
});
