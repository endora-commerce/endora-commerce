import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationDetailsPort, TaxIdResolution } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/177-tax-id-scope/` T013 (FR-023, US4) — `findByTaxId` /
 * `resolveByTaxId` on the published `organizationDetailsPort`, over the real
 * table in both scopes.
 *
 * The port reads through its own `EntityManager`, so the fixtures are committed
 * with tax IDs no other test uses. The `per-tree-root` block installs that
 * scope's database enforcement the way the scope Command will (WP-3) — the
 * exclusion constraint in, the unique constraint out, the policy row updated —
 * and puts the database back as it found it afterwards: its fixtures are
 * deleted first, because the unique constraint cannot return over shared tax
 * IDs. Each worker owns its database clone, so no other file sees the swap.
 */
describe('organizationDetailsPort — lookups by tax ID', () => {
  let h: BackendServerHandle;
  let port: OrganizationDetailsPort;
  const created: string[] = [];

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  function uniqueTaxId(): string {
    return `LK${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;
  }

  /** A company row; `parent` makes it a child, `createdAt` fixes the order. */
  async function company(input: {
    taxId: string;
    parent?: { id: string; path: string };
    createdAt?: string;
    deleted?: boolean;
  }): Promise<{ id: string; path: string }> {
    const id = randomUUID();
    const path = `${input.parent?.path ?? '/'}${id}/`;
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at","deleted_at")
       values (?, ?, ?, 'active', 'vat_payer', false, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, ?, ?, now(), ?)`,
      [
        id,
        `Lookup ${id.slice(0, 8)}`,
        input.taxId,
        input.parent?.id ?? null,
        path,
        input.createdAt ?? new Date().toISOString(),
        input.deleted ? new Date().toISOString() : null,
      ],
    );
    created.push(id);
    return { id, path };
  }

  async function personal(): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'Lookup personal', null, 'active', 'vat_exempt', true, ?, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, now(), now())`,
      [id, randomUUID(), `/${id}/`],
    );
    created.push(id);
    return id;
  }

  async function currentScope(): Promise<string> {
    const rows = await sql<Array<{ scope: string }>>('select "scope" from "organization_tax_id_policy"');
    return rows[0]!.scope;
  }

  function idsOf(resolution: TaxIdResolution): string[] {
    if (resolution.kind === 'none') return [];
    if (resolution.kind === 'one') return [resolution.organization.id];
    return resolution.organizations.map((o) => o.id);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<OrganizationDetailsPort>('organizationDetailsPort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('in either scope', () => {
    it('answers [] and none for a tax ID nobody holds, and for an input with nothing left', async () => {
      expect(await port.findByTaxId(uniqueTaxId())).toEqual([]);
      expect(await port.resolveByTaxId(uniqueTaxId())).toEqual({ kind: 'none' });
      expect(await port.findByTaxId(' - ')).toEqual([]);
      expect(await port.resolveByTaxId('')).toEqual({ kind: 'none' });
    });

    it('answers the one organization holding it', async () => {
      const taxId = uniqueTaxId();
      const org = await company({ taxId });
      const found = await port.findByTaxId(taxId);
      expect(found.map((o) => o.id)).toEqual([org.id]);
      expect(found[0]!.taxId).toBe(taxId);
      const resolution = await port.resolveByTaxId(taxId);
      expect(resolution.kind).toBe('one');
      expect(idsOf(resolution)).toEqual([org.id]);
    });

    it('normalises spaces, dashes and lower case as the admin boundary does (US4 #4)', async () => {
      const taxId = uniqueTaxId();
      const org = await company({ taxId });
      const typed = ` ${taxId.slice(0, 4).toLowerCase()}-${taxId.slice(4, 9)} ${taxId.slice(9)} `;
      expect((await port.findByTaxId(typed)).map((o) => o.id)).toEqual([org.id]);
      expect(idsOf(await port.resolveByTaxId(typed))).toEqual([org.id]);
    });

    it('excludes a soft-deleted organization unless asked, and does not resolve to it', async () => {
      const taxId = uniqueTaxId();
      const org = await company({ taxId, deleted: true });
      expect(await port.findByTaxId(taxId)).toEqual([]);
      expect((await port.findByTaxId(taxId, { includeDeleted: true })).map((o) => o.id)).toEqual([org.id]);
      expect(await port.resolveByTaxId(taxId)).toEqual({ kind: 'none' });
    });

    it('never matches a personal organization, which has no tax ID', async () => {
      const id = await personal();
      const [record] = await port.findByIds([id]);
      expect(record!.taxId).toBeNull();
      expect(record!.convertedToCompanyAt).toBeNull();
      expect(await port.findByTaxId(id.replace(/-/g, ''))).toEqual([]);
    });
  });

  describe('in per-tree-root', () => {
    let swapped = false;

    beforeAll(async () => {
      if ((await currentScope()) === 'per-tree-root') return;
      swapped = true;
      await sql(`
        do $$
        begin
          lock table "organizations" in share row exclusive mode;
          if not exists (select 1 from pg_constraint where conrelid = 'organizations'::regclass
                           and conname = 'organizations_tax_id_one_tree') then
            alter table "organizations" add constraint "organizations_tax_id_one_tree"
              exclude using gist ("tax_id" with =, "root_id" with <>) deferrable initially deferred;
          end if;
          alter table "organizations" drop constraint if exists "organizations_tax_id_unique";
          update "organization_tax_id_policy" set "scope" = 'per-tree-root', "updated_at" = now() where "id";
        end
        $$;
      `);
    });

    afterAll(async () => {
      if (!swapped) return;
      try {
        // Leaves first, level by level: `parent_id` is ON DELETE RESTRICT.
        for (let depth = 0; depth < 5; depth += 1) {
        await sql(
          `delete from "organizations" o where o."id" = any(?::uuid[])
             and not exists (select 1 from "organizations" c where c."parent_id" = o."id")`,
            [`{${created.join(',')}}`],
          );
        }
      } finally {
        await restoreGlobal();
      }
    });

    async function restoreGlobal(): Promise<void> {
      await sql(`
        do $$
        begin
          lock table "organizations" in share row exclusive mode;
          if not exists (select 1 from pg_constraint where conrelid = 'organizations'::regclass
                           and conname = 'organizations_tax_id_unique') then
            alter table "organizations" add constraint "organizations_tax_id_unique" unique ("tax_id");
          end if;
          alter table "organizations" drop constraint if exists "organizations_tax_id_one_tree";
          update "organization_tax_id_policy" set "scope" = 'global', "updated_at" = now() where "id";
        end
        $$;
      `);
    }

    it('lists the root first, then by depth, creation time and id; resolves to the root (US4 #3)', async () => {
      const taxId = uniqueTaxId();
      const root = await company({ taxId, createdAt: '2026-01-03T00:00:00.000Z' });
      const late = await company({ taxId, parent: root, createdAt: '2026-01-02T00:00:00.000Z' });
      const early = await company({ taxId, parent: root, createdAt: '2026-01-01T00:00:00.000Z' });
      const deep = await company({ taxId, parent: early, createdAt: '2025-12-31T00:00:00.000Z' });

      expect((await port.findByTaxId(taxId)).map((o) => o.id)).toEqual([root.id, early.id, late.id, deep.id]);
      const resolution = await port.resolveByTaxId(taxId);
      expect(resolution).toMatchObject({ kind: 'one', organization: { id: root.id } });
    });

    it('a branch whose head office is soft-deleted resolves to the oldest live match', async () => {
      const taxId = uniqueTaxId();
      const root = await company({ taxId, deleted: true, createdAt: '2026-01-01T00:00:00.000Z' });
      const younger = await company({ taxId, parent: root, createdAt: '2026-01-03T00:00:00.000Z' });
      const older = await company({ taxId, parent: root, createdAt: '2026-01-02T00:00:00.000Z' });

      expect((await port.findByTaxId(taxId)).map((o) => o.id)).toEqual([older.id, younger.id]);
      expect((await port.findByTaxId(taxId, { includeDeleted: true })).map((o) => o.id)).toEqual([
        root.id,
        older.id,
        younger.id,
      ]);
      expect(await port.resolveByTaxId(taxId)).toMatchObject({ kind: 'one', organization: { id: older.id } });
    });

    it('ambiguous is unreachable: the database refuses the tax ID in a second tree', async () => {
      const taxId = uniqueTaxId();
      const root = await company({ taxId });
      await company({ taxId, parent: root });
      await expect(company({ taxId })).rejects.toMatchObject({ code: '23P01' });
      // The refused row was never written, so `company()` recorded nothing for it.

      const states: string[] = [taxId];
      // Every state per-tree-root permits for one tax ID: a lone root, a root
      // with branches, a deleted root with live branches, all deleted.
      const lone = uniqueTaxId();
      await company({ taxId: lone });
      states.push(lone);
      const orphaned = uniqueTaxId();
      const deadRoot = await company({ taxId: orphaned, deleted: true });
      await company({ taxId: orphaned, parent: deadRoot });
      states.push(orphaned);
      const gone = uniqueTaxId();
      await company({ taxId: gone, deleted: true });
      states.push(gone);

      for (const state of states) {
        expect((await port.resolveByTaxId(state)).kind).not.toBe('ambiguous');
      }
    });
  });
});
