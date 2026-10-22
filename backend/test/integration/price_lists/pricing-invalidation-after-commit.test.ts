import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceBookService } from '../../../../packages/modules/price_lists/src/backend/services/price-book-service.js';
import { PriceListStatusWorker } from '../../../../packages/modules/price_lists/src/backend/services/price-list-status-worker.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';

/**
 * D-287 P0 — **when** the pricing cache is told about a price write, and by whom
 * (`specs/pricing/read-paths-and-performance.md` §2.4).
 *
 *  1. An audited write invalidated from inside the Command Bus `run` callback,
 *     i.e. before its transaction committed, so a read racing the write
 *     re-cached the pre-write value for the whole TTL. It must invalidate after
 *     the bus returns — after commit — and not at all for a write that changed
 *     nothing.
 *  2. The status sweeper flips `scheduled → active` and `active → expired` and
 *     told nobody, so a sale starting at midnight stayed invisible for up to a
 *     further TTL after the sweep that started it.
 *
 * The bus here is a stand-in that records the moment it "commits" — the real
 * one commits when its `transactional` callback returns, which is the same
 * moment, and this file's transaction-rollback fixture cannot nest a second
 * commit inside it.
 *
 * Feature 160 — the audited writes are the price-book commands. P0's third
 * property, "a write that changed nothing invalidates nothing", has no
 * price-book counterpart: every book write moves the book's `version` (G5 of
 * `specs/161-price-book-editor/`), so there is no write that changes nothing.
 */

class RecordingCache {
  readonly calls: Array<{ committed: boolean }> = [];
  constructor(private readonly bus: { committed: boolean }) {}
  invalidateAll(): void {
    this.calls.push({ committed: this.bus.committed });
  }
}

function recordingBus(db: TestDb): CommandBus & { committed: boolean } {
  const bus = {
    committed: false,
    async run<T>(command: Command<T>): Promise<T> {
      bus.committed = false;
      const outcome = await command.run({
        em: db.em(),
        actor: {
          actorAdminUserId: null,
          impersonatedCustomerAccountId: null,
          kind: 'system',
        },
      });
      await db.em().flush();
      bus.committed = true;
      return outcome.result;
    },
  };
  return bus as unknown as CommandBus & { committed: boolean };
}

describe('price_lists — pricing cache invalidation happens after commit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('invalidates an audited write once, after the Command Bus has committed it', async () => {
    const bus = recordingBus(db);
    const cache = new RecordingCache(bus);
    const svc = new PriceBookService({
      emFactory: () => db.em(),
      commandBus: bus,
      pricingGeneration: cache,
      targetReads: neighbourReadPorts(() => db.em()),
    });

    const book = await svc.createBook({
      name: 'After commit',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [],
      audience: { kind: 'everyone', memberIds: [] },
      priority: 0,
    });
    expect(cache.calls).toEqual([{ committed: true }]);

    await svc.patchBook(book.id, { name: 'After commit, renamed' }, { expectedVersion: 1 });
    expect(cache.calls).toEqual([{ committed: true }, { committed: true }]);
  });

  it('the status sweeper invalidates when it activates or expires a book, and only then', async () => {
    const invalidations: number[] = [];
    const worker = new PriceListStatusWorker(() => db.em(), {
      invalidateAll: () => {
        invalidations.push(Date.now());
      },
    });

    // Nothing due: no invalidation.
    await worker.sweep(new Date());
    expect(invalidations).toHaveLength(0);

    const em = db.em();
    const scheduled = await seedPriceBookSql(em, { name: 'Midnight sale', type: 'sale', audience: 'everyone', rows: [], status: 'draft' });
    await em
      .getConnection()
      .execute(
        `update "price_lists" set "status" = 'scheduled', "starts_at" = ?, "ends_at" = ? where "id" = ?`,
        [new Date(Date.now() + 86_400_000), new Date(Date.now() + 3 * 86_400_000), scheduled],
        'run',
        em.getTransactionContext(),
      );

    const started = await worker.sweep(new Date(Date.now() + 2 * 86_400_000));
    expect(started.scheduledToActive).toBe(1);
    expect(invalidations).toHaveLength(1);

    const ended = await worker.sweep(new Date(Date.now() + 4 * 86_400_000));
    expect(ended.activeToExpired).toBe(1);
    expect(invalidations).toHaveLength(2);
  });
});
