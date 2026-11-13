import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * Table maintenance after a bulk write — issue #409 (Principle X).
 *
 * Right after a bulk write Postgres has neither fresh statistics nor a
 * visibility map for the rows it wrote, until autovacuum's first pass — which,
 * for a write below its scale factor, may never come. The price-book editor's
 * reads lean on index-only scans, and without the visibility map each of them
 * fetches every heap tuple (spec 161 R14, `book-lines-page.bench.ts`). So a
 * write that grows a book's rows asks for `VACUUM (ANALYZE)` of the two tables
 * it grew: `ANALYZE` alone does not set the visibility map, and `VACUUM`
 * cannot run inside a transaction, so it is a job here and never a statement
 * in the write.
 *
 * **One job per table per window.** The job is delayed by the window and
 * deduplicated by its table, so every write while it waits is absorbed — the
 * vacuum still runs after them, because it runs later. A write while it runs
 * keeps one follow-up (`keepLastIfActive`), so a write the running vacuum may
 * have missed is never left without one. Each module asks for its own tables
 * only; a caller elsewhere reaches this through the write it makes, never by
 * naming a table.
 *
 * Best effort by design: the write has committed when it asks, so a queue that
 * cannot be reached is logged and the write answers as usual — autovacuum
 * remains the floor. Attached with `ctx.worker`, so it stops with the module
 * (Principle XVII), and built only where the host says this process consumes
 * queues.
 */

export const PRICE_LISTS_TABLE_MAINTENANCE_QUEUE = 'price_lists.table-maintenance';
export const TABLE_MAINTENANCE_JOB = 'vacuum-analyze';
/** The tables a price-book row write grows. */
export const PRICE_LISTS_BULK_TABLES = ['price_list_matrix_entries', 'price_list_product_lines'] as const;
export type PriceListsBulkTable = (typeof PRICE_LISTS_BULK_TABLES)[number];
/**
 * How long a request waits before its vacuum runs, and so how many writes one
 * job absorbs. A minute is autovacuum's own default nap, and long enough for a
 * CSV import's batches to land under one job.
 */
export const TABLE_MAINTENANCE_WINDOW_MS = 60_000;

const SCOPE_REASON = 'price_lists: vacuum the tables a bulk write grew';

interface MaintenanceQueue {
  add(name: string, data: { table: string }, options: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface TableMaintenanceProducer {
  /** Ask for `VACUUM (ANALYZE)` of this module's bulk tables; answers whether it was asked. Never throws. */
  request(): Promise<boolean>;
  close(): Promise<void>;
}

export function createTableMaintenanceProducer(input: {
  readonly redis?: Redis | undefined;
  /** A queue to use instead of one built on `redis` (tests). */
  readonly queue?: MaintenanceQueue;
  readonly onError?: (err: unknown) => void;
  /** {@link TABLE_MAINTENANCE_WINDOW_MS} unless a test shortens it. */
  readonly windowMs?: number;
}): TableMaintenanceProducer {
  const windowMs = input.windowMs ?? TABLE_MAINTENANCE_WINDOW_MS;
  let queue: MaintenanceQueue | undefined = input.queue;
  return {
    async request(): Promise<boolean> {
      if (queue === undefined) {
        if (input.redis === undefined) return false;
        queue = new Queue(PRICE_LISTS_TABLE_MAINTENANCE_QUEUE, {
          connection: input.redis,
          defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
        });
      }
      try {
        for (const table of PRICE_LISTS_BULK_TABLES) {
          await queue.add(
            TABLE_MAINTENANCE_JOB,
            { table },
            { delay: windowMs, deduplication: { id: table, keepLastIfActive: true } },
          );
        }
        return true;
      } catch (err) {
        input.onError?.(err);
        return false;
      }
    },
    async close(): Promise<void> {
      await queue?.close();
      queue = input.queue;
    },
  };
}

/**
 * The job: `VACUUM (ANALYZE)` of one of this module's tables, on a connection
 * outside any transaction. The name comes off a queue, so it is checked
 * against the module's own list before it reaches the statement.
 */
export async function vacuumAnalyzeTable(
  connection: { execute(sql: string): Promise<unknown> },
  table: string,
): Promise<void> {
  if (!(PRICE_LISTS_BULK_TABLES as readonly string[]).includes(table)) {
    throw new Error(`table maintenance: "${table}" is not a price_lists table`);
  }
  await connection.execute(`vacuum (analyze) "${table}"`);
}

export function startTableMaintenanceWorker(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly connection: () => { execute(sql: string): Promise<unknown> };
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker) => void;
}): boolean {
  if (!input.processRunsWorkers || input.moduleQueueRedis === undefined) return false;
  const worker = new Worker<{ table: string }>(
    PRICE_LISTS_TABLE_MAINTENANCE_QUEUE,
    (job) =>
      enterSystemScope(SCOPE_REASON, async () => {
        const start = Date.now();
        await vacuumAnalyzeTable(input.connection(), job.data.table);
        input.log.info({ table: job.data.table, ms: Date.now() - start }, 'price_lists: vacuum (analyze) after a bulk write');
      }),
    // One at a time: two vacuums of one table wait on each other anyway.
    { connection: input.moduleQueueRedis, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    input.log.error(
      { err, table: job?.data.table, attemptsMade: job?.attemptsMade },
      'price_lists: vacuum (analyze) after a bulk write failed; autovacuum remains the fallback',
    );
  });
  input.attach(worker);
  return true;
}
