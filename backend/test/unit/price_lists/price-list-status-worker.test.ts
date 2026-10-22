import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceListStatusWorker } from '../../../../packages/modules/price_lists/src/backend/services/price-list-status-worker.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';

/**
 * PriceListStatusWorker — unit-level integration tests (T039), on price books
 * (feature 160: the sweeper still flips a book's `status` for the admin;
 * applicability itself is read from the dates at resolution time, FR-047).
 *
 * Properties verified:
 *   - Idempotency: re-running the sweep on a stable clock yields zero
 *     transitions on the second pass.
 *   - A sweep with nothing to do writes nothing.
 *   - Empty work-set: returns {0, 0} without flushing.
 */
describe('PriceListStatusWorker (T039)', () => {
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

  const DAY = 86_400_000;

  /** A sale book in `status`, with the given window. */
  async function book(
    name: string,
    status: 'draft' | 'active' | 'scheduled',
    startsAt: Date | null = null,
    endsAt: Date | null = null,
  ): Promise<string> {
    const em = db.em();
    const id = await seedPriceBookSql(em, { name, type: 'sale', audience: 'everyone', rows: [], status: 'draft' });
    await em
      .getConnection()
      .execute(
        `update "price_lists" set "status" = ?, "starts_at" = ?, "ends_at" = ? where "id" = ?`,
        [status, startsAt, endsAt, id],
        'run',
        em.getTransactionContext(),
      );
    return id;
  }

  async function row(id: string): Promise<{ status: string; updated_at: Date }> {
    const em = db.em();
    const [found] = (await em
      .getConnection()
      .execute(`select "status", "updated_at" from "price_lists" where "id" = ?`, [id], 'all', em.getTransactionContext())) as Array<{
      status: string;
      updated_at: Date;
    }>;
    return found!;
  }

  it('returns {0, 0} when there is no transitionable work', async () => {
    try {
      const worker = new PriceListStatusWorker(() => db.em());
      const result = await worker.sweep(new Date());
      expect(result).toEqual({ scheduledToActive: 0, activeToExpired: 0 });
    } finally {
      await db.rollbackTx();
    }
  });

  it('idempotent: a second sweep on the same clock yields zero work', async () => {
    try {
      const worker = new PriceListStatusWorker(() => db.em());
      await book('Idem A', 'scheduled', new Date(Date.now() + DAY));

      const future = new Date(Date.now() + 2 * DAY);
      const first = await worker.sweep(future);
      expect(first.scheduledToActive).toBe(1);

      const second = await worker.sweep(future);
      expect(second.scheduledToActive).toBe(0);
      expect(second.activeToExpired).toBe(0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('writes nothing to a book it does not transition', async () => {
    try {
      const worker = new PriceListStatusWorker(() => db.em());
      const draft = await book('Stable Draft', 'draft');
      const before = await row(draft);

      await worker.sweep(new Date());
      const after = await row(draft);
      expect(after.status).toBe('draft');
      expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
    } finally {
      await db.rollbackTx();
    }
  });

  it('processes both scheduled→active and active→expired in a single sweep', async () => {
    try {
      const worker = new PriceListStatusWorker(() => db.em());
      const sched = await book('Sched', 'scheduled', new Date(Date.now() + DAY));
      const live = await book('Live', 'active', new Date(Date.now() - DAY), new Date(Date.now() + DAY));

      // Sweep at "now + 2 days" — sched should activate, live should expire.
      const result = await worker.sweep(new Date(Date.now() + 2 * DAY));
      expect(result.scheduledToActive).toBeGreaterThanOrEqual(1);
      expect(result.activeToExpired).toBeGreaterThanOrEqual(1);

      expect((await row(sched)).status).toBe('active');
      expect((await row(live)).status).toBe('expired');
    } finally {
      await db.rollbackTx();
    }
  });
});
