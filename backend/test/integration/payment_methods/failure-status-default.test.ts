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
 *
 * ### Every assertion is scoped to the rows the seeds wrote, and that is not a weakening
 *
 * The previous shape read the **whole** `payment_methods` table, which was sound
 * only because its fixture was a pristine clone of the migrated template. On the
 * shared harness database the table also holds whatever earlier files in the
 * invocation left there — measured: a `bank_transfer` row at a terminal failure
 * status, written by another file and correctly none of this file's business. The
 * subject is *what a fresh install ships*, so the population is the codes that
 * were not there before `runEverySeed()` and are after it, and a floor below
 * refuses a run in which that set is empty.
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
 * The **terminal** order statuses — the actual invariant. `cancelled` is the one
 * that shipped, but `completed` is terminal too and any operator-defined status
 * can be, so this is read off `order_statuses.is_terminal` rather than off a
 * literal.
 */
async function terminalStatusCodes(em: EntityManager): Promise<Set<string>> {
  const rows = await em.execute<{ code: string }[]>(
    'select "code" from "order_statuses" where "is_terminal" = true',
  );
  return new Set(rows.map((row) => row.code));
}

async function knownStatusCodes(em: EntityManager): Promise<Set<string>> {
  const rows = await em.execute<{ code: string }[]>('select "code" from "order_statuses"');
  return new Set(rows.map((row) => row.code));
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

  /**
   * The rows a fresh install would hold, isolated from whatever else is in the
   * shared table: the codes that were absent before every seed hook ran and
   * present after.
   */
  async function seedAndCollect(): Promise<Map<string, string>> {
    const before = new Set((await failureStatusByCode(db.em())).keys());
    await runEverySeed();
    const after = await failureStatusByCode(db.em());
    return new Map([...after].filter(([code]) => !before.has(code)));
  }

  it('has a non-empty population of seeding modules', () => {
    // The non-vacuity floor. With no seeding module the assertions below are
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
    const seeded = await seedAndCollect();
    // Each seeding module writes at least one row, or the assertions are about an
    // empty set.
    expect(seeded.size, 'the seeding modules wrote no rows').toBeGreaterThanOrEqual(
      modules.length,
    );

    // The terminal check is only sound if every `status_on_failure` names a status
    // that exists, or a bad value would be missed rather than reported.
    const known = await knownStatusCodes(db.em());
    const dangling = [...seeded].filter(([, status]) => !known.has(status));
    expect(dangling, 'a seeded payment method names an order status that does not exist').toEqual(
      [],
    );

    const terminal = await terminalStatusCodes(db.em());
    expect(
      [...seeded].filter(([, status]) => terminal.has(status)),
      'A freshly installed platform still has payment methods whose failure status is ' +
        'terminal. A terminal status cannot be left, so the buyer cannot pay again.',
    ).toEqual([]);
  }, 120_000);

  it('holds every row a seeding module writes at the on-hold failure status', async () => {
    // Stronger than the terminal check above and the reason the five
    // `*_failure_status_on_hold` migrations retire: not merely "not terminal", but
    // the exact value the correction used to write.
    const seeded = await seedAndCollect();
    expect(seeded.size).toBeGreaterThanOrEqual(modules.length);
    for (const [code, status] of seeded) expect(status, code).toBe('on_hold');
  }, 120_000);

  it('changes nothing when every seed runs a second time', async () => {
    await runEverySeed();
    const before = await failureStatusByCode(db.em());
    await runEverySeed();
    expect(await failureStatusByCode(db.em())).toEqual(before);
  }, 120_000);
});
