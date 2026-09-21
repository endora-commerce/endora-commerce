import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * Feature 085 (FR-005 / SC-003) — no payment method a freshly installed platform
 * ships cancels an order on a failed payment.
 *
 * ### This file's subject moved, and the move is the point
 *
 * It used to read a **migrated** database: every gateway seeded its
 * `payment_methods` rows from its own migration with
 * `status_on_failure = 'cancelled'`, a `payment_methods` normalisation ran
 * *before* all of them because feature 081 orders migrations along the manifest
 * graph, and each gateway therefore shipped a second migration after its own seed
 * to undo the value. The ordering trap that made those six files necessary, and
 * the derivations this file grew to stop a seventh gateway arriving un-covered,
 * are in the history of this file at `d0bb67435`.
 *
 * **Feature 134's FR-064 dissolved all of it**
 * (`specs/134-paid-module-extraction/contracts/foreign-write-repair.md` §4). The
 * seeds are install hooks now and go through
 * `PaymentMethodReconciler.ensureMethodForAdapter`, whose `statusOnFailure`
 * default has been `'on_hold'` since feature 085 — so a fresh install cannot
 * produce `'cancelled'`, the five `*_failure_status_on_hold` migrations have no
 * subject, and their bodies are empty. A migrated database now holds **no**
 * gateway rows at all, which is why reading one would be the "found nothing and
 * read nothing print the same green" failure rather than a passing test.
 *
 * ### So the subject is the install hooks, and it is still derived
 *
 * The population is every module in the generated manifest index that declares
 * `payment_methods` in its `dependencies` **and** exports an `installHook`. That
 * is the set of modules that can write a `payment_methods` row at install, read
 * off the registry the platform actually composes from — so a sixth gateway is
 * covered the day it is added, without anybody editing a list. PayPal arrived
 * exactly that way and was un-covered for a release.
 *
 * `setupTestDb` rather than `setupMigratorTestDb`: the rows are written by this
 * file, inside a transaction that is rolled back, so there is nothing to clone a
 * template for.
 */

/** A module that can seed a `payment_methods` row at install time. */
interface SeedingModule {
  readonly id: string;
  readonly installHook: NonNullable<(typeof DISCOVERED_MANIFESTS)[number]['installHook']>;
}

function seedingModules(): SeedingModule[] {
  return DISCOVERED_MANIFESTS.flatMap((entry) => {
    if (!entry.installHook) return [];
    if (!(entry.manifest.dependencies ?? []).includes('payment_methods')) return [];
    return [{ id: entry.id, installHook: entry.installHook }];
  });
}

const NO_OP_LOG = { info: () => {}, warn: () => {}, error: () => {} };

async function failureStatusByCode(em: EntityManager): Promise<Map<string, string>> {
  const rows = await em.execute<{ code: string; status_on_failure: string }[]>(
    'select "code", "status_on_failure" from "payment_methods" order by "code" asc',
  );
  return new Map(rows.map((row) => [row.code, row.status_on_failure]));
}

/**
 * The methods whose failure status is a **terminal** order status — the actual
 * invariant. `cancelled` is the one that shipped, but `completed` is terminal too
 * and any operator-defined status can be, so this is read off
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

describe('shipped status_on_failure default [integration]', () => {
  let db: TestDb;
  let modules: SeedingModule[];

  beforeAll(async () => {
    db = await setupTestDb();
    modules = seedingModules();
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  /** Every install hook that can seed a payment method, run over one transaction. */
  async function runEverySeed(): Promise<void> {
    for (const module of modules) {
      await module.installHook({
        em: db.em(),
        redis: undefined,
        log: NO_OP_LOG,
        module: { id: module.id, version: '0.0.0-test' },
      });
    }
  }

  it('has a non-empty population of seeding modules', () => {
    // The non-vacuity floor. With no seeding module the two assertions below are
    // statements about nothing, and "read nothing" would print the same green as
    // "found nothing" — the failure this file's previous shape was rewritten to
    // avoid and then, at FR-064, inherited in a new form.
    expect(
      modules.map((m) => m.id),
      'no module in the manifest index both depends on payment_methods and exports an ' +
        'installHook — the derivation found nothing and every assertion below is vacuous',
    ).not.toEqual([]);
  });

  it('leaves no payment method whose failed payment ends the order', async () => {
    await runEverySeed();

    // The join is only sound if every `status_on_failure` names a status that
    // exists, or a bad value would be dropped by the join rather than reported.
    const byCode = await failureStatusByCode(db.em());
    const known = new Set(
      (await db.em().execute<{ code: string }[]>('select "code" from "order_statuses"')).map(
        (row) => row.code,
      ),
    );
    const dangling = [...byCode].filter(([, status]) => !known.has(status));
    expect(dangling, 'a payment method names an order status that does not exist').toEqual([]);

    expect(
      await methodsFailingIntoATerminalStatus(db.em()),
      'A freshly installed platform still has payment methods whose failure status is ' +
        'terminal. A terminal status cannot be left, so the buyer cannot pay again.',
    ).toEqual([]);
  }, 120_000);

  it('holds every row a seeding module writes at the on-hold failure status', async () => {
    const before = new Set((await failureStatusByCode(db.em())).keys());
    await runEverySeed();
    const after = await failureStatusByCode(db.em());

    const seeded = [...after].filter(([code]) => !before.has(code));
    // Each seeding module writes at least one row, or the assertion below is a
    // statement about an empty list.
    expect(seeded.length, 'the seeding modules wrote no rows').toBeGreaterThanOrEqual(
      modules.length,
    );
    for (const [code, status] of seeded) expect(status, code).toBe('on_hold');
  }, 120_000);

  it('changes nothing when every seed runs a second time', async () => {
    await runEverySeed();
    const before = await failureStatusByCode(db.em());
    await runEverySeed();
    expect(await failureStatusByCode(db.em())).toEqual(before);
  }, 120_000);
});
