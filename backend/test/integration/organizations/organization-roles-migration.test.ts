import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  Migration20261103T173304OrganizationsOrganizationRoles,
  Migration20261104T094535OrganizationsDropLegacyRoleColumns,
} from '@endora-commerce/mod-organizations/migrations';
import {
  Migration20261103T190132CustomerAccountsOrganizationRoleAssignment,
  Migration20261104T094540CustomerAccountsDropLegacyRoleColumn,
} from '@endora-commerce/mod-customer-accounts/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Migration **M2** — `organization_roles` (`specs/170-organization-roles/` WP-02a,
 * T024; `contracts/migration-and-replay.md` §2; data-model §1 and §3; research
 * R-18, R-19, R-28; owner ruling PR-2; FR-001, FR-070, FR-071, FR-074).
 *
 * Executed, not described: the statements come from the migration class, the
 * rows are written in raw SQL in the shape the code could write before this
 * feature, and every case runs inside a transaction that is rolled back, so the
 * shared database never sees a dropped table.
 *
 * The test database is already migrated, so "before M2" is reached by running
 * `down()` first — which is also how the replay (R-27) reaches the old schema.
 * Since WP-12 the migrated schema is also past **M4** and **M5**, which drop the
 * legacy columns M2 reads (`requires_cart_approval`, the invitation's `role`)
 * and the trigger M2 installs on it; every case therefore starts from their
 * `down()`s — M5's, then M4's — the state M2 and M3 left
 * (`contracts/migration-and-replay.md` §6 step 2 runs them in the same order).
 */
describe('M2 — organization_roles', () => {
  let db: TestDb;
  let em: EntityManager;

  function migration(): Migration20261103T173304OrganizationsOrganizationRoles {
    return new Migration20261103T173304OrganizationsOrganizationRoles(em.getDriver(), em.config);
  }

  /**
   * M3 (`customer_accounts`, WP-02b) holds a foreign key into
   * `organization_roles`, so the schema before M2 is reached as the replay
   * reaches it — M3's `down()` first — and M3 is re-applied after M2's `up()`.
   */
  async function apply(direction: 'up' | 'down'): Promise<void> {
    const steps =
      direction === 'down'
        ? [new Migration20261103T190132CustomerAccountsOrganizationRoleAssignment(em.getDriver(), em.config), migration()]
        : [migration(), new Migration20261103T190132CustomerAccountsOrganizationRoleAssignment(em.getDriver(), em.config)];
    for (const m of steps) {
      await m[direction]();
      for (const query of m.getQueries()) await em.execute(query as string);
    }
  }

  async function insertOrganization(options: {
    status?: string;
    isPersonal?: boolean;
    requiresCartApproval?: boolean;
  } = {}): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path",
          "is_personal","requires_cart_approval","created_at","updated_at")
       values (?, ?, ?, ?, 'vat_payer', '{}'::jsonb, ?, ?, ?, now(), now())`,
      [
        id,
        `Roles ${id.slice(0, 8)}`,
        `${options.isPersonal ? 'personal' : 'roles'}-${id.slice(0, 13)}`,
        options.status ?? 'active',
        `/${id}/`,
        options.isPersonal ?? false,
        options.requiresCartApproval ?? false,
      ],
    );
    return id;
  }

  async function insertInvitation(
    organizationId: string,
    role: 'organization_admin' | 'regular_user',
    state: 'pending' | 'expired' | 'revoked' | 'accepted',
  ): Promise<string> {
    const id = randomUUID();
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    await em.execute(
      `insert into "organization_invitations"
         ("id","organization_id","email","role","token_hash","expires_at","consumed_at","revoked_at",
          "created_at","updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
      [
        id,
        organizationId,
        `${id.slice(0, 8)}@roles-migration.example`,
        role,
        `hash-${id}`,
        new Date(state === 'expired' ? now - day : now + 7 * day),
        state === 'accepted' ? new Date(now - day / 2) : null,
        state === 'revoked' ? new Date(now - day / 2) : null,
      ],
    );
    return id;
  }

  interface RoleRow {
    id: string;
    kind: string;
    name: string | null;
    permissions: string[];
    member_defaults_offered: string[];
    version: number;
  }

  async function rolesOf(organizationId: string): Promise<RoleRow[]> {
    return (await em.execute(
      `select "id","kind","name","permissions","member_defaults_offered","version"
         from "organization_roles" where "organization_id" = ? order by "kind"`,
      [organizationId],
    )) as RoleRow[];
  }

  async function invitationRoleKind(invitationId: string): Promise<string | null> {
    const rows = (await em.execute(
      `select r."kind" from "organization_invitations" i
         join "organization_roles" r on r."id" = i."organization_role_id"
                                    and r."organization_id" = i."organization_id"
        where i."id" = ?`,
      [invitationId],
    )) as Array<{ kind: string }>;
    return rows[0]?.kind ?? null;
  }

  /** The DDL a statement would leave behind, for the before/after comparison. */
  async function schemaShape(): Promise<unknown> {
    const columns = await em.execute(
      `select table_name, column_name, data_type, is_nullable from information_schema.columns
        where table_name in ('organization_roles','organization_invitations')
        order by table_name, column_name`,
    );
    const constraints = await em.execute(
      `select conname from pg_constraint
        where conrelid in (select oid from pg_class where relname in ('organization_roles','organization_invitations'))
        order by conname`,
    );
    const triggers = await em.execute(
      `select tgname from pg_trigger where not tgisinternal
          and tgname in ('organizations_seed_predefined_roles','organization_invitations_default_role')
        order by tgname`,
    );
    const functions = await em.execute(
      `select proname from pg_proc
        where proname in ('organizations_seed_predefined_roles','organization_invitations_default_role')
        order by proname`,
    );
    const indexes = await em.execute(
      `select tablename, indexname, indexdef from pg_indexes
        where tablename in ('organization_roles','organization_invitations')
        order by tablename, indexname`,
    );
    return { columns, constraints, indexes, triggers, functions };
  }

  /** Runs `statement` under a savepoint and answers the error it raised, if any. */
  async function refusal(statement: string, params: unknown[] = []): Promise<string | null> {
    await em.execute('savepoint "m2_probe"');
    try {
      await em.execute(statement, params);
      await em.execute('release savepoint "m2_probe"');
      return null;
    } catch (err) {
      await em.execute('rollback to savepoint "m2_probe"');
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
    for (const m of [
      new Migration20261104T094540CustomerAccountsDropLegacyRoleColumn(em.getDriver(), em.config),
      new Migration20261104T094535OrganizationsDropLegacyRoleColumns(em.getDriver(), em.config),
    ]) {
      await m.down();
      for (const query of m.getQueries()) await em.execute(query as string);
    }
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  describe('after the upgrade, by construction (R-28, PR-2)', () => {
    it('creates both predefined roles in the insert of every new Organization — company, personal and blocked', async () => {
      for (const options of [{}, { isPersonal: true }, { status: 'blocked' }]) {
        const id = await insertOrganization(options);
        const roles = await rolesOf(id);
        expect(roles.map((r) => r.kind)).toEqual(['administrator', 'member']);
        for (const role of roles) {
          expect(role).toMatchObject({ name: null, permissions: [], member_defaults_offered: [], version: 1 });
        }
      }
    });

    it('fills an invitation inserted without a role reference from its legacy role', async () => {
      const org = await insertOrganization();
      const admin = await insertInvitation(org, 'organization_admin', 'pending');
      const regular = await insertInvitation(org, 'regular_user', 'pending');
      expect(await invitationRoleKind(admin)).toBe('administrator');
      expect(await invitationRoleKind(regular)).toBe('member');
    });

    it('refuses a second administrator or member row, and a custom role without a name', async () => {
      const org = await insertOrganization();
      for (const kind of ['administrator', 'member']) {
        expect(
          await refusal(
            `insert into "organization_roles" ("id","organization_id","kind") values (?, ?, ?)`,
            [randomUUID(), org, kind],
          ),
        ).not.toBeNull();
      }
      expect(
        await refusal(
          `insert into "organization_roles" ("id","organization_id","kind") values (?, ?, 'custom')`,
          [randomUUID(), org],
        ),
      ).not.toBeNull();
      expect(
        await refusal(
          `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
           values (?, ?, 'member', 'Named', 'named')`,
          [randomUUID(), org],
        ),
      ).not.toBeNull();
    });

    it('refuses two custom roles of one Organization with the same normalized name', async () => {
      const org = await insertOrganization();
      const insertCustom = (name: string) =>
        refusal(
          `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
           values (?, ?, 'custom', ?, lower(btrim(?)))`,
          [randomUUID(), org, name, name],
        );
      expect(await insertCustom('Buyer')).toBeNull();
      expect(await insertCustom(' buyer ')).not.toBeNull();
      // Another Organization may use the name (FR-004 is per Organization).
      const other = await insertOrganization();
      expect(
        await refusal(
          `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
           values (?, ?, 'custom', 'Buyer', 'buyer')`,
          [randomUUID(), other],
        ),
      ).toBeNull();
    });

    it("refuses an invitation that points at another Organization's role (composite FK, FR-005)", async () => {
      const a = await insertOrganization();
      const b = await insertOrganization();
      const invitation = await insertInvitation(a, 'regular_user', 'pending');
      const [bMember] = (await rolesOf(b)).filter((r) => r.kind === 'member');
      expect(
        await refusal(`update "organization_invitations" set "organization_role_id" = ? where "id" = ?`, [
          bMember!.id,
          invitation,
        ]),
      ).toMatch(/organization_invitations_organization_role_fk/);
    });

    it('refuses deleting a role an invitation still references', async () => {
      const org = await insertOrganization();
      const id = randomUUID();
      await em.execute(
        `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
         values (?, ?, 'custom', 'Held', 'held')`,
        [id, org],
      );
      const invitation = await insertInvitation(org, 'regular_user', 'expired');
      await em.execute(`update "organization_invitations" set "organization_role_id" = ? where "id" = ?`, [
        id,
        invitation,
      ]);
      expect(await refusal(`delete from "organization_roles" where "id" = ?`, [id])).not.toBeNull();
    });
  });

  describe('the upgrade of an existing database (FR-070, FR-071, FR-074)', () => {
    it('backfills every Organization and every invitation, marks the approval Member, and is repeatable', async () => {
      await apply('down');

      const company = await insertOrganization();
      const approval = await insertOrganization({ requiresCartApproval: true });
      const personal = await insertOrganization({ isPersonal: true });
      const blocked = await insertOrganization({ status: 'blocked' });
      const invitations: Array<{ id: string; expected: string }> = [];
      for (const state of ['pending', 'expired', 'revoked', 'accepted'] as const) {
        invitations.push({ id: await insertInvitation(company, 'organization_admin', state), expected: 'administrator' });
        invitations.push({ id: await insertInvitation(approval, 'regular_user', state), expected: 'member' });
      }

      await apply('up');

      for (const org of [company, approval, personal, blocked]) {
        expect((await rolesOf(org)).map((r) => r.kind)).toEqual(['administrator', 'member']);
      }
      const approvalMember = (await rolesOf(approval)).find((r) => r.kind === 'member')!;
      expect([...approvalMember.member_defaults_offered].sort()).toEqual([
        'carts.order_without_approval',
        'quick_order.one_click',
      ]);
      expect(approvalMember.permissions).toEqual([]);
      const companyMember = (await rolesOf(company)).find((r) => r.kind === 'member')!;
      expect(companyMember.member_defaults_offered).toEqual([]);
      for (const invitation of invitations) {
        expect(await invitationRoleKind(invitation.id)).toBe(invitation.expected);
      }
      const nullable = (await em.execute(
        `select is_nullable from information_schema.columns
          where table_name = 'organization_invitations' and column_name = 'organization_role_id'`,
      )) as Array<{ is_nullable: string }>;
      expect(nullable).toEqual([{ is_nullable: 'NO' }]);

      // FR-074 — a second `up()` changes nothing.
      const snapshot = async () => ({
        roles: await em.execute(
          `select "id","organization_id","kind","permissions","member_defaults_offered","version"
             from "organization_roles" where "organization_id" in (?, ?, ?, ?) order by "id"`,
          [company, approval, personal, blocked],
        ),
        invitations: await em.execute(
          `select "id","organization_role_id" from "organization_invitations"
            where "organization_id" in (?, ?) order by "id"`,
          [company, approval],
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
        columns: Array<{ table_name: string; column_name: string }>;
        triggers: unknown[];
        functions: unknown[];
      };
      expect(downgraded.columns.filter((c) => c.table_name === 'organization_roles')).toEqual([]);
      expect(downgraded.columns.map((c) => c.column_name)).not.toContain('organization_role_id');
      expect(downgraded.triggers).toEqual([]);
      expect(downgraded.functions).toEqual([]);
      await apply('up');
      expect(await schemaShape()).toEqual(upgraded);
    });
  });
});
