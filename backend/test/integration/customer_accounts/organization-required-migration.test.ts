import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Migration20260825T141659CustomerAccountsOrganizationRequired } from '../../../src/modules/customer_accounts/migrations/20260825T141659_customer_accounts_organization_required.js';

/**
 * D-178 — the tightening migration, executed rather than described.
 *
 * It replaces `test/integration/personal_organizations/backfill.test.ts`, which
 * exercised feature 051's one-shot backfill by seeding accounts with
 * `organization_id = NULL`. That fixture is unwritable now, which is the point
 * of the ruling; what is worth executing instead is this migration, and for the
 * same reason the old file gave: its interesting branches would otherwise ship
 * untested and be met for the first time on somebody's customer data.
 *
 * Three properties, and the third is the one the ruling insists on:
 *
 *  1. every account with no organisation is **provisioned** one, soft-deleted
 *     accounts included — feature 051's backfill excluded them with its own
 *     `and ca."deleted_at" is null`, and a soft-deleted row still has to satisfy
 *     the constraint;
 *  2. it is idempotent, because `tax_id` is derived from the account id, so an
 *     account whose personal organisation survived an earlier provisioning is
 *     re-linked rather than duplicated;
 *  3. a row it cannot provision makes it **raise**, and the row is still there
 *     afterwards. These are customer logins; a migration that deleted one to
 *     satisfy a constraint would be deleting a customer.
 *
 * The statements come off the shipped migration class rather than being copied
 * into this file, which is what the old test did and is how the copy and the
 * original come to disagree.
 */
