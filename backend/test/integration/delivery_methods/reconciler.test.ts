import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { createDeliveryMethodSeeder } from '@endora-commerce/mod-delivery-methods/backend';
import { DeliveryMethod } from '../../helpers/package-entities.js';

/**
 * T013/T016 (US1) — the seeder auto-creates a configurable delivery_methods row
 * for a registered shipping adapter, seeding statusOn* and leaving an existing
 * row's admin configuration untouched (FR-002).
 *
 * **Reached through the published install surface since feature 134's W7**
 * (`specs/134-paid-module-extraction/contracts/foreign-write-repair.md` §2.1):
 * the class is the implementation and `createDeliveryMethodSeeder()` is the name
 * a consumer may write, so the test that judges the behaviour writes the same
 * name the two carrier install hooks and the carrier fixture do. It used to
 * import the class by relative path into the owner package's `src/`, which is
 * the one reach publishing the surface had to retire.
 *
 * The fixture is `setupTestDb` rather than `setupBackendServer`: the surface
 * writes a channel-bridge row and deletes one, and both belong inside a
 * transaction that is rolled back rather than in the shared database.
 */
describe('DeliveryMethodSeedApi — delivery_methods\' published install surface', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a row with seed status mappings when none exists, and reports it created', async () => {
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_${Date.now()}`;

    const { row, created } = await seeder.ensureMethodForAdapter(db.em(), 'my_carrier', {
      code,
      name: { default: 'Reconciled Shipping' },
    });

    expect(created).toBe(true);
    expect(row.adapter).toBe('my_carrier');
    expect(row.status).toBe('active');
    expect(row.statusOnSuccess).toBe('shipment_sent');
    expect(row.statusOnFailure).toBe('processing');

    const persisted = await db.em().findOne(DeliveryMethod, { code });
    expect(persisted?.adapter).toBe('my_carrier');
  });

  it('honours an explicit inactive status rather than the active default', async () => {
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_inactive_${Date.now()}`;

    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'quiet_carrier', {
      code,
      name: { default: 'Quiet' },
      status: 'inactive',
    });

    expect(row.status).toBe('inactive');
    const persisted = await db.em().findOne(DeliveryMethod, { code });
    expect(persisted?.status).toBe('inactive');
  });

  it('is idempotent, reports created=false and does not clobber existing configuration', async () => {
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_idem_${Date.now()}`;

    const first = await seeder.ensureMethodForAdapter(db.em(), 'idem_carrier', {
      code,
      name: { default: 'Idem' },
    });
    expect(first.created).toBe(true);

    const em = db.em();
    const row = await em.findOne(DeliveryMethod, { id: first.row.id });
    row!.statusOnSuccess = 'completed';
    await em.persistAndFlush(row!);

    const second = await seeder.ensureMethodForAdapter(db.em(), 'idem_carrier', {
      code,
      name: { default: 'Idem' },
    });

    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.statusOnSuccess).toBe('completed'); // admin edit preserved
  });

  it('binds a method to the system-default channel once, and answers false on a repeat', async () => {
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_bind_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'bind_carrier', {
      code,
      name: { default: 'Bind' },
    });

    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(true);
    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(false);

    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_delivery_methods" where "delivery_method_id" = ?',
        [row.id],
      );
    expect(bound.map((r) => r.sales_channel_id)).toEqual([db.systemDefaultChannelId]);
  });

  it('answers false, and writes nothing, when the platform has no system-default channel', async () => {
    // The state of a database that has been migrated and never booted: the
    // default channel is `DefaultChannelReconciler`'s, and it runs from
    // `composeApp`, which `module:install` does not (D-46). The partial unique
    // index permits zero winners, so clearing the flag inside this transaction is
    // the state rather than a contrivance. The seed migration this surface
    // replaced behaved the same way — its `cross join … where "system_default"`
    // matched nothing and inserted nothing.
    await db.em().execute('update "sales_channels" set "system_default" = false');
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_nochannel_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'unbound_carrier', {
      code,
      name: { default: 'Unbound' },
    });

    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(false);

    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_delivery_methods" where "delivery_method_id" = ?',
        [row.id],
      );
    expect(bound).toEqual([]);
    // The method itself is there, unbound — an operator binds it, or the first
    // boot's reconciler gives the platform a default channel and a re-install
    // does nothing, because the row already exists.
    expect(await db.em().findOne(DeliveryMethod, { code })).not.toBeNull();
  });

  it('removes the method and its channel memberships on the hard-uninstall path', async () => {
    const seeder = createDeliveryMethodSeeder();
    const code = `recon_ship_remove_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'remove_carrier', {
      code,
      name: { default: 'Remove' },
    });
    await seeder.bindToDefaultChannel(db.em(), row.id);

    expect(await seeder.removeMethodForAdapter(db.em(), code)).toBe(true);
    // Idempotent: a code that is not there is not an error.
    expect(await seeder.removeMethodForAdapter(db.em(), code)).toBe(false);

    expect(await db.em().findOne(DeliveryMethod, { code })).toBeNull();
    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_delivery_methods" where "delivery_method_id" = ?',
        [row.id],
      );
    expect(bound).toEqual([]);
  });
});
