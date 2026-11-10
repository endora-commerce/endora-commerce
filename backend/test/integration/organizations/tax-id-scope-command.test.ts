import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type TaxIdScope } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';
import { makeSetTaxIdScopeCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-tax-id-scope.command.js';

/**
 * `specs/177-tax-id-scope/` T030 — `organization.tax_id_scope.set`
 * (`contracts/tax-id-scope.md` §2; FR-014, FR-015, FR-016, FR-026).
 *
 * Runs the real Command through the real bus against the database, in either
 * starting scope: each test reads the scope it found and puts it back before
 * it ends, deleting its own sharing fixtures first, because the `global`
 * constraint cannot return over a shared tax ID. Each worker owns its database
 * clone, so no other file sees a swap.
 */
describe('organization.tax_id_scope.set', () => {
  let h: BackendServerHandle;
  let scopes: TaxIdScopeService;
  let initial: TaxIdScope;
  const created: string[] = [];

  const bus = () =>
    (h.container.cradle as unknown as { commandBus: { run<T>(command: Command<T>): Promise<T> } }).commandBus;

  const fresh = (): EntityManager => h.em().fork() as EntityManager;

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return fresh().getConnection().execute(statement, params) as Promise<T>;
  }

  const set = (scope: TaxIdScope, service: TaxIdScopeService = scopes) =>
    bus().run(makeSetTaxIdScopeCommand({ scopes: service }, { scope }));

  async function constraints(): Promise<string[]> {
    const rows = await sql<Array<{ conname: string }>>(
      `select conname from pg_constraint
        where conrelid = 'organizations'::regclass
          and conname in ('organizations_tax_id_unique', 'organizations_tax_id_one_tree')
        order by conname`,
    );
    return rows.map((row) => row.conname);
  }

  async function policy(): Promise<{ scope: string; updated_by_admin_user_id: string | null }> {
    const rows = await sql<Array<{ scope: string; updated_by_admin_user_id: string | null }>>(
      'select "scope", "updated_by_admin_user_id" from "organization_tax_id_policy"',
    );
    return rows[0]!;
  }

  async function auditEntries(): Promise<Array<{ state_before: unknown; state_after: unknown }>> {
    return sql(
      `select "state_before", "state_after" from "audit_log_entries"
        where "action" = 'organization.tax_id_scope.set' order by "acted_at"`,
    );
  }

  async function company(taxId: string, parent?: { id: string; path: string }): Promise<{ id: string; path: string }> {
    const id = randomUUID();
    const path = `${parent?.path ?? '/'}${id}/`;
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', false, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, ?, now(), now())`,
      [id, `Scope ${id.slice(0, 8)}`, taxId, parent?.id ?? null, path],
    );
    created.push(id);
    return { id, path };
  }

  async function removeFixtures(): Promise<void> {
    // Leaves first: `parent_id` is ON DELETE RESTRICT.
    for (let depth = 0; depth < 5 && created.length > 0; depth += 1) {
      await sql(
        `delete from "organizations" o where o."id" = any(?::uuid[])
           and not exists (select 1 from "organizations" c where c."parent_id" = o."id")`,
        [`{${created.join(',')}}`],
      );
    }
    created.length = 0;
  }

  const uniqueTaxId = (): string => `SC${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
  const other = (scope: TaxIdScope): TaxIdScope => (scope === 'global' ? 'per-tree-root' : 'global');
  const expected = (scope: TaxIdScope): string[] =>
    scope === 'global' ? ['organizations_tax_id_unique'] : ['organizations_tax_id_one_tree'];

  beforeAll(async () => {
    h = await setupBackendServer();
    scopes = new TaxIdScopeService(() => h.em().fork() as EntityManager);
    initial = (await policy()).scope as TaxIdScope;
  });

  afterEach(async () => {
    await removeFixtures();
    if ((await policy()).scope !== initial) await set(initial);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('swaps the constraint and the policy row together, and audits { scope } before and after', async () => {
    const before = (await auditEntries()).length;
    const target = other(initial);

    await set(target);

    expect((await policy()).scope).toBe(target);
    expect(await constraints()).toEqual(expected(target));
    const entries = await auditEntries();
    expect(entries).toHaveLength(before + 1);
    expect(entries.at(-1)).toMatchObject({ state_before: { scope: initial }, state_after: { scope: target } });

    await set(initial);
    expect(await constraints()).toEqual(expected(initial));
  });

  it('setting the scope in force records no audit entry and re-creates a missing constraint (FR-016)', async () => {
    const before = (await auditEntries()).length;
    const [present] = expected(initial);
    await sql(`alter table "organizations" drop constraint "${present}"`);
    expect(await constraints()).toEqual([]);

    await set(initial);

    expect(await constraints()).toEqual(expected(initial));
    expect(await auditEntries()).toHaveLength(before);
  });

  it('refuses per-tree-root → global while a tax ID is shared, with the count and examples, then succeeds (FR-015)', async () => {
    if (initial === 'global') await set('per-tree-root');
    const shared = uniqueTaxId();
    const root = await company(shared);
    const branch = await company(shared, root);

    const refusal = await set('global').catch((err: unknown) => err);
    expect(refusal).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES,
    });
    const details = (refusal as { details: { code: string; sharedTaxIdCount: number; examples: Array<{ taxId: string; organizationIds: string[] }> } }).details;
    expect(details.code).toBe('shared_tax_ids');
    expect(details.sharedTaxIdCount).toBeGreaterThanOrEqual(1);
    expect(details.examples.length).toBeLessThanOrEqual(20);
    const mine = details.examples.find((example) => example.taxId === shared);
    if (details.examples.length < 20 || mine) expect(mine?.organizationIds.sort()).toEqual([root.id, branch.id].sort());
    expect((await policy()).scope).toBe('per-tree-root');
    expect(await constraints()).toEqual(expected('per-tree-root'));

    await removeFixtures();
    await set('global');
    expect(await constraints()).toEqual(expected('global'));
  });

  it('caps the examples at 20, ordered by tax ID', async () => {
    if (initial === 'global') await set('per-tree-root');
    const prefix = `SX${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    for (let i = 0; i < 21; i += 1) {
      const taxId = `${prefix}${String(i).padStart(2, '0')}`;
      const root = await company(taxId);
      await company(taxId, root);
    }
    const refusal = (await set('global').catch((err: unknown) => err)) as {
      details: { sharedTaxIdCount: number; examples: Array<{ taxId: string }> };
    };
    expect(refusal.details.sharedTaxIdCount).toBeGreaterThanOrEqual(21);
    expect(refusal.details.examples).toHaveLength(20);
    const taxIds = refusal.details.examples.map((example) => example.taxId);
    expect(taxIds).toEqual([...taxIds].sort());
  });

  it('a failure after the DDL leaves the row and the constraints as they were', async () => {
    class FailingAfterDdl extends TaxIdScopeService {
      override async applyEnforcement(em: EntityManager, scope: TaxIdScope): Promise<void> {
        await super.applyEnforcement(em, scope);
        throw new Error('injected after the constraint swap');
      }
    }
    const failing = new FailingAfterDdl(() => h.em().fork() as EntityManager);

    await expect(set(other(initial), failing)).rejects.toThrow('injected after the constraint swap');

    expect((await policy()).scope).toBe(initial);
    expect(await constraints()).toEqual(expected(initial));
  });

  it('two concurrent changes serialise: one audited change, one no-op, the database consistent', async () => {
    const before = (await auditEntries()).length;
    const target = other(initial);

    const results = await Promise.allSettled([set(target), set(target)]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await policy()).scope).toBe(target);
    expect(await constraints()).toEqual(expected(target));
    expect(await auditEntries()).toHaveLength(before + 1);
  });

  it('a read on another connection after the change sees the new scope (FR-026)', async () => {
    const target = other(initial);
    await set(target);
    const elsewhere = fresh();
    expect(await scopes.scope(elsewhere)).toBe(target);
    expect((await scopes.status(elsewhere)).enforcement).toBe('consistent');
  });

  it('records the acting administrator on the policy row', async () => {
    await set(other(initial));
    const row = await policy();
    // The harness's ambient actor is an administrator or the system; either way the
    // row says who, as the audit entry does.
    const [entry] = await sql<Array<{ actor_admin_user_id: string | null }>>(
      `select "actor_admin_user_id" from "audit_log_entries"
        where "action" = 'organization.tax_id_scope.set' order by "acted_at" desc limit 1`,
    );
    expect(row.updated_by_admin_user_id).toBe(entry!.actor_admin_user_id);
  });
});
