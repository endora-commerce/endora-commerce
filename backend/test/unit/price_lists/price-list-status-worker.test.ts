import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PriceListStatusWorker } from '../../../../packages/modules/price_lists/src/backend/services/price-list-status-worker.js';
import { DefaultPriceListMigrator } from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * PriceListStatusWorker — unit-level integration tests (T039).
 *
 * Properties verified:
 *   - Idempotency: re-running the sweep on a stable clock yields zero
 *     transitions on the second pass.
 *   - Modified-at bumps occur only on actual transitions.
 *   - Empty work-set: returns {0, 0} without flushing.
 */

const TEST_RULE = { kind: 'criterion' as const, type: 'currency' as const, values: ['PLN'] };
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
    const migrator = new DefaultPriceListMigrator(() => db.em());
    await migrator.seedDefault();
  });

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
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());

      const created = await svc.create({
        name: 'Idem A',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(created.id); // scheduled

      const future = new Date(Date.now() + 2 * 86_400_000);
      const first = await worker.sweep(future);
      expect(first.scheduledToActive).toBe(1);

      const second = await worker.sweep(future);
      expect(second.scheduledToActive).toBe(0);
      expect(second.activeToExpired).toBe(0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('bumps modifiedAt only on actual transitions', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());

      const draft = await svc.create({ name: 'Stable Draft', type: 'base' });
      const t0 = draft.modifiedAt.getTime();

      // No-op sweep.
      await worker.sweep(new Date());
      const after = await svc.getById(draft.id);
      expect(after.modifiedAt.getTime()).toBe(t0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('processes both scheduled→active and active→expired in a single sweep', async () => {
    try {
      const svc = new PriceListService(() => db.em(), undefined, undefined, undefined, neighbourReadPorts(() => db.em()));
      const worker = new PriceListStatusWorker(() => db.em());

      // Scheduled list (startsAt in the future relative to now).
      const sched = await svc.create({
        name: 'Sched',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(sched.id);

      // Active list (endsAt soon).
      const active = await svc.create({
        name: 'Live',
        type: 'sale',
        applicationRule: TEST_RULE,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      });
      await svc.activate(active.id);

      // Sweep at "now + 2 days" — sched should activate, live should expire.
      const future = new Date(Date.now() + 2 * 86_400_000);
      const result = await worker.sweep(future);
      expect(result.scheduledToActive).toBeGreaterThanOrEqual(1);
      expect(result.activeToExpired).toBeGreaterThanOrEqual(1);

      const reloadedSched = await svc.getById(sched.id);
      const reloadedActive = await svc.getById(active.id);
      expect(reloadedSched.status).toBe('active');
      expect(reloadedActive.status).toBe('expired');
    } finally {
      await db.rollbackTx();
    }
  });
});
