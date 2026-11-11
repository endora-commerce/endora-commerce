import { join } from 'node:path';

import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activeSchemaExtensionContext, migrateUpVerified } from '@endora-commerce/platform/db';
import {
  AuditLogEntry,
  ExtensionHostRowNotFoundError,
  ExtensionWriteOutsideCommandError,
  ModuleDisabledError,
  columnExtensionPatchSchema,
  extensionColumns,
  type ColumnExtension,
} from '@endora-commerce/platform/kernel';
import type { Command } from '@endora-commerce/platform/commands';
import { packageSchemaContributionsUnder } from '@endora-commerce/platform/packages';

import { CommandBus } from '../../../src/commands/index.js';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  bootAcmeErpInstance,
  installAcmeErp,
  rewrite,
  type AcmeErpInstance,
} from '../../helpers/acme-erp-instance.js';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/178-extensible-columns/` SC-001, US1 scenarios 1 – 5 and US2 scenarios
 * 1 – 4 (tasks.md T042) — the worked example `acme_erp` end to end on the real
 * `organizations` host.
 *
 * The package is installed into a throwaway instance root and the backend's own
 * ORM configuration discovers it (`helpers/acme-erp-instance.ts`): its
 * declaration, the generated step at the head of its block, its back-fill and
 * its projection, migrated onto a database of this file's own. The Command is
 * the package's own `syncErpCode`, imported from the installed copy.
 */

/**
 * `mod-acme-erp`'s `syncErpCode` (`lib/backend/sync-erp-code.js`), line for
 * line, over the test graph's platform — see the note in `beforeAll`.
 */
function syncErpCodeOf(columns: ColumnExtension) {
  return (organizationId: string, erpCode: string): Command<void> => ({
    action: 'acme_erp.organization.sync',
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(columns, em).set(
        organizationId,
        columnExtensionPatchSchema(columns).parse({ erpCode }),
      );
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  });
}

interface AcmeErpBackend {
  readonly acmeOrganizationColumns: ColumnExtension;
  readonly syncErpCode: (organizationId: string, erpCode: string) => Command<void>;
}

let instance: AcmeErpInstance;
let h: BackendServerHandle;
let acme: AcmeErpBackend;
let bus: CommandBus;
let baseline: string[];
let orgId: string;
const stamp = Date.now().toString().slice(-8);

const present = (): void => registryCache.__setEnabledForTesting([...baseline, 'acme_erp']);

beforeAll(async () => {
  instance = await bootAcmeErpInstance();
  h = await setupBackendServer();
  baseline = registryCache.enabledIds().filter((id) => id !== 'acme_erp');
  // The declaration the ORM configuration registered — the object discovery
  // read out of the installed copy. The package's `syncErpCode` is mirrored
  // below rather than imported: vitest externalizes anything under
  // `node_modules`, so the installed copy's own code runs against a second,
  // native evaluation of the platform whose presence cache the harness never
  // loads. That is an artefact of the test runner (an instance's process holds
  // one platform); the projection is keyed by this declaration object, which is
  // why the test uses it rather than a fresh evaluation of the fixture.
  const registered = activeSchemaExtensionContext().declarations.find(
    (declaration) => declaration.id === 'acme_erp:organizations',
  );
  if (registered === undefined) throw new Error('acme_erp:organizations was not registered by the ORM configuration');
  acme = { acmeOrganizationColumns: registered, syncErpCode: syncErpCodeOf(registered) };
  bus = new CommandBus(h.orm, h.auditLogService, h.eventBus);
  const em = h.em();
  const org = em.create(Organization, {
    name: `Acme ERP Co ${stamp}`,
    taxId: `PL178E${stamp}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'ul. Kolumnowa 2', city: 'Warszawa', postalCode: '00-178', country: 'PL' },
  });
  await em.persistAndFlush(org);
  orgId = org.id;
}, 600_000);

afterAll(async () => {
  registryCache.__setEnabledForTesting(baseline);
  await teardownBackendServer(h);
  await instance.dispose();
});

const sql = <R extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<R[]> =>
  h.orm.em.getConnection().execute(query, params, 'all') as Promise<R[]>;

