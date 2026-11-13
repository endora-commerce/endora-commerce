import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * Table maintenance after a catalogue import — issue #409 (Principle X).
 *
 * Right after a bulk write Postgres has neither fresh statistics nor a
 * visibility map for the rows it rewrote, until autovacuum's first pass —
 * which, for an import below its scale factor, may never come. The admin's
 * ordered walk over `products_admin_order_<lang>` and its search count lean on
 * index-only scans, and without the visibility map each of them fetches every
 * heap tuple (spec 161 R14, `book-lines-page.bench.ts`). So an import asks for
 * `VACUUM (ANALYZE)` of `products` and `product_variants`: `ANALYZE` alone does
 * not set the visibility map, and `VACUUM` cannot run inside a transaction, so
 * it is a job here and never a statement in the import.
 *
 * **One job per table per window.** The job is delayed by the window and
 * deduplicated by its table, so every import while it waits is absorbed — the
 * vacuum still runs after them, because it runs later. An import while it
 * runs keeps one follow-up (`keepLastIfActive`). `import_export` reaches this
 * through `catalogBulkImportPort` — the import is this module's write — and
 * never names a table. `price_lists` keeps its own queue for its own tables.
 *
 * Best effort by design: the import has committed when it asks, so a queue
 * that cannot be reached is logged and the import answers as usual —
 * autovacuum remains the floor. Attached with `ctx.worker`, so it stops with
 * the module (Principle XVII), and built only where the host says this process
 * consumes queues.
 */

export const CATALOG_TABLE_MAINTENANCE_QUEUE = 'catalog.table-maintenance';
export const TABLE_MAINTENANCE_JOB = 'vacuum-analyze';
/** The tables a catalogue import rewrites. */
export const CATALOG_BULK_TABLES = ['products', 'product_variants'] as const;
export type CatalogBulkTable = (typeof CATALOG_BULK_TABLES)[number];
/**
 * How long a request waits before its vacuum runs, and so how many writes one
 * job absorbs. A minute is autovacuum's own default nap, and long enough for
 * imports run back to back to land under one job.
 */
export const TABLE_MAINTENANCE_WINDOW_MS = 60_000;

const SCOPE_REASON = 'catalog: vacuum the tables an import rewrote';

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
        queue = new Queue(CATALOG_TABLE_MAINTENANCE_QUEUE, {
          connection: input.redis,
          defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
        });
      }
      try {
        for (const table of CATALOG_BULK_TABLES) {
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
  if (!(CATALOG_BULK_TABLES as readonly string[]).includes(table)) {
    throw new Error(`table maintenance: "${table}" is not a catalog table`);
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
    CATALOG_TABLE_MAINTENANCE_QUEUE,
    (job) =>
      enterSystemScope(SCOPE_REASON, async () => {
        const start = Date.now();
        await vacuumAnalyzeTable(input.connection(), job.data.table);
        input.log.info({ table: job.data.table, ms: Date.now() - start }, 'catalog: vacuum (analyze) after an import');
      }),
    // One at a time: two vacuums of one table wait on each other anyway.
    { connection: input.moduleQueueRedis, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    input.log.error(
      { err, table: job?.data.table, attemptsMade: job?.attemptsMade },
      'catalog: vacuum (analyze) after an import failed; autovacuum remains the fallback',
    );
  });
  input.attach(worker);
  return true;
}
