import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Collection, Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { CustomerScoped, GlobalEntity, OrgScoped, type TenantContext } from '@endora-commerce/platform/tenancy';
import { resolveTenantContext, systemTenantContext } from '@endora-commerce/platform/composition';
import {
  MissingTenantContextError,
  runWithTenantContext,
  runWithoutTenantContext,
} from '../../../src/tenancy/tenant-context.js';

/**
 * Issue #1860 (part of #1073). This pins, on MikroORM 6, which rows each tenant
 * scope mode lets through MikroORM's global filters, and it must stay green
 * after the move to MikroORM 7.
 *
 * The filters (`platform/src/tenancy/filters.ts`) are attached by the platform's
 * own decorators and read the ambient context when each query runs. The
 * `excluded-set` arm (#955, `excluded-predicate.ts`) is a `$nin` over a knex
 * query builder, and #1864 has to rewrite it without knex. The unit tests
 * (`excluded-set.test.ts`) pin how that arm is spelled, and that spelling is
 * what changes. This file pins which rows come back, which must not change:
 * one scratch table per tenant classification, the same rows in each, and every
 * mode against every table through `find`, `count`, `nativeUpdate`, a joined
 * `populate` and `Collection.init`.
 *
 * The four arms of the filters are `all` / `system` (one arm, no predicate),
 * `single-org`, `allowed-set` and `excluded-set`. No context at all fails
 * closed.
 *
 * Covered elsewhere and not repeated: the excluded-set predicate over the real
 * reach governor, `findAndCount` / `findByCursor` / forks / transactions and
 * MikroORM's raw-fragment cache
 * (`test/integration/organizations/reach-governor-maintenance.test.ts`); the
 * `allowed-set` arm on every real `@CustomerScoped` table
 * (`customer-scoped-allowed-set-predicate.test.ts`); writes refused at the
 * flush boundary (`org-scoped-write-refusal.test.ts`).
 */

const ORG = { A: randomUUID(), B: randomUUID(), C: randomUUID() } as const;
const CUSTOMER = { A: randomUUID(), B: randomUUID(), C: randomUUID(), none: randomUUID() } as const;
type Label = 'A' | 'B' | 'C' | 'none';
const LABELS: readonly Label[] = ['A', 'B', 'C', 'none'];
const orgOf = (label: Label): string | null => (label === 'none' ? null : ORG[label]);

@GlobalEntity()
@Entity({ tableName: 'x1860_holders' })
class X1860Holder {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @OneToMany(() => X1860OrgRow, (row) => row.holder)
  rows = new Collection<X1860OrgRow>(this);

  @OneToMany(() => X1860CustomerRow, (row) => row.holder)
  customers = new Collection<X1860CustomerRow>(this);
}

@OrgScoped()
@Entity({ tableName: 'x1860_org_rows' })
class X1860OrgRow {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Property({ type: 'text' })
  label!: Label;

  @Property({ type: 'boolean' })
  touched!: boolean;

  @ManyToOne(() => X1860Holder)
  holder!: X1860Holder;
}

/** `@CustomerScoped` with an organization column of its own, the state `Cart` is in. */
@CustomerScoped()
@Entity({ tableName: 'x1860_customer_org_rows' })
class X1860CustomerOrgRow {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Property({ type: 'text' })
  label!: Label;
}

/** `@CustomerScoped` with no organization column. */
@CustomerScoped()
@Entity({ tableName: 'x1860_customer_rows' })
class X1860CustomerRow {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'text' })
  label!: Label;

  @ManyToOne(() => X1860Holder)
  holder!: X1860Holder;
}

/** The owner's uncorrelated SELECT of excluded organizations, as `organizations` answers it. */
const excludedQuery = (rep: string) => ({ sql: 'select e."id" from "x1860_excluded" e where e."rep" = ?', params: [rep] });
const REP_EXCLUDING_B = 'rep-excluding-b';
const REP_EXCLUDING_NONE = 'rep-excluding-none';

const admin = { kind: 'admin', adminUserId: randomUUID() } as const;
const excluding = (rep: string): TenantContext =>
  resolveTenantContext(admin, {
    allowAll: false,
    reach: 'excluding',
    excludedOrganizationsQuery: excludedQuery(rep),
    loadReach: async () => ({ excludedOrganizationIds: [], assignedOrganizationIds: [] }),
  });

interface ModeCase {
  readonly name: string;
  readonly mode: TenantContext['mode'];
  readonly context: () => TenantContext;
  readonly org: readonly Label[];
  readonly customerOrg: readonly Label[];
  readonly customer: readonly Label[];
  /** Whether a `@CustomerScoped` table without an organization column was refused, and the context records it. */
  readonly refusedNotice?: boolean;
  /**
   * The holder's collections whose joined `populate` MikroORM 6 cannot render
   * for this case: the filter answers `$in: []`, which lands in the join
   * condition as `in ()`, a syntax error. Asserted as `it.fails` below, to be
   * fixed with #1866.
   */
  readonly joinedPopulateOpen?: readonly Collected[];
}

