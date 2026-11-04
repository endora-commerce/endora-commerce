import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  Migration20261103T190132CustomerAccountsOrganizationRoleAssignment,
  Migration20261104T094540CustomerAccountsDropLegacyRoleColumn,
} from '@endora-commerce/mod-customer-accounts/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Migration **M3** — `customer_accounts.organization_role_id`
 * (`specs/170-organization-roles/` WP-02b, T040; `contracts/migration-and-replay.md`
 * §3; data-model §2; research R-19, R-23, R-28, R-34; owner rulings PR-2, PR-3;
 * FR-006, FR-070, FR-074).
 *
 * Executed, not described: the statements come from the migration class, the
 * rows are written in raw SQL in the shape the code could write before this
 * feature, and every case runs inside a transaction that is rolled back, so the
 * shared database never sees a dropped column.
 *
 * The test database is already migrated, so "before M3" is reached by running
 * `down()` first — which is also how the replay (R-27) reaches the old schema.
 * Since WP-12 the migrated schema is also past **M5**, which drops the legacy
 * `role` M3 reads and redefines its default; every case therefore starts from
 * M5's `down()`, the state M3 left (`contracts/migration-and-replay.md` §6
 * step 2 runs them in the same order).
 */
describe('M3 — customer_accounts.organization_role_id', () => {
  let db: TestDb;
  let em: EntityManager;

  function migration(): Migration20261103T190132CustomerAccountsOrganizationRoleAssignment {
    return new Migration20261103T190132CustomerAccountsOrganizationRoleAssignment(em.getDriver(), em.config);
  }

  async function apply(direction: 'up' | 'down'): Promise<void> {
    const m = migration();
    await m[direction]();
    for (const query of m.getQueries()) await em.execute(query as string);
  }

  async function insertOrganization(options: { isPersonal?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal",
          "created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, ?, now(), now())`,
      [
        id,
        `Assignment ${id.slice(0, 8)}`,
        `${options.isPersonal ? 'personal' : 'assign'}-${id.slice(0, 13)}`,
        `/${id}/`,
        options.isPersonal ?? false,
      ],
    );
    return id;
  }

  /** An account as the code before this feature wrote one: a legacy `role`, no role reference. */
  async function insertAccount(
    organizationId: string,
    role: 'organization_admin' | 'regular_user',
    state: 'active' | 'blocked' | 'deleted' = 'active',
  ): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","role",
          "blocked_at","deleted_at","created_at","updated_at")
       values (?, ?, ?, 'hash', 'Role', 'Assignment', ?, ?, ?, now(), now())`,
      [
        id,
        organizationId,
        `${id.slice(0, 8)}@role-assignment.example`,
        role,
        state === 'blocked' ? new Date() : null,
        state === 'deleted' ? new Date() : null,
      ],
    );
    return id;
  }

  async function roleIdOf(organizationId: string, kind: 'administrator' | 'member'): Promise<string> {
    const rows = (await em.execute(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = ?`,
      [organizationId, kind],
    )) as Array<{ id: string }>;
    return rows[0]!.id;
  }

  async function heldKind(customerAccountId: string): Promise<string | null> {
    const rows = (await em.execute(
      `select r."kind" from "customer_accounts" a
         join "organization_roles" r on r."id" = a."organization_role_id"
                                    and r."organization_id" = a."organization_id"
        where a."id" = ?`,
      [customerAccountId],
    )) as Array<{ kind: string }>;
    return rows[0]?.kind ?? null;
  }

  async function legacyRole(customerAccountId: string): Promise<string> {
    const rows = (await em.execute(`select "role" from "customer_accounts" where "id" = ?`, [
      customerAccountId,
    ])) as Array<{ role: string }>;
    return rows[0]!.role;
  }

  async function schemaShape(): Promise<unknown> {
    const columns = await em.execute(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'customer_accounts' order by column_name`,
    );
    const constraints = await em.execute(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = (select oid from pg_class where relname = 'customer_accounts')
        order by conname`,
    );
    const indexes = await em.execute(
      `select indexname, indexdef from pg_indexes where tablename = 'customer_accounts' order by indexname`,
    );
    const triggers = await em.execute(
      `select tgname from pg_trigger where not tgisinternal
          and tgname = 'customer_accounts_default_organization_role'`,
    );
    const functions = await em.execute(
      `select proname from pg_proc where proname = 'customer_accounts_default_organization_role'`,
    );
    return { columns, constraints, indexes, triggers, functions };
  }

  /** Runs `statement` under a savepoint and answers the error it raised, if any. */
  async function refusal(statement: string, params: unknown[] = []): Promise<string | null> {
    await em.execute('savepoint "m3_probe"');
    try {
      await em.execute(statement, params);
      await em.execute('release savepoint "m3_probe"');
      return null;
    } catch (err) {
      await em.execute('rollback to savepoint "m3_probe"');
      return err instanceof Error ? err.message : String(err);
    }
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    const m5 = new Migration20261104T094540CustomerAccountsDropLegacyRoleColumn(em.getDriver(), em.config);
    await m5.down();
    for (const query of m5.getQueries()) await em.execute(query as string);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  describe('after the upgrade, by construction (R-28, PR-2, PR-3)', () => {
    it('fills an account inserted without a role: from the legacy role in a company, Administrator in a personal Organization', async () => {
      const company = await insertOrganization();
      const personal = await insertOrganization({ isPersonal: true });
      const admin = await insertAccount(company, 'organization_admin');
      const regular = await insertAccount(company, 'regular_user');
      const individual = await insertAccount(personal, 'regular_user');
      expect(await heldKind(admin)).toBe('administrator');
      expect(await heldKind(regular)).toBe('member');
      expect(await heldKind(individual)).toBe('administrator');
      // The legacy column is the default trigger's input, never its output.
      expect(await legacyRole(individual)).toBe('regular_user');
    });

    it('keeps a role reference the insert names', async () => {
      const company = await insertOrganization();
      const member = await roleIdOf(company, 'member');
      const id = randomUUID();
      await em.execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","role",
            "organization_role_id","created_at","updated_at")
         values (?, ?, ?, 'hash', 'A', 'B', 'organization_admin', ?, now(), now())`,
        [id, company, `${id.slice(0, 8)}@role-assignment.example`, member],
      );
      expect(await heldKind(id)).toBe('member');
    });

    it("refuses an account that points at another Organization's role (composite FK, FR-005)", async () => {
      const a = await insertOrganization();
      const b = await insertOrganization();
      const account = await insertAccount(a, 'regular_user');
      expect(
        await refusal(`update "customer_accounts" set "organization_role_id" = ? where "id" = ?`, [
          await roleIdOf(b, 'member'),
          account,
        ]),
      ).toMatch(/customer_accounts_organization_role_fk/);
    });

    it('refuses deleting a role an account still holds — a deleted account included (FR-024)', async () => {
      const org = await insertOrganization();
      const custom = randomUUID();
      await em.execute(
        `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
         values (?, ?, 'custom', 'Held', 'held')`,
        [custom, org],
      );
      const account = await insertAccount(org, 'regular_user', 'deleted');
      await em.execute(`update "customer_accounts" set "organization_role_id" = ? where "id" = ?`, [
        custom,
        account,
      ]);
      expect(await refusal(`delete from "organization_roles" where "id" = ?`, [custom])).toMatch(
        /customer_accounts_organization_role_fk/,
      );
    });

    it('makes the role reference not null', async () => {
      const company = await insertOrganization();
      const account = await insertAccount(company, 'regular_user');
      expect(
        await refusal(`update "customer_accounts" set "organization_role_id" = null where "id" = ?`, [account]),
      ).not.toBeNull();
    });
  });

  describe('the upgrade of an existing database (FR-070, FR-074, PR-3)', () => {
    it('maps every account — blocked and deleted included — and every personal account to Administrator, leaving the legacy role alone', async () => {
      await apply('down');

      const company = await insertOrganization();
      const personal = await insertOrganization({ isPersonal: true });
      const expected: Array<{ id: string; kind: string; legacy: string }> = [];
      for (const state of ['active', 'blocked', 'deleted'] as const) {
        expected.push({ id: await insertAccount(company, 'organization_admin', state), kind: 'administrator', legacy: 'organization_admin' });
        expected.push({ id: await insertAccount(company, 'regular_user', state), kind: 'member', legacy: 'regular_user' });
      }
      // A personal Organization's account is its Administrator whatever its legacy role (PR-3).
      expected.push({ id: await insertAccount(personal, 'regular_user'), kind: 'administrator', legacy: 'regular_user' });

      await apply('up');

      for (const account of expected) {
        expect(await heldKind(account.id)).toBe(account.kind);
        expect(await legacyRole(account.id)).toBe(account.legacy);
      }
      const nullable = (await em.execute(
        `select is_nullable from information_schema.columns
          where table_name = 'customer_accounts' and column_name = 'organization_role_id'`,
      )) as Array<{ is_nullable: string }>;
      expect(nullable).toEqual([{ is_nullable: 'NO' }]);

      // FR-074 — a second `up()` changes nothing.
      const snapshot = async () => ({
        accounts: await em.execute(
          `select "id","organization_role_id","role" from "customer_accounts"
            where "organization_id" in (?, ?) order by "id"`,
          [company, personal],
        ),
        schema: await schemaShape(),
      });
      const first = await snapshot();
      await apply('up');
      expect(await snapshot()).toEqual(first);
    });

    it('down() restores the schema exactly, and up() after it rebuilds it', async () => {
      const upgraded = await schemaShape();
      await apply('down');
      const downgraded = (await schemaShape()) as {
        columns: Array<{ column_name: string }>;
        constraints: Array<{ conname: string }>;
        triggers: unknown[];
        functions: unknown[];
      };
      expect(downgraded.columns.map((c) => c.column_name)).not.toContain('organization_role_id');
      expect(downgraded.constraints.map((c) => c.conname)).not.toContain('customer_accounts_organization_role_fk');
      expect(downgraded.triggers).toEqual([]);
      expect(downgraded.functions).toEqual([]);
      await apply('up');
      expect(await schemaShape()).toEqual(upgraded);
    });
  });
});
