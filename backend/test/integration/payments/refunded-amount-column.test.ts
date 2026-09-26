import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Migration } from '@mikro-orm/migrations';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Order, Payment, PaymentMethod } from '../../helpers/package-entities.js';
import { Migration20260925T115728PaymentsRefundedAmount } from '../../../../packages/modules/payments/src/migrations/20260925T115728_payments_refunded_amount.js';

/**
 * `payments.refunded_amount` belongs to `payments` — feature 134's T117,
 * feature 134's research D14 §4 and FR-065.
 *
 * `payments`' entity maps the column, and until this repair the only migration
 * creating it was `stripe`'s: an instance without `stripe` could not insert a
 * payment, and `stripe`'s hard uninstall dropped a column a free module reads.
 * `payments` now adds it with `if not exists`, and `stripe`'s migration keeps
 * its class name with both bodies emptied.
 *
 * The rows of D14 §4's regime table that involve `payments` alone are driven
 * here against the real schema, inside one transaction that is rolled back —
 * Postgres DDL is transactional, so dropping the column to stage the "fresh,
 * free instance" row costs the next test nothing. The migrations are run the
 * way the migrator runs them: instantiate, call `up()`/`down()`, execute what
 * they queued. The rows that involve `stripe` are in
 * `test/integration/stripe/refunded-amount-emptied.test.ts`, which leaves this
 * repository with the module; this file does not name it, so it stays.
 */

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

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

/** What a migration's `up()` or `down()` queues, as SQL text. */
async function queued(cls: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = new cls(db.orm.em.getDriver(), db.orm.config);
  await migration[direction]();
  return migration.getQueries().map((query) => query.toString());
}

/** Runs a migration direction inside the test transaction. */
async function run(cls: MigrationClass, direction: 'up' | 'down'): Promise<void> {
  for (const sql of await queued(cls, direction)) await db.em().execute(sql);
}

async function columnExists(em: EntityManager): Promise<boolean> {
  const rows = await em.execute<{ present: boolean }[]>(
    `select exists (select 1 from information_schema.columns
       where table_schema = current_schema() and table_name = 'payments'
         and column_name = 'refunded_amount') as present`,
  );
  return rows[0]!.present;
}

async function refundedAmountOf(em: EntityManager, id: string): Promise<string> {
  const rows = await em.execute<{ refunded_amount: string }[]>(
    `select refunded_amount::text as refunded_amount from payments where id = ?`,
    [id],
  );
  return rows[0]!.refunded_amount;
}

const ADDRESS = { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' };

/** A payment row that exists before the migration runs, with a refund on it. */
async function seedPayment(em: EntityManager, refundedAmount: string): Promise<string> {
  const method = em.create(PaymentMethod, {
    code: `refcol_${randomUUID().slice(0, 8)}`,
    name: { default: 'Refcol' },
    kind: 'gateway',
    adapter: 'bank_transfer',
    status: 'active',
    statusOnPending: 'new',
    statusOnSuccess: 'completed',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush(method);
  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: db.systemDefaultChannelId,
    deliveryAddress: ADDRESS,
    billingAddress: ADDRESS,
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
    paymentMethodId: method.id,
    paymentMethodSnapshot: {
      code: method.code,
      name: 'Refcol',
      kind: 'gateway',
      adapter: method.adapter,
    },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  const payment = em.create(Payment, {
    orderId: order.id,
    paymentMethodId: method.id,
    amount: '123.00',
    currency: 'PLN',
    refundedAmount,
  });
  await em.persistAndFlush(payment);
  return payment.id;
}

describe('payments.refunded_amount — the regimes payments decides alone (D14 §4)', () => {
  it('fresh, free instance: payments creates the column, 0 on rows that already exist', async () => {
    const em = db.em();
    const id = await seedPayment(em, '0.00');
    await em.execute(`alter table "payments" drop column "refunded_amount"`);
    expect(await columnExists(em)).toBe(false);

    await run(Migration20260925T115728PaymentsRefundedAmount, 'up');

    expect(await columnExists(em)).toBe(true);
    expect(await refundedAmountOf(em, id)).toBe('0.00');
  });

  it('existing database: payments’ up() is a no-op and keeps every value', async () => {
    const em = db.em();
    const id = await seedPayment(em, '12.34');

    await run(Migration20260925T115728PaymentsRefundedAmount, 'up');

    expect(await refundedAmountOf(em, id)).toBe('12.34');
  });

  it('payments’ down() issues no SQL — the table and its rows outlive payments’ uninstall', async () => {
    expect(await queued(Migration20260925T115728PaymentsRefundedAmount, 'down')).toEqual([]);
  });
});