type Collected = 'rows' | 'customers';

const CASES: readonly ModeCase[] = [
  {
    name: 'a platform administrator',
    mode: 'all',
    context: () => resolveTenantContext(admin, { allowAll: true }),
    org: LABELS,
    customerOrg: LABELS,
    customer: LABELS,
  },
  {
    name: 'the system scope',
    mode: 'system',
    context: () => systemTenantContext('test: #1860 filter modes'),
    org: LABELS,
    customerOrg: LABELS,
    customer: LABELS,
  },
  {
    name: "a customer of organization A, on the account's own rows",
    mode: 'single-org',
    context: () => resolveTenantContext({ kind: 'customer', customerAccountId: CUSTOMER.A, organizationId: ORG.A }),
    org: ['A'],
    customerOrg: ['A'],
    customer: ['A'],
  },
  {
    name: 'an administrator confined to A and B',
    mode: 'allowed-set',
    context: () => resolveTenantContext(admin, { allowAll: false, allowedOrganizationIds: [ORG.A, ORG.B] }),
    org: ['A', 'B'],
    customerOrg: ['A', 'B'],
    customer: [],
    refusedNotice: true,
    joinedPopulateOpen: ['customers'],
  },
  {
    name: 'an administrator confined to no organization',
    mode: 'allowed-set',
    context: () => resolveTenantContext(admin, { allowAll: false, allowedOrganizationIds: [] }),
    org: [],
    customerOrg: [],
    customer: [],
    refusedNotice: true,
    joinedPopulateOpen: ['rows', 'customers'],
  },
  {
    name: 'a representative whose reach excludes B',
    mode: 'excluded-set',
    context: () => excluding(REP_EXCLUDING_B),
    org: ['A', 'C'],
    customerOrg: ['A', 'C'],
    customer: [],
    refusedNotice: true,
    joinedPopulateOpen: ['customers'],
  },
  {
    // `null not in (<empty>)` is true: only the predicate's own `is not null`
    // keeps the row with no organization out.
    name: 'a representative from whom nothing is excluded',
    mode: 'excluded-set',
    context: () => excluding(REP_EXCLUDING_NONE),
    org: ['A', 'B', 'C'],
    customerOrg: ['A', 'B', 'C'],
    customer: [],
    refusedNotice: true,
    joinedPopulateOpen: ['customers'],
  },
];

