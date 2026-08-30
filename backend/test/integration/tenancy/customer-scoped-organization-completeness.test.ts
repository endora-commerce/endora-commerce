import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { MikroORM } from '@mikro-orm/core';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';
import { CUSTOMER_ORGANIZATION_KEY, CUSTOMER_TENANT_KEY } from '../../../src/tenancy/filters.js';

/**
 * Every `@CustomerScoped` table that carries an organization column refuses an
 * owned row that has none — in the database, not in a service (feature 087,
 * ruling D-187).
 *
 * ## Why this file exists rather than a rule each author remembers
 *
 * `customerOrganizationColumn` (`platform/src/tenancy/org-scoped.decorator.ts`)
 * reads the ORM's own metadata per query, so **adding the entity property is
 * what turns the granting arm on**, in the same commit. And
 * `scoped-empty-notice.md`'s "some results are hidden" disclosure is keyed on
 * that column's *absence*, so it stops being emitted at the same instant. From
 * that instant a signed-in buyer's next insert is the whole failure: MikroORM
 * applies no filter to `INSERT` (`r1-spike.md` §4, measured), so a row written
 * with an account and no organisation is invisible to the representative who
 * serves that organisation, on a screen that has just stopped explaining
 * itself. It is silent, it compounds with every write, and no `check-*` script
 * can see it, because the subject is rows.
 *
 * The `CHECK` constraint is the only refusal an `INSERT` has. This file is what
 * makes it un-forgettable: Group A has ten more columns coming, and the merge
 * request that adds the eleventh will be written by somebody who has not read
 * this comment. It goes red on their class until that class carries the
 * constraint and the stamp.
 *
 * ## Derived, never listed
 *
 * The population is the intersection of the classification registry
 * (`tenantClassifications()`) and the ORM metadata store — the same two sources
 * the filter itself consults. A class is covered **by** gaining the column, so
 * there is no third artefact to keep in step and no list to go stale. That is
 * `group-a-refusal.md` §1's rule, applied to the guard rather than to the
 * filter.
 *
 * A derivation that can come back empty would make this file pass on a tree
 * where the metadata read is broken, which is the one way a guard like this
 * regresses in silence — AGENTS.md's "a green result must not be able to mean
 * *not looking*", applied to a test because no static walk can hold it. So the
 * emptiness of every input is refused **before** anything is computed from it,
 * and `describe.each` over an empty array would report a cheerful zero cases:
 * the population is asserted first, in its own case, and each per-class case
 * re-asserts that it was handed a class.
 *
 * ## Why the refusal is proved behaviourally, and how
 *
 * Reading `pg_constraint` for a name proves nothing: a constraint that exists
 * and does not bite is the failure being guarded against, and a name is a
 * convention a later author can honour while writing a predicate that permits
 * the row. So Postgres itself is asked.
 *
 * The probe is a **differential pair** against a temporary copy of the table
 * (`create temporary table … (like <t> including constraints including
 * defaults)`), inside a transaction that drops it on commit:
 *
 *  - the same insert, twice, differing only in `organization_id`;
 *  - the one without it must be **refused**, the one with it **admitted**.
 *
 * The pair is what makes the answer attributable — an unrelated constraint
 * refusing both would fail the control half, so a bare "the insert failed"
 * cannot be mistaken for this rule biting. `LIKE … INCLUDING CONSTRAINTS`
 * copies the real `CHECK` expressions and copies no foreign key, which is what
 * lets one probe serve every class present and future without a per-class
 * fixture — the property that decides whether this file still works when the
 * eleventh column lands. Its `NOT NULL` columns are relaxed on the copy alone,
 * from `pg_attribute`, so the probe reaches the check rather than stopping at a
 * column it was never about.
 */