describe('US1 — the declaration becomes columns, an index and a ledger', () => {
  it('scenario 1: migrate adds the columns and the index, records them applied in the ledger, in order', async () => {
    const generated = instance.applied.find((name) => name.startsWith('Migration10000101T000000AcmeErpSchemaExtensions'));
    expect(instance.applied).toEqual([generated, 'Migration20261201T090000AcmeErpBackfillCreditTier']);

    const columns = await sql<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name = 'organizations' and column_name like 'x\\_acme\\_erp\\_%'
        order by column_name`,
    );
    expect(columns).toEqual([
      { column_name: 'x_acme_erp_credit_tier', data_type: 'smallint', is_nullable: 'NO', column_default: '0' },
      { column_name: 'x_acme_erp_erp_code', data_type: 'character varying', is_nullable: 'YES', column_default: null },
      { column_name: 'x_acme_erp_onboarded_via', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
    const [index] = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'organizations' and indexdef like '%x_acme_erp_erp_code%'`,
    );
    expect(index?.indexdef).toMatch(/CREATE UNIQUE INDEX .* WHERE \(x_acme_erp_erp_code IS NOT NULL\)/);

    const ledger = await sql<{ kind: string; status: string }>(
      `select kind, status from schema_extensions where module_id = 'acme_erp' and host_table = 'organizations'`,
    );
    expect(ledger.filter((row) => row.status === 'applied')).toHaveLength(4);
    expect(ledger.filter((row) => row.kind === 'column')).toHaveLength(3);

    const names = (await configuredMigrations()).names;
    const at = (name: string): number => names.indexOf(name);
    const lastOrganizations = Math.max(
      ...names.filter((name) => /^Migration\d{8}T\d{6}Organizations/.test(name)).map(at),
    );
    expect(at(generated!)).toBeGreaterThan(lastOrganizations);
    expect(at(generated!)).toBeLessThan(at('Migration20261201T090000AcmeErpBackfillCreditTier'));
  });

  it('scenario 5: migrating again finds nothing pending and changes nothing', async () => {
    const orm = await MikroORM.init(await mikroOrmConfig());
    try {
      expect(await migrateUpVerified(orm)).toEqual([]);
    } finally {
      await orm.close(true);
    }
  });

  const refusalOf = async (edit: (packageRoot: string) => void): Promise<Error> => {
    const copy = installAcmeErp(edit);
    try {
      await packageSchemaContributionsUnder([join(copy.root, 'node_modules')]);
    } catch (error) {
      return error as Error;
    } finally {
      copy.remove();
    }
    throw new Error('the edited package was not refused');
  };

  it('scenario 2: NOT NULL without a default is refused naming the module, the key and the rule', async () => {
    const error = await refusalOf((root) =>
      rewrite(root, 'lib/backend/columns.js', (source) =>
        source.replace("creditTier: { type: 'smallint', default: 0 }", "creditTier: { type: 'smallint' }"),
      ),
    );
    expect(error.message).toMatch(/schema_extension_invalid/);
    expect(error.message).toMatch(/acme_erp/);
    expect(error.message).toMatch(/creditTier/);
  });

  it('scenario 3: a host that is not extensible is refused, listing the extensible hosts', async () => {
    const error = await refusalOf((root) =>
      rewrite(root, 'lib/backend/columns.js', (source) => source.replace("host: 'organizations'", "host: 'invoices'")),
    );
    expect(error.message).toMatch(/invoices/);
    expect(error.message).toMatch(/organizations/);
  });

  it('scenario 4: a host outside the dependency closure is refused', async () => {
    const error = await refusalOf((root) =>
      rewrite(root, 'lib/manifest.js', (source) => source.replace("dependencies: ['organizations']", 'dependencies: []')),
    );
    expect(error.message).toMatch(/host-not-a-dependency/);
  });
});

describe('US2 — the package reads and writes its columns', () => {
  const syncAudits = (): Promise<AuditLogEntry[]> =>
    h.em().find(AuditLogEntry, { action: 'acme_erp.organization.sync', objectId: orgId });

  it('scenario 1: a Command issues one UPDATE of the changed column and one names-only audit entry', async () => {
    present();
    const logger = h.orm.config.getLogger();
    const spy = vi.spyOn(logger, 'logQuery');
    let queries: string[];
    try {
      await withSystemScope('178 T042 — ERP sync', () => bus.run(acme.syncErpCode(orgId, 'ERP-42')));
      queries = spy.mock.calls.map(([context]) => String(context.query));
    } finally {
      spy.mockRestore();
    }
    const onHost = queries.filter((query) => /"organizations"/.test(query));
    expect(onHost.filter((query) => /^update/i.test(query))).toEqual([
      expect.stringMatching(/^update "organizations" set "x_acme_erp_erp_code" = .+ where "id" = /),
    ]);
    expect(onHost.filter((query) => /^insert/i.test(query))).toEqual([]);

    const [row] = await sql<{ x_acme_erp_erp_code: string }>(
      `select x_acme_erp_erp_code from organizations where id = ?`,
      [orgId],
    );
    expect(row?.x_acme_erp_erp_code).toBe('ERP-42');

    const audits = await syncAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.stateAfter).toEqual({ extensions: { acme_erp: { changedFields: ['erpCode'] } } });
    expect(JSON.stringify(audits[0])).not.toContain('ERP-42');
  });

  it('scenario 2: an unknown id throws and inserts nothing', async () => {
    present();
    const missing = '00000000-0000-4000-8000-000000000178';
    await expect(
      withSystemScope('178 T042 — unknown id', () => bus.run(acme.syncErpCode(missing, 'ERP-0'))),
    ).rejects.toBeInstanceOf(ExtensionHostRowNotFoundError);
    expect(await sql(`select 1 from organizations where id = ?`, [missing])).toEqual([]);
  });

  it('scenario 3: a write outside a transaction is refused', async () => {
    present();
    await expect(
      withSystemScope('178 T042 — outside a Command', () =>
        extensionColumns(acme.acmeOrganizationColumns, h.orm.em.fork()).set(orgId, { erpCode: 'ERP-X' }),
      ),
    ).rejects.toBeInstanceOf(ExtensionWriteOutsideCommandError);
  });

  it('scenario 4: with acme_erp off every accessor method fails closed and the values stay', async () => {
    registryCache.__setEnabledForTesting([...baseline, 'acme_erp'], { deactivated: ['acme_erp'] });
    try {
      const accessor = extensionColumns(acme.acmeOrganizationColumns, h.orm.em.fork());
      await expect(withSystemScope('178 T042 — off load', () => accessor.load([orgId]))).rejects.toBeInstanceOf(
        ModuleDisabledError,
      );
      await expect(withSystemScope('178 T042 — off get', () => accessor.get(orgId))).rejects.toBeInstanceOf(
        ModuleDisabledError,
      );
      await expect(
        withSystemScope('178 T042 — off set', () => bus.run(acme.syncErpCode(orgId, 'ERP-OFF'))),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    } finally {
      present();
    }
    const [row] = await sql<{ x_acme_erp_erp_code: string }>(
      `select x_acme_erp_erp_code from organizations where id = ?`,
      [orgId],
    );
    expect(row?.x_acme_erp_erp_code).toBe('ERP-42');
  });
});