describe('tenant filter modes on MikroORM (#1860)', () => {
  let orm: MikroORM;
  const holderId = randomUUID();

  const sql = (statement: string, params: unknown[] = []) => orm.em.getConnection().execute(statement, params);
  const labels = (rows: Iterable<{ label: Label }>): Label[] => [...rows].map((row) => row.label).sort();

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [X1860Holder, X1860OrgRow, X1860CustomerOrgRow, X1860CustomerRow],
      clientUrl: process.env['DATABASE_URL']!,
      allowGlobalContext: true,
    });
    await sql(`
      drop table if exists "x1860_org_rows", "x1860_customer_rows", "x1860_holders", "x1860_customer_org_rows", "x1860_excluded";
      create table "x1860_holders" ("id" uuid primary key);
      create table "x1860_org_rows" ("id" uuid primary key, "organization_id" uuid null, "label" text not null,
        "touched" boolean not null default false, "holder_id" uuid not null references "x1860_holders" ("id"));
      create table "x1860_customer_org_rows" ("id" uuid primary key, "customer_account_id" uuid not null,
        "organization_id" uuid null, "label" text not null);
      create table "x1860_customer_rows" ("id" uuid primary key, "customer_account_id" uuid not null, "label" text not null,
        "holder_id" uuid not null references "x1860_holders" ("id"));
      create table "x1860_excluded" ("rep" text not null, "id" uuid not null);`);
    await sql('insert into "x1860_holders" ("id") values (?)', [holderId]);
    for (const label of LABELS) {
      await sql(
        'insert into "x1860_org_rows" ("id", "organization_id", "label", "holder_id") values (gen_random_uuid(), ?, ?, ?)',
        [orgOf(label), label, holderId],
      );
      await sql(
        'insert into "x1860_customer_org_rows" ("id", "customer_account_id", "organization_id", "label") values (gen_random_uuid(), ?, ?, ?)',
        [CUSTOMER[label], orgOf(label), label],
      );
      await sql(
        'insert into "x1860_customer_rows" ("id", "customer_account_id", "label", "holder_id") values (gen_random_uuid(), ?, ?, ?)',
        [CUSTOMER[label], label, holderId],
      );
    }
    await sql('insert into "x1860_excluded" ("rep", "id") values (?, ?)', [REP_EXCLUDING_B, ORG.B]);
  });

  afterAll(async () => {
    await sql(
      'drop table if exists "x1860_org_rows", "x1860_customer_rows", "x1860_holders", "x1860_customer_org_rows", "x1860_excluded"',
    );
    await orm.close(true);
  });

  it.each(CASES)('$mode — $name: the rows each table lets through', async (c) => {
    const ctx = c.context();
    expect(ctx.mode).toBe(c.mode);
    await runWithTenantContext(ctx, async () => {
      expect(labels(await orm.em.fork().find(X1860OrgRow, {})), '@OrgScoped find').toEqual(c.org);
      expect(await orm.em.fork().count(X1860OrgRow, {}), '@OrgScoped count').toBe(c.org.length);
      expect(labels(await orm.em.fork().find(X1860CustomerOrgRow, {})), '@CustomerScoped with organization').toEqual(
        c.customerOrg,
      );
      expect(await orm.em.fork().count(X1860CustomerOrgRow, {})).toBe(c.customerOrg.length);
      expect(labels(await orm.em.fork().find(X1860CustomerRow, {})), '@CustomerScoped without organization').toEqual(
        c.customer,
      );
      expect(await orm.em.fork().count(X1860CustomerRow, {})).toBe(c.customer.length);
    });
    expect(ctx.notices?.organizationAttributionRefused ?? false).toBe(c.refusedNotice ?? false);
  });

  const expectedIn = (c: ModeCase, collection: Collected): readonly Label[] =>
    collection === 'rows' ? c.org : c.customer;

  async function joinedPopulate(c: ModeCase, collection: Collected): Promise<void> {
    await runWithTenantContext(c.context(), async () => {
      const joined = await orm.em.fork().findOneOrFail(X1860Holder, { id: holderId }, { populate: [collection] });
      expect(labels(joined[collection].getItems()), `joined populate of ${collection}`).toEqual(expectedIn(c, collection));
    });
  }

  it.each(CASES)('$mode — $name: joined and select-in populate, and Collection.init', async (c) => {
    for (const collection of ['rows', 'customers'] as const) {
      if (!(c.joinedPopulateOpen ?? []).includes(collection)) await joinedPopulate(c, collection);
      await runWithTenantContext(c.context(), async () => {
        const selectIn = await orm.em
          .fork()
          .findOneOrFail(X1860Holder, { id: holderId }, { populate: [collection], strategy: 'select-in' });
        expect(labels(selectIn[collection].getItems()), `select-in populate of ${collection}`).toEqual(
          expectedIn(c, collection),
        );
        const lazy = await orm.em.fork().findOneOrFail(X1860Holder, { id: holderId });
        await (lazy[collection] as Collection<X1860OrgRow | X1860CustomerRow>).init();
        expect(labels(lazy[collection].getItems()), `Collection.init of ${collection}`).toEqual(expectedIn(c, collection));
      });
    }
  });

  /**
   * Open (#1866): a joined `populate` whose filter answers `$in: []` renders
   * `in ()` in the join condition on MikroORM 6 and fails as a syntax error.
   * The shapes are an empty `allowed-set` on `@OrgScoped`, and `allowed-set` /
   * `excluded-set` on `@CustomerScoped` without an organization column. Each
   * case asserts the correct answer, so it fails today; when #1866 fixes it,
   * `it.fails` turns red and the case moves into the matrix above.
   */
  const OPEN_JOINED = CASES.flatMap((c) => (c.joinedPopulateOpen ?? []).map((collection) => ({ ...c, collection })));
  it.fails.each(OPEN_JOINED)('open (#1866): $mode — $name: joined populate of $collection', async (c) => {
    await joinedPopulate(c, c.collection);
  });

  it.each(CASES)('$mode — $name: nativeUpdate touches only the rows the mode lets through', async (c) => {
    await sql('update "x1860_org_rows" set "touched" = false');
    const updated = await runWithTenantContext(c.context(), () =>
      orm.em.fork().nativeUpdate(X1860OrgRow, { holder: holderId }, { touched: true }),
    );
    expect(updated).toBe(c.org.length);
    const touched = (await sql('select "label" from "x1860_org_rows" where "touched"')) as Array<{ label: Label }>;
    expect(labels(touched)).toEqual(c.org);
  });

  it('fails closed with no tenant context, on every scoped table', async () => {
    for (const entity of [X1860OrgRow, X1860CustomerOrgRow, X1860CustomerRow]) {
      const error = await runWithoutTenantContext(() => orm.em.fork().find(entity as typeof X1860OrgRow, {})).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error, entity.name).toBeInstanceOf(MissingTenantContextError);
    }
  });
});
