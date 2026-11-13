import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_BULK_TABLES,
  CATALOG_TABLE_MAINTENANCE_QUEUE,
  TABLE_MAINTENANCE_WINDOW_MS,
  createTableMaintenanceProducer,
  vacuumAnalyzeTable,
} from './table-maintenance-queue.js';

/**
 * Issue #409 — after a catalogue import, `VACUUM (ANALYZE)` runs in the
 * background on `products` and `product_variants`, so the admin's ordered
 * walks and search counts stop fetching every heap tuple before autovacuum's
 * first pass. `VACUUM` cannot run inside a transaction, so it is a BullMQ job
 * (Principle X), and a burst of imports costs one job per table per window.
 */

function fakeQueue() {
  const add = vi.fn(async () => ({ id: 'j' }));
  const close = vi.fn(async () => undefined);
  return { add, close };
}

describe('catalog table maintenance — the producer', () => {
  it('asks for one delayed job per table, deduplicated by the table and kept once while one runs', async () => {
    const queue = fakeQueue();
    const producer = createTableMaintenanceProducer({ queue });
    expect(await producer.request()).toBe(true);
    expect(queue.add).toHaveBeenCalledTimes(CATALOG_BULK_TABLES.length);
    for (const table of CATALOG_BULK_TABLES) {
      expect(queue.add).toHaveBeenCalledWith(
        'vacuum-analyze',
        { table },
        expect.objectContaining({
          delay: TABLE_MAINTENANCE_WINDOW_MS,
          deduplication: { id: table, keepLastIfActive: true },
        }),
      );
    }
  });

  it('owns exactly the two tables an import rewrites', () => {
    expect([...CATALOG_BULK_TABLES].sort()).toEqual(['product_variants', 'products']);
    expect(CATALOG_TABLE_MAINTENANCE_QUEUE).toBe('catalog.table-maintenance');
  });

  it('asks for nothing where this process has no queue connection', async () => {
    const producer = createTableMaintenanceProducer({ redis: undefined });
    expect(await producer.request()).toBe(false);
  });

  it('never fails the write that asked: a queue error is reported and swallowed', async () => {
    const queue = fakeQueue();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const onError = vi.fn();
    const producer = createTableMaintenanceProducer({ queue, onError });
    expect(await producer.request()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('catalog table maintenance — the job', () => {
  it('runs VACUUM (ANALYZE) on the named table, outside any transaction', async () => {
    const execute = vi.fn(async () => []);
    await vacuumAnalyzeTable({ execute }, 'products');
    expect(execute).toHaveBeenCalledWith('vacuum (analyze) "products"');
  });

  it('refuses a table this module does not own, executing nothing', async () => {
    const execute = vi.fn(async () => []);
    await expect(vacuumAnalyzeTable({ execute }, 'products"; drop table x; --')).rejects.toThrow(/not a catalog table/);
    await expect(vacuumAnalyzeTable({ execute }, 'price_list_matrix_entries')).rejects.toThrow(/not a catalog table/);
    expect(execute).not.toHaveBeenCalled();
  });
});
