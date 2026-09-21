import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { createPaymentMethodSeeder } from '@endora-commerce/mod-payment-methods/install';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * T013 (US1) — the seeder auto-creates a configurable `payment_methods` row for
 * a registered payment adapter, seeding `statusOn*` and leaving an existing
 * row's admin configuration untouched (FR-002).
 *
 * **Reached through the published install surface since feature 134's W7**
 * (`specs/134-paid-module-extraction/contracts/foreign-write-repair.md` §2.1):
 * the class is the implementation and `createPaymentMethodSeeder()` is the name
 * a consumer may write, so the test that judges the behaviour writes the same
 * name the five gateway install hooks and the gateway fixture do. It used to
 * import the class by relative path into the owner package's `src/`, which is
 * the one reach publishing the surface had to retire. The delivery twin —
 * `../delivery_methods/reconciler.test.ts` — is the same file one wave earlier.
 *
 * The fixture is `setupTestDb` rather than `setupBackendServer`: the surface
 * writes a channel-bridge row and deletes one, and both belong inside a
 * transaction that is rolled back rather than in the shared database.
 */
describe("PaymentMethodSeedApi — payment_methods' published install surface", () => {
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
    const seeder = createPaymentMethodSeeder();
    const code = `recon_${Date.now()}`;

    const { row, created } = await seeder.ensureMethodForAdapter(db.em(), 'my_adapter', {
      code,
      type: 'gateway',
      name: { default: 'Reconciled Method' },
    });

    expect(created).toBe(true);
    expect(row.adapter).toBe('my_adapter');
    expect(row.kind).toBe('gateway');
    expect(row.status).toBe('active');
    expect(row.additionalPrice).toBe('0');
    expect(row.statusOnPending).toBe('new');
    expect(row.statusOnSuccess).toBe('paid');
    // Feature 085 (FR-003) — a declined payment holds the order at `on_hold`
    // instead of cancelling it. `cancelled` is terminal, so the seeded default
    // used to make the buyer's most recoverable mistake irreversible.
    //
    // **This default is what retires the five `*_failure_status_on_hold`
    // migrations with no replacement** (`foreign-write-repair.md` §4). Their only
    // subject was rows the old seed migrations wrote with `'cancelled'`; a fresh
    // install through this surface cannot produce one, so the correction has
    // nothing left to correct. The assertion is therefore load-bearing for five
    // emptied migration bodies and not only for this one row.
    expect(row.statusOnFailure).toBe('on_hold');

    const persisted = await db.em().findOne(PaymentMethod, { code });
    expect(persisted?.adapter).toBe('my_adapter');
    expect(persisted?.statusOnFailure).toBe('on_hold');
  });

  it('honours an explicit inactive status rather than the active default', async () => {
    // Every one of the five gateway seeds passes `'inactive'`, and taking the
    // default instead would offer a payment method at checkout that no operator
    // chose (§2.4). The argument has to be exercised, not only documented.
    const seeder = createPaymentMethodSeeder();
    const code = `recon_inactive_${Date.now()}`;

    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'quiet_gateway', {
      code,
      type: 'gateway',
      name: { default: 'Quiet' },
      status: 'inactive',
    });

    expect(row.status).toBe('inactive');
    const persisted = await db.em().findOne(PaymentMethod, { code });
    expect(persisted?.status).toBe('inactive');
  });

  it('is idempotent, reports created=false and does not clobber existing configuration', async () => {
    const seeder = createPaymentMethodSeeder();
    const code = `recon_idem_${Date.now()}`;

    const first = await seeder.ensureMethodForAdapter(db.em(), 'idem_adapter', {
      code,
      type: 'bank_transfer',
      name: { default: 'Idem' },
    });
    expect(first.created).toBe(true);

    // Simulate an admin edit.
    const em = db.em();
    const row = await em.findOne(PaymentMethod, { id: first.row.id });
    row!.statusOnSuccess = 'completed';
    await em.persistAndFlush(row!);

    const second = await seeder.ensureMethodForAdapter(db.em(), 'idem_adapter', {
      code,
      type: 'bank_transfer',
      name: { default: 'Idem' },
    });

    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.statusOnSuccess).toBe('completed'); // admin edit preserved
  });

  it('binds a method to the system-default channel once, and answers false on a repeat', async () => {
    const seeder = createPaymentMethodSeeder();
    const code = `recon_bind_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'bind_gateway', {
      code,
      type: 'gateway',
      name: { default: 'Bind' },
    });

    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(true);
    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(false);

    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_payment_methods" where "payment_method_id" = ?',
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
    const seeder = createPaymentMethodSeeder();
    const code = `recon_nochannel_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'unbound_gateway', {
      code,
      type: 'gateway',
      name: { default: 'Unbound' },
    });

    expect(await seeder.bindToDefaultChannel(db.em(), row.id)).toBe(false);

    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_payment_methods" where "payment_method_id" = ?',
        [row.id],
      );
    expect(bound).toEqual([]);
    // The method itself is there, unbound — an operator binds it, or the first
    // boot's reconciler gives the platform a default channel and a re-install
    // does nothing, because the row already exists.
    expect(await db.em().findOne(PaymentMethod, { code })).not.toBeNull();
  });

  it('removes the method and its channel memberships on the hard-uninstall path', async () => {
    const seeder = createPaymentMethodSeeder();
    const code = `recon_remove_${Date.now()}`;
    const { row } = await seeder.ensureMethodForAdapter(db.em(), 'remove_gateway', {
      code,
      type: 'gateway',
      name: { default: 'Remove' },
    });
    await seeder.bindToDefaultChannel(db.em(), row.id);

    expect(await seeder.removeMethodForAdapter(db.em(), code)).toBe(true);
    // Idempotent: a code that is not there is not an error.
    expect(await seeder.removeMethodForAdapter(db.em(), code)).toBe(false);

    expect(await db.em().findOne(PaymentMethod, { code })).toBeNull();
    const bound = await db
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_payment_methods" where "payment_method_id" = ?',
        [row.id],
      );
    expect(bound).toEqual([]);
  });
});
