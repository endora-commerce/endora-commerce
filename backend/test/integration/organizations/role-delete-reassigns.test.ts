import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizationRoleResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Deleting a role that members and invitations hold
 * (`specs/170-organization-roles/` WP-02b, T042; `contracts/commands-audit-events.md`
 * §2; research R-22; FR-024, FR-065, US 6).
 *
 * `organization_role.delete` names a replacement and moves every holder inside
 * its own transaction: one `customer_account.change_role` **child** per account
 * through `ctx.run` — each its own audit entry — plus the invitation moves, and
 * the role row last. Parent and children commit together or not at all.
 *
 * `stub-customer-session` is `TEST_ORGANIZATION_ID`'s administrator.
 */

const ADMIN = { b2b_session: 'stub-customer-session' };

describe('organization_role.delete with holders', () => {
  let h: BackendServerHandle;

  async function sql<T>(statement: string, params: unknown[] = []): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function memberRoleId(): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'member'`,
      [TEST_ORGANIZATION_ID],
    );
    return row!.id;
  }

  async function createRole(name: string): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/roles',
      cookies: ADMIN,
      payload: { name, permissions: [] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const role = organizationRoleResponseSchema.parse(res.json()).data;
    return { id: role.id, version: role.version };
  }

  /** Three accounts — one of them blocked, one deleted — and one invitation holding `roleId`. */
  async function holders(roleId: string): Promise<{ accounts: string[]; invitation: string }> {
    const accounts: string[] = [];
    for (const state of ['active', 'blocked', 'deleted'] as const) {
      const id = randomUUID();
      await sql(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name",
            "organization_role_id","blocked_at","deleted_at","created_at","updated_at")
         values (?, ?, ?, 'x', 'Held', 'Role', ?, ?, ?, now(), now())`,
        [
          id,
          TEST_ORGANIZATION_ID,
          `${id.slice(0, 8)}@role-delete.example`,
          roleId,
          state === 'blocked' ? new Date() : null,
          state === 'deleted' ? new Date() : null,
        ],
      );
      accounts.push(id);
    }
    const invitation = randomUUID();
    await sql(
      `insert into "organization_invitations"
         ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
       values (?, ?, ?, ?, ?, now() + interval '7 days', now(), now())`,
      [invitation, TEST_ORGANIZATION_ID, `${invitation.slice(0, 8)}@role-delete.example`, roleId, `hash-${invitation}`],
    );
    return { accounts, invitation };
  }

  async function heldRoles(accounts: readonly string[]): Promise<string[]> {
    const rows = await sql<{ id: string; organization_role_id: string }>(
      `select "id","organization_role_id" from "customer_accounts" where "id" in (?, ?, ?)`,
      [...accounts],
    );
    return accounts.map((id) => rows.find((r) => r.id === id)!.organization_role_id);
  }

  async function invitationRole(invitation: string): Promise<string> {
    const [row] = await sql<{ organization_role_id: string }>(
      `select "organization_role_id" from "organization_invitations" where "id" = ?`,
      [invitation],
    );
    return row!.organization_role_id;
  }

  async function auditSince(since: Date): Promise<Array<{ action: string; object_type: string; object_id: string }>> {
    return sql(
      `select "action","object_type","object_id" from "audit_log_entries"
        where "acted_at" >= ? and "action" in ('organization_role.delete','customer_account.change_role')
        order by "acted_at", "action"`,
      [since],
    );
  }

  async function remove(roleId: string, version: number, replacementRoleId?: string) {
    return h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/roles/${roleId}`,
      cookies: ADMIN,
      payload: { expectedVersion: version, ...(replacementRoleId ? { replacementRoleId } : {}) },
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves every holder to the replacement in one unit, one entry per moved account (FR-024, FR-065)', async () => {
    const role = await createRole(`Held ${randomUUID().slice(0, 6)}`);
    const { accounts, invitation } = await holders(role.id);
    const replacement = await memberRoleId();
    const since = new Date();

    const res = await remove(role.id, role.version, replacement);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { reassignedMembers: 3, reassignedInvitations: 1 } });

    expect(await heldRoles(accounts)).toEqual([replacement, replacement, replacement]);
    expect(await invitationRole(invitation)).toBe(replacement);
    expect(await sql(`select 1 from "organization_roles" where "id" = ?`, [role.id])).toEqual([]);

    const entries = await auditSince(since);
    expect(entries.filter((e) => e.action === 'organization_role.delete')).toEqual([
      { action: 'organization_role.delete', object_type: 'organization', object_id: TEST_ORGANIZATION_ID },
    ]);
    expect(entries.filter((e) => e.action === 'customer_account.change_role')).toHaveLength(3);
    for (const entry of entries) expect(entry.object_type).toBe('organization');
  });

  it('still refuses a held role without a replacement (422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED)', async () => {
    const role = await createRole(`Kept ${randomUUID().slice(0, 6)}`);
    const { accounts } = await holders(role.id);
    const res = await remove(role.id, role.version);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.code).toBe('ORGANIZATION_ROLE_REPLACEMENT_REQUIRED');
    expect(await heldRoles(accounts)).toEqual([role.id, role.id, role.id]);
  });

  it('rolls everything back when one child fails — no account moved, no invitation moved, no entry', async () => {
    const role = await createRole(`Atomic ${randomUUID().slice(0, 6)}`);
    const { accounts, invitation } = await holders(role.id);
    const replacement = await memberRoleId();
    const doomed = accounts[2]!;
    // The third child's write fails in the database, after the first two ran.
    await sql(`
      create or replace function "t042_refuse_move"() returns trigger language plpgsql as $$
      begin
        if new."id" = '${doomed}'::uuid and new."organization_role_id" is distinct from old."organization_role_id" then
          raise exception 't042: this child fails';
        end if;
        return new;
      end $$;
    `);
    await sql(`create trigger "t042_refuse_move" before update on "customer_accounts"
                 for each row execute function "t042_refuse_move"()`);
    try {
      const since = new Date();
      const res = await remove(role.id, role.version, replacement);
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(await heldRoles(accounts)).toEqual([role.id, role.id, role.id]);
      expect(await invitationRole(invitation)).toBe(role.id);
      expect(await sql(`select 1 from "organization_roles" where "id" = ?`, [role.id])).toHaveLength(1);
      expect(await auditSince(since)).toEqual([]);
    } finally {
      await sql(`drop trigger if exists "t042_refuse_move" on "customer_accounts"`);
      await sql(`drop function if exists "t042_refuse_move"()`);
    }
  });

  it("resolves customer_accounts' role Command port lazily, per call (composition item 6)", () => {
    const index = readFileSync(
      fileURLToPath(new URL('../../../../packages/modules/organizations/src/backend/index.ts', import.meta.url)),
      'utf8',
    );
    expect(index).toMatch(/lazyPort<CustomerAccountRoleCommandPort>\(\s*ctx,\s*'customerAccountRoleCommandPort'\s*\)/);
  });
});
