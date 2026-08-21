import { afterAll, beforeEach, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Migration } from '@mikro-orm/migrations';
import { setupMigratorTestDb, type TestDb } from '../../helpers/test-db.js';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { Migration20260821T084920PaymentMethodsFailureStatusOnHold } from '../../../src/modules/payment_methods/migrations/20260821T084920_payment_methods_failure_status_on_hold.js';
import { Migration20260821T084922StripeFailureStatusOnHold } from '../../../src/modules/stripe/migrations/20260821T084922_stripe_failure_status_on_hold.js';
import { Migration20260821T084923PayuFailureStatusOnHold } from '../../../src/modules/payu/migrations/20260821T084923_payu_failure_status_on_hold.js';
import { Migration20260821T084924TpayFailureStatusOnHold } from '../../../src/modules/tpay/migrations/20260821T084924_tpay_failure_status_on_hold.js';
import { Migration20260821T084925AutopayFailureStatusOnHold } from '../../../src/modules/autopay/migrations/20260821T084925_autopay_failure_status_on_hold.js';

/**
 * Feature 085 (FR-005 / SC-003) — no payment method a freshly installed
 * platform ships cancels an order on a failed payment.
 *
 * ### Why this file takes a database of its own
 *
 * The fact under test is a property of the **migrated** database, and
 * `payment_methods` is in the harness truncate list — so the first
 * `setupBackendServer` in the invocation deletes exactly the rows this file is
 * here to read, and a file scheduled after it would assert over an empty table
 * and report clean. `setupMigratorTestDb()` clones the same migrated template
 * the run was cloned from, which is a `db:fresh` and nothing else has touched.
 *
 * It is deliberately **not** in `MIGRATOR_DRIVING_TESTS`: that ledger's
 * population is files that reach for the ORM's migrator handle, this file
 * reaches for it nowhere, and an entry for it would be reported stale by
 * `test/unit/harness/migrator-driving-ledger.test.ts`. It borrows the seam for
 * the clone, not for the migrator — it reads a migrated database, it does not
 * migrate one.
 *
 * ### The ordering trap this is really guarding
 *
 * All four gateway modules declare `payment_methods` in their manifest
 * `dependencies`, and feature 081 orders migrations module by module along that
 * graph. A single normalisation owned by `payment_methods` therefore runs
 * *before* all four gateway seeds: on a fresh database it would normalise
 * nothing and the gateways would insert `'cancelled'` right after it. That
 * failure is invisible to every unit test of the SQL and to any test that seeds
 * its own method — only the migrated database shows it.
 */

/** The codes the four gateway seed migrations create. */
const SEEDED_GATEWAY_CODES = [
  'stripe_card',
  'stripe_blik',
  'stripe_bank_transfer',
  'stripe_apple_pay',
  'stripe_google_pay',
  'payu_blik',
  'payu_card',
  'payu_pbl',
  'payu_apple_pay',
  'payu_google_pay',
  'tpay_blik',
  'tpay_card',
  'tpay_bank_transfer',
  'autopay_pbl',
] as const;

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

/** The `payment_methods` normalisation, then the four that follow their own seed. */
const NORMALISATIONS: ReadonlyArray<readonly [string, MigrationClass]> = [
  ['payment_methods', Migration20260821T084920PaymentMethodsFailureStatusOnHold],
  ['stripe', Migration20260821T084922StripeFailureStatusOnHold],
  ['payu', Migration20260821T084923PayuFailureStatusOnHold],
  ['tpay', Migration20260821T084924TpayFailureStatusOnHold],
  ['autopay', Migration20260821T084925AutopayFailureStatusOnHold],
];

async function failureStatusByCode(em: EntityManager): Promise<Map<string, string>> {
  const rows = await em.execute<{ code: string; status_on_failure: string }[]>(
    'select "code", "status_on_failure" from "payment_methods" order by "code" asc',
  );
  return new Map(rows.map((row) => [row.code, row.status_on_failure]));
}

