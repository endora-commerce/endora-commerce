import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261115T182156InventoryAvailabilityNotificationNotifiedStatus } from '@endora-commerce/mod-inventory/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #1291 — the stock worker stamped `notified_at` on a subscription it consumed and left
 * `status = 'queued'`. The migration turns every such row into `notified` and touches nothing
 * else: a queued row still waiting, and a row already `notified` or `cancelled`, keep their state.
 *
 * Everything runs in one transaction the test rolls back, and the assertions read only the rows
 * this file inserts.
 */
describe('inventory availability-notification notified-status migration (issue #1291)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  const EMAIL = (tag: string): string => `m1291-${tag}@example.test`;

  async function seed(tag: string, status: string, notified: boolean): Promise<void> {
    const [product] = (await em.execute(`select id from products order by id limit 1`)) as Array<{ id: string }>;
    await em.execute(
      `insert into availability_notifications (id, product_id, email, status, requested_at, notified_at)
       values (gen_random_uuid(), ?, ?, ?, now(), ${notified ? 'now()' : 'null'})`,
      [product!.id, EMAIL(tag), status],
    );
  }

  async function statusOf(tag: string): Promise<string | undefined> {
    const rows = (await em.execute(`select status from availability_notifications where email = ?`, [
      EMAIL(tag),
    ])) as Array<{ status: string }>;
    return rows[0]?.status;
  }

  async function up(): Promise<void> {
    const migration = new Migration20261115T182156InventoryAvailabilityNotificationNotifiedStatus(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const sql of migration.getQueries().map((q) => String(q))) await em.execute(sql);
  }

  it('marks a consumed row the worker left queued as notified, and leaves every other row alone', async () => {
    await seed('stuck', 'queued', true);
    await seed('waiting', 'queued', false);
    await seed('notified', 'notified', true);
    await seed('cancelled', 'cancelled', true);

    await up();

    expect(await statusOf('stuck')).toBe('notified');
    expect(await statusOf('waiting')).toBe('queued');
    expect(await statusOf('notified')).toBe('notified');
    expect(await statusOf('cancelled')).toBe('cancelled');
  });

  it('is a no-op on a second run', async () => {
    await seed('again', 'queued', true);
    await up();
    await up();
    expect(await statusOf('again')).toBe('notified');
  });
});