/** One `@CustomerScoped` class that has acquired its organization column. */
interface CoveredClass {
  readonly className: string;
  readonly tableName: string;
  /** The database column behind `customerAccountId`, from the ORM's metadata. */
  readonly accountColumn: string;
  /** The database column behind `organizationId`, from the ORM's metadata. */
  readonly organizationColumn: string;
}

/** SQLSTATE 23514 — `check_violation`. */
const CHECK_VIOLATION = '23514';

/**
 * The first `code` on the error or anywhere in its `cause` chain.
 *
 * MikroORM wraps the driver's error, so the SQLSTATE is one or two hops down.
 * `undefined` when there is none, which the caller reports rather than treating
 * as agreement.
 */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let hop = 0; hop < 8 && current !== null && typeof current === 'object'; hop += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The `@CustomerScoped` classes whose ORM metadata carries the organization
 * column, with the table and column names the ORM itself resolved.
 *
 * Throws on an empty input rather than returning an empty result: an
 * unreadable registry and an unreadable metadata store are the two ways this
 * file could go quietly blind, and both have to be louder than a pass.
 */
function coveredClasses(orm: MikroORM): CoveredClass[] {
  const customerScoped = tenantClassifications().filter((meta) => meta.scope === 'customer');
  if (customerScoped.length === 0) {
    throw new Error(
      'The tenant classification registry holds no @CustomerScoped class. That is not a tree ' +
        'this platform can be in — it is an unreadable registry, and every assertion below ' +
        'would have passed vacuously over it.',
    );
  }

  const storage = orm.getMetadata();
  const covered: CoveredClass[] = [];
  const unknownToTheOrm: string[] = [];
  for (const meta of customerScoped) {
    const entity = storage.find(meta.className);
    if (!entity) {
      unknownToTheOrm.push(meta.className);
      continue;
    }
    const organization = entity.properties[CUSTOMER_ORGANIZATION_KEY];
    if (!organization) continue;
    const account = entity.properties[CUSTOMER_TENANT_KEY];
    if (!account) {
      throw new Error(
        `${meta.className} is @CustomerScoped and its metadata carries no ` +
          `'${CUSTOMER_TENANT_KEY}' property. The classification and the entity disagree.`,
      );
    }
    covered.push({
      className: meta.className,
      tableName: entity.tableName,
      accountColumn: account.fieldNames[0] as string,
      organizationColumn: organization.fieldNames[0] as string,
    });
  }

  if (unknownToTheOrm.length > 0) {
    throw new Error(
      `The ORM's metadata store does not know ${unknownToTheOrm.length} classified ` +
        `@CustomerScoped class(es): ${unknownToTheOrm.join(', ')}. Every classified entity in a ` +
        'composed platform is a configured one, so this is a metadata read that has stopped ' +
        'working rather than a population that has legitimately narrowed.',
    );
  }
  return covered;
}

/** What the differential probe observed, for one class. */
interface ProbeOutcome {
  /** The error the organisation-less insert raised, or `null` if it succeeded. */
  readonly refusal: unknown;
  /** Whether the otherwise-identical insert *with* an organisation succeeded. */
  readonly controlAdmitted: boolean;
  /** The control's own error, when it did not succeed. */
  readonly controlError: unknown;
}