/**
 * Replay a migration's own statements against this transaction. The SQL is read
 * off the migration object rather than copied here, so a test that passes is a
 * statement about the file that will actually run on a deployment.
 */
async function replay(db: TestDb, ctor: MigrationClass): Promise<void> {
  const migration = new ctor(db.orm.em.getDriver(), db.orm.config);
  await migration.up();
  for (const query of migration.getQueries()) {
    if (typeof query !== 'string') throw new Error('Expected a plain SQL statement.');
    await db.em().execute(query);
  }
}

describe('shipped status_on_failure default [integration]', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupMigratorTestDb();
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

  it('leaves no payment method cancelling an order on a failed payment', async () => {
    const byCode = await failureStatusByCode(db.em());

    // Not vacuous: the four gateway seeds are the rows a fresh install has, and
    // a table this file found empty would otherwise pass the assertion below
    // while proving nothing.
    for (const code of SEEDED_GATEWAY_CODES) {
      expect(byCode.get(code), `${code} is missing from the migrated database`).toBeDefined();
    }

    const cancelling = [...byCode].filter(([, status]) => status === 'cancelled');
    expect(
      cancelling,
      'A freshly migrated platform still has payment methods that cancel an order on a ' +
        'failed payment. `cancelled` is terminal, so the buyer cannot pay again.',
    ).toEqual([]);
  });

  it('holds every seeded gateway method at the on-hold failure status', async () => {
    const byCode = await failureStatusByCode(db.em());
    for (const code of SEEDED_GATEWAY_CODES) {
      expect(byCode.get(code), code).toBe('on_hold');
    }
  });

  /**
   * The ordering trap, asserted where it bites: each gateway's normalisation
   * must sit after that gateway's seed in the order feature 081 computes, or a
   * fresh database ends with `'cancelled'` whatever the SQL says. Read off the
   * ORM config, which is the same list the migrator runs.
   */
  it('runs each gateway normalisation after that gateway`s own seed', () => {
    const names = (mikroOrmConfig.migrations?.migrationsList ?? []).map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(0);
    const at = (fragment: string): number => {
      const index = names.findIndex((name) => name.includes(fragment));
      expect(index, `${fragment} is not in the configured migration order`).toBeGreaterThanOrEqual(0);
      return index;
    };
    for (const gateway of ['Stripe', 'Payu', 'Tpay', 'Autopay']) {
      expect(
        at(`${gateway}FailureStatusOnHold`),
        `${gateway} normalises before it seeds — on a fresh database it normalises nothing`,
      ).toBeGreaterThan(at(`${gateway}SeedPaymentMethods`));
    }
    // And the trap itself: the `payment_methods` normalisation is before all
    // four seeds, which is why it cannot be the only one.
    for (const gateway of ['Stripe', 'Payu', 'Tpay', 'Autopay']) {
      expect(at('PaymentMethodsFailureStatusOnHold')).toBeLessThan(
        at(`${gateway}SeedPaymentMethods`),
      );
    }
  });

  it('changes nothing when its five migrations run a second time', async () => {
    const before = await failureStatusByCode(db.em());
    for (const [, ctor] of NORMALISATIONS) await replay(db, ctor);
    expect(await failureStatusByCode(db.em())).toEqual(before);
  });

  /**
   * The other direction of the same fact: put every row back to `'cancelled'`
   * and run only the **four gateway** normalisations. Each must reach its own
   * rows — that is what a fresh database depends on, since `payment_methods`
   * has already run by the time the gateways seed.
   */
  it('has each gateway normalisation reaching its own rows', async () => {
    await db.em().execute(`update "payment_methods" set "status_on_failure" = 'cancelled'`);
    for (const [owner, ctor] of NORMALISATIONS) {
      if (owner === 'payment_methods') continue;
      await replay(db, ctor);
    }

    const byCode = await failureStatusByCode(db.em());
    for (const code of SEEDED_GATEWAY_CODES) {
      expect(byCode.get(code), code).toBe('on_hold');
    }
  });
});