describe('D-178 — customer_accounts.organization_id becomes NOT NULL', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
    // The migration has already run against the template, so the fixtures below
    // could not be written. Dropping the constraint inside this test's own
    // transaction reproduces the tree the migration meets; the rollback puts it
    // back.
    await em.execute('alter table "customer_accounts" alter column "organization_id" drop not null');
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function migrationQueries(): Promise<string[]> {
    const migration = new Migration20260825T141659CustomerAccountsOrganizationRequired(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    return migration.getQueries().map((q) => q as unknown as string);
  }

  async function runMigration(): Promise<void> {
    for (const query of await migrationQueries()) await em.execute(query);
    em.clear();
  }

  async function seedNullOrgAccount(
    over: { firstName?: string; lastName?: string; email?: string; deleted?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    const email = over.email ?? `d178-${id.slice(0, 8)}@ex.test`;
    await em.execute(
      `insert into "customer_accounts"
         ("id","email","password_hash","first_name","last_name","organization_id","deleted_at","created_at","updated_at")
       values (?, ?, ?, ?, ?, null, ${over.deleted === true ? 'now()' : 'null'}, now(), now())`,
      [id, email, 'x'.repeat(60), over.firstName ?? 'Jan', over.lastName ?? 'Kowalski'],
    );
    return id;
  }

  async function orgFor(
    accountId: string,
  ): Promise<Array<{ id: string; is_personal: boolean; status: string; name: string }>> {
    return (await em.execute(
      `select o."id", o."is_personal", o."status", o."name"
         from "customer_accounts" ca join "organizations" o on o."id" = ca."organization_id"
        where ca."id" = ?`,
      [accountId],
    )) as Array<{ id: string; is_personal: boolean; status: string; name: string }>;
  }

  it('provisions exactly one personal organisation per tenant-less account', async () => {
    const named = await seedNullOrgAccount({ firstName: 'Anna', lastName: 'Nowak' });
    const nameless = await seedNullOrgAccount({
      firstName: '',
      lastName: '',
      email: 'solo-d178@ex.test',
    });

    await runMigration();

    const first = await orgFor(named);
    const second = await orgFor(nameless);
    expect(first).toHaveLength(1);
    expect(first[0]!.is_personal).toBe(true);
    expect(first[0]!.status).toBe('active');
    expect(first[0]!.name).toBe('Anna Nowak');
    // Falls back to the e-mail local part when there is no name, exactly as
    // `PersonalOrganizationService.personalName` does.
    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe('solo-d178');
    // Distinct tenants — the isolation the whole ruling is about.
    expect(first[0]!.id).not.toBe(second[0]!.id);
  });

  it('provisions a soft-deleted account too, which feature 051 skipped', async () => {
    const deleted = await seedNullOrgAccount({ deleted: true, firstName: 'Gone', lastName: 'Away' });

    await runMigration();

    const rows = await orgFor(deleted);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_personal).toBe(true);
    // Still soft-deleted: the migration gives it a tenant and nothing else.
    const account = (await em.execute(
      'select "deleted_at" from "customer_accounts" where "id" = ?',
      [deleted],
    )) as Array<{ deleted_at: Date | null }>;
    expect(account[0]!.deleted_at).not.toBeNull();
  });

  it('re-links rather than duplicating when the personal organisation already exists', async () => {
    const id = await seedNullOrgAccount();
    // The state an un-assigned account was left in before D-178: its personal
    // organisation exists, and the account points at nothing.
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","created_at","updated_at")
       values (gen_random_uuid(), 'Jan Kowalski', replace(?::text, '-', ''), 'active', 'vat_exempt', true,
               '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::json, now(), now())`,
      [id],
    );

    await runMigration();

    const rows = await orgFor(id);
    expect(rows).toHaveLength(1);
    const duplicates = (await em.execute(
      `select count(*)::int as n from "organizations" where "tax_id" = replace(?::text, '-', '')`,
      [id],
    )) as Array<{ n: number }>;
    expect(duplicates[0]!.n).toBe(1);
  });

  it('applies the NOT NULL constraint, so a tenant-less insert is refused afterwards', async () => {
    await runMigration();

    await expect(
      em.execute(
        `insert into "customer_accounts" ("id","email","password_hash","first_name","last_name","organization_id","created_at","updated_at")
         values (gen_random_uuid(), ?, ?, 'After', 'Constraint', null, now(), now())`,
        [`after-${Date.now()}@ex.test`, 'x'.repeat(60)],
      ),
    ).rejects.toThrow(/not-null|not null/i);
  });

  it('raises — and deletes nothing — when a row it cannot provision is left', async () => {
    const stranded = await seedNullOrgAccount({ firstName: 'Cannot', lastName: 'Provision' });
    // The one way a row survives both provisioning statements: a **company**
    // organisation already holds the `tax_id` the personal one would be derived
    // from. `organizations.tax_id` is globally unique, so the insert cannot
    // create it, and the link is narrowed to `is_personal` so the account is not
    // quietly moved into that company's tenant instead. It is a pathological
    // case — a real tax id is not 32 hex characters — and it is the case the
    // refusal is written for.
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","created_at","updated_at")
       values (gen_random_uuid(), 'Collides Sp. z o.o.', replace(?::text, '-', ''), 'active', 'vat_payer', false,
               '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::json, now(), now())`,
      [stranded],
    );

    // The savepoint is what makes the second half observable: the raise aborts
    // its own transaction, not the enclosing one.
    await expect(
      em.transactional(async (tem) => {
        for (const query of await migrationQueries()) await tem.execute(query);
      }),
    ).rejects.toThrow(/D-178: 1 customer_accounts row/);

    // The row is still there. These are customer logins, and a migration that
    // deleted one to satisfy a constraint would be deleting a customer.
    const survivors = (await em.execute(
      'select "organization_id" from "customer_accounts" where "id" = ?',
      [stranded],
    )) as Array<{ organization_id: string | null }>;
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.organization_id).toBeNull();
    // And the constraint was not applied, because step 3 refused before step 4.
    const nullable = (await em.execute(
      `select is_nullable from information_schema.columns
        where table_name = 'customer_accounts' and column_name = 'organization_id'`,
    )) as Array<{ is_nullable: string }>;
    expect(nullable[0]!.is_nullable).toBe('YES');
  });
});
