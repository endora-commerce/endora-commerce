import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261104T094540CustomerAccountsDropLegacyRoleColumn } from '@endora-commerce/mod-customer-accounts/migrations';
import { Migration20261104T094535OrganizationsDropLegacyRoleColumns } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Migrations **M4** (`organizations`, `drop_legacy_role_columns`) and **M5**
 * (`customer_accounts`, `drop_legacy_role_column`) — `specs/170-organization-roles/`
 * WP-12, T105 (`contracts/migration-and-replay.md` §4; data-model §5; research
 * R-23, R-28; owner ruling PR-3; FR-073, FR-074).
 *
 * Executed, not described: the statements come from the migration classes, and
 * every case runs inside a transaction that is rolled back, so the shared
 * database never sees a re-added column.
 *
 * The test database is migrated, so it is the upgraded schema; "before M4/M5"
 * is reached by their `down()`s — M5's first, as the replay runs them (§6 step
 * 2). Each `down()` must re-derive the legacy value from the role reference
 * **exactly**, or the replay's round trip would not be one.
 */
describe('M4 and M5 — the legacy role columns are dropped', () => {
  let db: TestDb;
  let em: EntityManager;

  async function run(migration: { up(): Promise<void>; down(): Promise<void>; getQueries(): unknown[] }, direction: 'up' | 'down'): Promise<void> {
    await migration[direction]();
    for (const query of migration.getQueries()) await em.execute(String(query));
  }

  /** M5 then M4 down; M4 then M5 up — the module order (`organizations` before `customer_accounts`). */
  async function apply(direction: 'up' | 'down'): Promise<void> {
    const m4 = new Migration20261104T094535OrganizationsDropLegacyRoleColumns(em.getDriver(), em.config);
    const m5 = new Migration20261104T094540CustomerAccountsDropLegacyRoleColumn(em.getDriver(), em.config);
    for (const migration of direction === 'down' ? [m5, m4] : [m4, m5]) await run(migration, direction);
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
        `Legacy drop ${id.slice(0, 8)}`,
        `${options.isPersonal ? 'personal' : 'legacy'}-${id.slice(0, 13)}`,
        `/${id}/`,
        options.isPersonal ?? false,
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

  async function insertCustomRole(organizationId: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
       values (?, ?, 'custom', 'Buyer', 'buyer')`,
      [id, organizationId],
    );
    return id;
  }

  /** An account as the upgraded code writes one: a role reference and nothing else. */
  async function insertAccount(organizationId: string, organizationRoleId: string | null): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name",
          "organization_role_id","created_at","updated_at")
       values (?, ?, ?, 'hash', 'Legacy', 'Drop', ?, now(), now())`,
      [id, organizationId, `${id.slice(0, 8)}@legacy-drop.example`, organizationRoleId],
    );
    return id;
  }

  async function insertInvitation(organizationId: string, organizationRoleId: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organization_invitations"
         ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
       values (?, ?, ?, ?, ?, now() + interval '7 days', now(), now())`,
      [id, organizationId, `${id.slice(0, 8)}@legacy-drop.example`, organizationRoleId, `hash-${id}`],
    );
    return id;
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

  /** `(?, ?, …)` for an `in` list — the driver expands an array parameter into a bare list. */
  const placeholders = (values: readonly unknown[]): string => `(${values.map(() => '?').join(', ')})`;

  async function columnsOf(table: string, column: string): Promise<unknown[]> {
    return em.execute(
      `select column_name, data_type, character_maximum_length, is_nullable, column_default
         from information_schema.columns where table_name = ? and column_name = ?`,
      [table, column],
    );
  }

  async function schemaShape(): Promise<unknown> {
    const tables = ['organizations', 'organization_invitations', 'customer_accounts'];
    return {
      columns: await em.execute(
        `select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
           from information_schema.columns where table_name in ${placeholders(tables)} order by table_name, column_name`,
        tables,
      ),
      indexes: await em.execute(
        `select tablename, indexname, indexdef from pg_indexes where tablename in ${placeholders(tables)} order by indexname`,
        tables,
      ),
      triggers: await em.execute(
        `select tgname, tgrelid::regclass::text as "table" from pg_trigger
          where not tgisinternal and tgname in
            ('organization_invitations_default_role', 'customer_accounts_default_organization_role')
          order by tgname`,
      ),
      functions: await em.execute(
        `select proname, pg_get_functiondef(oid) as def from pg_proc
          where proname in ('organization_invitations_default_role', 'customer_accounts_default_organization_role')
          order by proname`,
      ),
    };
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  describe('the upgraded schema (FR-073)', () => {
    it('has no legacy role column, no cart-approval flag and no trigger reading either', async () => {
      expect(await columnsOf('customer_accounts', 'role')).toEqual([]);
      expect(await columnsOf('organization_invitations', 'role')).toEqual([]);
      expect(await columnsOf('organizations', 'requires_cart_approval')).toEqual([]);
      const shape = (await schemaShape()) as {
        indexes: Array<{ indexname: string }>;
        triggers: Array<{ tgname: string }>;
        functions: Array<{ proname: string; def: string }>;
      };
      expect(shape.indexes.map((i) => i.indexname)).not.toContain('customer_accounts_role_index');
      expect(shape.triggers.map((t) => t.tgname)).toEqual(['customer_accounts_default_organization_role']);
      expect(shape.functions.map((f) => f.proname)).toEqual(['customer_accounts_default_organization_role']);
      expect(shape.functions[0]!.def).not.toMatch(/new\."?role"?\b/);
    });

    it('defaults an account inserted without a role to Member in a company, Administrator in a personal Organization (PR-3)', async () => {
      const company = await insertOrganization();
      const personal = await insertOrganization({ isPersonal: true });
      expect(await heldKind(await insertAccount(company, null))).toBe('member');
      expect(await heldKind(await insertAccount(personal, null))).toBe('administrator');
    });

    it('keeps a role reference the insert names', async () => {
      const company = await insertOrganization();
      expect(await heldKind(await insertAccount(company, await roleIdOf(company, 'administrator')))).toBe(
        'administrator',
      );
    });
  });

  describe('down() re-derives the legacy values from the role reference (§4)', () => {
    it('restores `role` on accounts and invitations: Administrator → organization_admin, anything else → regular_user', async () => {
      const company = await insertOrganization();
      const personal = await insertOrganization({ isPersonal: true });
      const custom = await insertCustomRole(company);
      const accounts = {
        admin: await insertAccount(company, await roleIdOf(company, 'administrator')),
        member: await insertAccount(company, await roleIdOf(company, 'member')),
        custom: await insertAccount(company, custom),
        personal: await insertAccount(personal, null),
      };
      const invitations = {
        admin: await insertInvitation(company, await roleIdOf(company, 'administrator')),
        member: await insertInvitation(company, await roleIdOf(company, 'member')),
        custom: await insertInvitation(company, custom),
      };

      await apply('down');

      const accountRoles = (await em.execute(
        `select "id", "role" from "customer_accounts" where "id" in ${placeholders(Object.values(accounts))}`,
        Object.values(accounts),
      )) as Array<{ id: string; role: string }>;
      const invitationRoles = (await em.execute(
        `select "id", "role" from "organization_invitations" where "id" in ${placeholders(Object.values(invitations))}`,
        Object.values(invitations),
      )) as Array<{ id: string; role: string }>;
      const byKey = <K extends string>(ids: Record<K, string>, rows: Array<{ id: string; role: string }>) =>
        Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, rows.find((r) => r.id === id)?.role]));
      expect(byKey(accounts, accountRoles)).toEqual({
        admin: 'organization_admin',
        member: 'regular_user',
        custom: 'regular_user',
        // A personal account re-derives from the Administrator it holds (§4).
        personal: 'organization_admin',
      });
      expect(byKey(invitations, invitationRoles)).toEqual({
        admin: 'organization_admin',
        member: 'regular_user',
        custom: 'regular_user',
      });
    });

    it('restores `requires_cart_approval`: true exactly where Member lacks carts.order_without_approval', async () => {
      const untouched = await insertOrganization();
      const withheld = await insertOrganization();
      const regranted = await insertOrganization();
      const otherCode = await insertOrganization();
      const setMember = async (organizationId: string, offered: string[], permissions: string[]) =>
        em.execute(
          `update "organization_roles"
              set "member_defaults_offered" = string_to_array(?, ',')::text[],
                  "permissions" = string_to_array(?, ',')::text[]
            where "organization_id" = ? and "kind" = 'member'`,
          [offered.join(','), permissions.join(','), organizationId],
        );
      // FR-071's marker, as M2 writes it for an approval-requiring Organization.
      await setMember(withheld, ['carts.order_without_approval', 'quick_order.one_click'], []);
      // Offered, then ticked back on by the administrator: Member holds it again.
      await setMember(regranted, ['carts.order_without_approval'], ['carts.order_without_approval']);
      // Only the one-click code withheld: Member still orders without approval.
      await setMember(otherCode, ['quick_order.one_click'], []);

      await apply('down');

      const rows = (await em.execute(
        `select "id", "requires_cart_approval" from "organizations" where "id" in (?, ?, ?, ?)`,
        [untouched, withheld, regranted, otherCode],
      )) as Array<{ id: string; requires_cart_approval: boolean }>;
      const flag = (id: string) => rows.find((r) => r.id === id)?.requires_cart_approval;
      expect({
        untouched: flag(untouched),
        withheld: flag(withheld),
        regranted: flag(regranted),
        otherCode: flag(otherCode),
      }).toEqual({ untouched: false, withheld: true, regranted: false, otherCode: false });
    });

    it('re-adds every column with its old type and default, the index, and both legacy-reading triggers', async () => {
      await apply('down');
      const legacyRole = {
        data_type: 'character varying',
        character_maximum_length: 32,
        is_nullable: 'NO',
        column_default: "'regular_user'::character varying",
      };
      expect(await columnsOf('customer_accounts', 'role')).toEqual([{ column_name: 'role', ...legacyRole }]);
      expect(await columnsOf('organization_invitations', 'role')).toEqual([{ column_name: 'role', ...legacyRole }]);
      expect(await columnsOf('organizations', 'requires_cart_approval')).toEqual([
        {
          column_name: 'requires_cart_approval',
          data_type: 'boolean',
          character_maximum_length: null,
          is_nullable: 'NO',
          column_default: 'false',
        },
      ]);
      const shape = (await schemaShape()) as {
        indexes: Array<{ indexname: string; indexdef: string }>;
        triggers: Array<{ tgname: string }>;
      };
      expect(shape.indexes.find((i) => i.indexname === 'customer_accounts_role_index')?.indexdef).toMatch(
        /\(role\)/,
      );
      expect(shape.triggers.map((t) => t.tgname)).toEqual([
        'customer_accounts_default_organization_role',
        'organization_invitations_default_role',
      ]);

      // The defaults read the legacy enum again, as M2 and M3 left them.
      const company = await insertOrganization();
      const account = randomUUID();
      await em.execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","role","created_at","updated_at")
         values (?, ?, ?, 'hash', 'Legacy', 'Drop', 'organization_admin', now(), now())`,
        [account, company, `${account.slice(0, 8)}@legacy-drop.example`],
      );
      expect(await heldKind(account)).toBe('administrator');
      const invitation = randomUUID();
      await em.execute(
        `insert into "organization_invitations"
           ("id","organization_id","email","role","token_hash","expires_at","created_at","updated_at")
         values (?, ?, ?, 'organization_admin', ?, now() + interval '7 days', now(), now())`,
        [invitation, company, `${invitation.slice(0, 8)}@legacy-drop.example`, `hash-${invitation}`],
      );
      const [held] = (await em.execute(
        `select r."kind" from "organization_invitations" i join "organization_roles" r on r."id" = i."organization_role_id"
          where i."id" = ?`,
        [invitation],
      )) as Array<{ kind: string }>;
      expect(held?.kind).toBe('administrator');
    });

    it('up() after down() rebuilds the upgraded schema exactly, and a second up() changes nothing (FR-074)', async () => {
      const upgraded = await schemaShape();
      await apply('down');
      await apply('up');
      expect(await schemaShape()).toEqual(upgraded);
      await apply('up');
      expect(await schemaShape()).toEqual(upgraded);
    });
  });
});
