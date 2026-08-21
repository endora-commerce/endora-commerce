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
import { Migration20260821T164749PaypalFailureStatusOnHold } from '../../../src/modules/paypal/migrations/20260821T164749_paypal_failure_status_on_hold.js';

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
 * Every gateway module declares `payment_methods` in its manifest
 * `dependencies`, and feature 081 orders migrations module by module along that
 * graph. A single normalisation owned by `payment_methods` therefore runs
 * *before* every gateway seed: on a fresh database it normalises nothing and
 * the gateways insert `'cancelled'` right after it. That failure is invisible
 * to every unit test of the SQL and to any test that seeds its own method —
 * only the migrated database shows it.
 *
 * **A migration that sweeps existing rows cannot fix rows a later migration
 * inserts**, so the trap re-arms itself for every gateway added after Phase C.
 * It did: feature 086's PayPal merged from a branch that predated the sweep and
 * shipped `status_on_failure = 'cancelled'` at order position 146, twenty-six
 * positions after the sweep at 120. Its repair is
 * `20260821T164749_paypal_failure_status_on_hold.ts`, the sixth file of a shape
 * there will be one of per gateway.
 *
 * ### What that cost this file, and what it derives now
 *
 * The assertions below used to be four hand-written lists — the seeded codes,
 * the normalisation classes, the gateway names checked for ordering, and the
 * literal `'cancelled'`. Three of the four say nothing about a gateway nobody
 * remembered to add them to, which is the position PayPal was in. So:
 *
 * - the invariant is read off `order_statuses.is_terminal` over the **whole**
 *   table, not off the string `'cancelled'` over a list of codes. It fails for
 *   any method a migration seeds into any terminal status, today's or not;
 * - the ordering claim derives its gateway set from the configured migration
 *   order, so a gateway that ships a normalisation stamped before its own seed
 *   is named without anybody editing a list;
 * - `SEEDED_GATEWAY_CODES` is still hand-written, because it is the
 *   non-vacuity floor and there is nothing to derive it from — but a test below
 *   fails when a derived gateway module contributes no code to it, so it cannot
 *   go stale in silence.
 */

/** The codes the gateway seed migrations create. Non-vacuity floor; see below. */
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
  'paypal_checkout',
] as const;

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

/** The `payment_methods` normalisation, then the ones that follow their own seed. */
const NORMALISATIONS: ReadonlyArray<readonly [string, MigrationClass]> = [
  ['payment_methods', Migration20260821T084920PaymentMethodsFailureStatusOnHold],
  ['stripe', Migration20260821T084922StripeFailureStatusOnHold],
  ['payu', Migration20260821T084923PayuFailureStatusOnHold],
  ['tpay', Migration20260821T084924TpayFailureStatusOnHold],
  ['autopay', Migration20260821T084925AutopayFailureStatusOnHold],
  ['paypal', Migration20260821T164749PaypalFailureStatusOnHold],
];

const SEED_CLASS_RE = /^Migration\d{8}T\d{6}(.+)SeedPaymentMethods$/;
const NORMALISATION_CLASS_RE = /^Migration\d{8}T\d{6}(.+)FailureStatusOnHold$/;

/**
 * The migration order the migrator will actually run, read off the ORM config.
 *
 * The owner segment of a migration class name is its module (feature 081's
 * `unscoped-name` rule makes that a contract, not a convention), so the gateway
 * set is derivable and nothing here is a list somebody has to remember.
 */
function configuredOrder(): string[] {
  const names = (mikroOrmConfig.migrations?.migrationsList ?? []).map((entry) => entry.name);
  // Exit-2 equivalent: an empty list would make every assertion below vacuous.
  expect(names.length, 'the configured migration order is empty').toBeGreaterThan(0);
  return names;
}

/** `owner segment` → position, for every migration matching `pattern`. */
function positionsBySegment(names: readonly string[], pattern: RegExp): Map<string, number> {
  const found = new Map<string, number>();
  names.forEach((name, index) => {
    const match = pattern.exec(name);
    if (match) found.set(match[1]!, index);
  });
  return found;
}

async function failureStatusByCode(em: EntityManager): Promise<Map<string, string>> {
  const rows = await em.execute<{ code: string; status_on_failure: string }[]>(
    'select "code", "status_on_failure" from "payment_methods" order by "code" asc',
  );
  return new Map(rows.map((row) => [row.code, row.status_on_failure]));
}

/**
 * The methods whose failure status is a **terminal** order status — the actual
 * invariant. `cancelled` is the one that shipped, but `completed` is terminal
 * too and any operator-defined status can be, so this is read off
 * `order_statuses.is_terminal` rather than off a literal.
 */