async function probe(em: EntityManager, target: CoveredClass): Promise<ProbeOutcome> {
  return em.transactional(async (tem) => {
    // A per-run name, because two invocations share a database (one per run
    // since issue #189) and a temp table is per session, not per statement.
    const probeTable = `attribution_probe_${randomUUID().replace(/-/g, '')}`;

    await tem.execute(
      `create temporary table "${probeTable}" ` +
        `(like "${target.tableName}" including constraints including defaults) on commit drop`,
    );
    // Relax `NOT NULL` on the copy so the probe reaches the check it is about
    // rather than stopping at a column that has nothing to do with it. The
    // copy only: the real table is not touched by anything in this function.
    await tem.execute(`
      do $$
      declare column_record record;
      begin
        for column_record in
          select attribute."attname"
            from "pg_attribute" attribute
           where attribute."attrelid" = '"${probeTable}"'::regclass
             and attribute."attnum" > 0
             and not attribute."attisdropped"
             and attribute."attnotnull"
        loop
          execute format(
            'alter table %I alter column %I drop not null',
            '${probeTable}', column_record."attname"
          );
        end loop;
      end $$;
    `);

    await tem.execute('savepoint owned_without_organization');
    let refusal: unknown = null;
    try {
      await tem.execute(
        `insert into "${probeTable}" ("${target.accountColumn}") values (gen_random_uuid())`,
      );
    } catch (error) {
      refusal = error;
    }
    await tem.execute('rollback to savepoint owned_without_organization');

    await tem.execute('savepoint owned_with_organization');
    let controlAdmitted = false;
    let controlError: unknown = null;
    try {
      await tem.execute(
        `insert into "${probeTable}" ("${target.accountColumn}", "${target.organizationColumn}") ` +
          `values (gen_random_uuid(), gen_random_uuid())`,
      );
      controlAdmitted = true;
    } catch (error) {
      controlError = error;
      await tem.execute('rollback to savepoint owned_with_organization');
    }

    return { refusal, controlAdmitted, controlError };
  });
}

describe('every @CustomerScoped table with an organization column enforces the attribution', () => {
  let h: BackendServerHandle;
  let covered: CoveredClass[];

  beforeAll(async () => {
    h = await setupBackendServer();
    covered = coveredClasses(h.orm);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('found at least one class to check', () => {
    // The first assertion, and the load-bearing one. Everything below is
    // per class, so a derivation that came back empty would report a file
    // full of nothing and a green tick. `coveredClasses` already refuses an
    // unreadable registry and an unreadable metadata store; this refuses the
    // remaining shape — both readable, and their intersection empty — which is
    // the state the tree was in before D-187 and must never return to
    // unnoticed.
    expect(covered.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses an owned row with no organisation, and admits the same row with one', async () => {
    expect(covered.length).toBeGreaterThanOrEqual(1);
    for (const target of covered) {
      const outcome = await probe(h.em(), target);

      expect(
        outcome.controlAdmitted,
        `${target.className} (${target.tableName}): the control insert — an account **and** an ` +
          `organisation — was refused, so the probe cannot attribute the refusal below to the ` +
          `attribution rule. ${String(outcome.controlError)}`,
      ).toBe(true);

      expect(
        outcome.refusal,
        `${target.className} (${target.tableName}): the database accepted a row naming ` +
          `'${target.accountColumn}' with a null '${target.organizationColumn}'. That row is ` +
          `invisible to the organisation's own representative and nothing in the platform ` +
          `reports it. Add the CHECK constraint (D-187): check ("${target.accountColumn}" is ` +
          `null or "${target.organizationColumn}" is not null).`,
      ).not.toBeNull();

      expect(
        sqlStateOf(outcome.refusal),
        `${target.className} (${target.tableName}): the organisation-less insert was refused, ` +
          `but not by a check constraint. ${String(outcome.refusal)}`,
      ).toBe(CHECK_VIOLATION);
    }
  });

  it('holds no row that violates the attribution today', async () => {
    expect(covered.length).toBeGreaterThanOrEqual(1);
    const em = h.em();
    for (const target of covered) {
      const rows = (await em.execute(
        `select count(*)::int as violations from "${target.tableName}" ` +
          `where "${target.accountColumn}" is not null and "${target.organizationColumn}" is null`,
      )) as Array<{ violations: number }>;

      expect(
        rows[0]?.violations,
        `${target.className} (${target.tableName}): rows name an account and no organisation. ` +
          `Each of them is owned by somebody the platform cannot attribute, so it is hidden from ` +
          `that organisation's representative. Do not delete them (D-184) — derive the ` +
          `organisation from the account, and refuse whatever is left.`,
      ).toBe(0);
    }
  });
});