async function methodsFailingIntoATerminalStatus(
  em: EntityManager,
): Promise<{ code: string; status_on_failure: string }[]> {
  return em.execute<{ code: string; status_on_failure: string }[]>(`
    select "payment_methods"."code", "payment_methods"."status_on_failure"
    from "payment_methods"
    join "order_statuses" on "order_statuses"."code" = "payment_methods"."status_on_failure"
    where "order_statuses"."is_terminal" = true
    order by "payment_methods"."code" asc
  `);
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

  it('leaves no payment method whose failed payment ends the order', async () => {
    // Not vacuous, two ways: the gateway seeds are the rows a fresh install
    // has, and a table this file found empty would pass the assertion below
    // while proving nothing; and the join is only sound if every
    // `status_on_failure` names a status that exists, or a bad value would be
    // dropped by the join rather than reported.
    const byCode = await failureStatusByCode(db.em());
    for (const code of SEEDED_GATEWAY_CODES) {
      expect(byCode.get(code), `${code} is missing from the migrated database`).toBeDefined();
    }
    const known = new Set(
      (await db.em().execute<{ code: string }[]>('select "code" from "order_statuses"')).map(
        (row) => row.code,
      ),
    );
    const dangling = [...byCode].filter(([, status]) => !known.has(status));
    expect(dangling, 'a payment method names an order status that does not exist').toEqual([]);

    expect(
      await methodsFailingIntoATerminalStatus(db.em()),
      'A freshly migrated platform still has payment methods whose failure status is ' +
        'terminal. A terminal status cannot be left, so the buyer cannot pay again.',
    ).toEqual([]);
  });

  it('holds every seeded gateway method at the on-hold failure status', async () => {
    const byCode = await failureStatusByCode(db.em());
    for (const code of SEEDED_GATEWAY_CODES) {
      expect(byCode.get(code), code).toBe('on_hold');
    }
  });

  /**
   * The ordering trap, asserted where it bites: a gateway's normalisation must
   * sit after that gateway's seed in the order feature 081 computes, or a fresh
   * database ends with the seeded value whatever the SQL says.
   *
   * The gateway set is **derived** from the configured order rather than
   * listed. A gateway that ships no normalisation at all is not a violation
   * here — seeding a non-terminal status directly is the better answer and
   * needs no second file — and it is the first test above that catches one
   * which seeds a terminal status and forgets.
   */
  it('runs each gateway normalisation after that gateway`s own seed', () => {
    const names = configuredOrder();
    const seeds = positionsBySegment(names, SEED_CLASS_RE);
    const normalisations = positionsBySegment(names, NORMALISATION_CLASS_RE);

    expect(seeds.size, 'no module seeds payment methods — the derivation found nothing').toBeGreaterThan(0);

    for (const [segment, seedAt] of seeds) {
      const normaliseAt = normalisations.get(segment);
      if (normaliseAt === undefined) continue;
      expect(
        normaliseAt,
        `${segment} normalises at ${normaliseAt} but seeds at ${seedAt} — on a fresh ` +
          `database it normalises nothing and the seed stands`,
      ).toBeGreaterThan(seedAt);
    }

    // And the trap itself: the `payment_methods` normalisation is before every
    // seed, which is why it cannot be the only one.
    const base = normalisations.get('PaymentMethods');
    expect(base, 'the payment_methods normalisation is not in the configured order').toBeDefined();
    for (const [segment, seedAt] of seeds) {
      expect(base!, `payment_methods normalises after ${segment} seeds`).toBeLessThan(seedAt);
    }
  });

  /**
   * `SEEDED_GATEWAY_CODES` and `NORMALISATIONS` above are hand-written and are
   * the non-vacuity floor for the first two tests — a gateway missing from them
   * is a gateway those tests say nothing about, which is exactly how PayPal
   * arrived. Neither can be derived (a code is inside SQL text, a class is an
   * import), so this test is what stops them going stale in silence: every
   * module the configured order shows seeding payment methods must appear in
   * both.
   */
  it('keeps its own lists covering every module that seeds a payment method', () => {
    const seeds = positionsBySegment(configuredOrder(), SEED_CLASS_RE);
    const moduleIds = [...seeds.keys()].map((segment) =>
      segment.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase(),
    );
    expect(moduleIds.length).toBeGreaterThan(0);

    const listed = new Set(NORMALISATIONS.map(([owner]) => owner));
    for (const moduleId of moduleIds) {
      expect(
        listed.has(moduleId),
        `${moduleId} seeds payment methods but has no entry in NORMALISATIONS — the ` +
          `idempotence and reach tests below say nothing about it`,
      ).toBe(true);
      expect(
        SEEDED_GATEWAY_CODES.some((code) => code.startsWith(`${moduleId}_`)),
        `${moduleId} seeds payment methods but contributes no code to ` +
          `SEEDED_GATEWAY_CODES — the tests above say nothing about its rows`,
      ).toBe(true);
    }
  });

  it('changes nothing when its migrations run a second time', async () => {
    const before = await failureStatusByCode(db.em());
    for (const [, ctor] of NORMALISATIONS) await replay(db, ctor);
    expect(await failureStatusByCode(db.em())).toEqual(before);
  });

  /**
   * The other direction of the same fact: put every row back to `'cancelled'`
   * and run only the **gateway** normalisations. Each must reach its own rows —
   * that is what a fresh database depends on, since `payment_methods` has
   * already run by the time the gateways seed.
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
