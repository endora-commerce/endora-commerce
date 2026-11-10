import { describe, expect, it } from 'vitest';
import { createColumnExtension } from '../kernel/schema-extensions/define.js';
import {
  SCHEMA_EXTENSION_STAMP,
  schemaExtensionEntries,
  schemaExtensionHash,
  schemaExtensionMigrationName,
} from './schema-extension-migration.js';
import { configuredMigrationsFrom } from './configured-migrations.js';
import type { PackageSchemaContribution } from '../packages/package-runtime.js';

/**
 * `specs/178-extensible-columns/` FR-020, `data-model.md` §6 — one synthetic
 * migration entry per declaring module, named after a digest of its
 * declarations, so it is pending exactly when they changed.
 */

const hosts = new Set(['x178_hosts', 'x178_other_hosts']);
const declare = (columns: Record<string, unknown>, host = 'x178_hosts') =>
  createColumnExtension({ host, module: 'acme_erp', columns }, hosts);

const base = declare({ erpCode: { type: 'varchar', length: 64, nullable: true } });

describe('schemaExtensionHash', () => {
  it('is twelve hex characters, stable for equal declarations', () => {
    const again = declare({ erpCode: { type: 'varchar', length: 64, nullable: true } });
    expect(schemaExtensionHash([base])).toMatch(/^[0-9a-f]{12}$/);
    expect(schemaExtensionHash([base])).toBe(schemaExtensionHash([again]));
  });

  it('changes when a key, a spec or a host changes — and not for key order or host order', () => {
    const h = schemaExtensionHash([base]);
    expect(schemaExtensionHash([declare({ erpCode: { type: 'varchar', length: 65, nullable: true } })])).not.toBe(h);
    expect(schemaExtensionHash([declare({ erpKey: { type: 'varchar', length: 64, nullable: true } })])).not.toBe(h);
    expect(
      schemaExtensionHash([declare({ erpCode: { type: 'varchar', length: 64, nullable: true } }, 'x178_other_hosts')]),
    ).not.toBe(h);
    const ab = declare({ a: { type: 'text', nullable: true }, b: { type: 'text', nullable: true } });
    const ba = declare({ b: { type: 'text', nullable: true }, a: { type: 'text', nullable: true } });
    expect(schemaExtensionHash([ab])).toBe(schemaExtensionHash([ba]));
    const other = declare({ x: { type: 'text', nullable: true } }, 'x178_other_hosts');
    expect(schemaExtensionHash([ab, other])).toBe(schemaExtensionHash([other, ab]));
  });

  it('does not change with adminReads, which is not schema', () => {
    const exposed = createColumnExtension(
      { host: 'x178_hosts', module: 'acme_erp', adminReads: true, columns: { erpCode: { type: 'varchar', length: 64, nullable: true } } },
      hosts,
    );
    expect(schemaExtensionHash([exposed])).toBe(schemaExtensionHash([base]));
  });
});

describe('schemaExtensionEntries', () => {
  it('names the entry Migration10000101T000000<Prefix>SchemaExtensions<hash12>, origin generated', () => {
    const [entry, ...rest] = schemaExtensionEntries([{ moduleId: 'acme_erp', version: '1.0.0', declarations: [base] }]);
    expect(rest).toEqual([]);
    expect(entry!.origin).toBe('generated');
    expect(entry!.moduleId).toBe('acme_erp');
    expect(entry!.cls.name).toBe(`Migration${SCHEMA_EXTENSION_STAMP}AcmeErpSchemaExtensions${schemaExtensionHash([base])}`);
    expect(schemaExtensionMigrationName('acme_erp', [base])).toBe(entry!.cls.name);
  });

  it('contributes nothing for a module that declares nothing', () => {
    expect(schemaExtensionEntries([{ moduleId: 'acme_erp', version: '1.0.0', declarations: [] }])).toEqual([]);
  });
});

describe('configuredMigrationsFrom — generated entries', () => {
  const contribution: PackageSchemaContribution = {
    id: 'acme_erp',
    packageName: '@acme/mod-acme-erp',
    version: '1.0.0',
    migrationsDirectory: null,
    migrations: [],
    entities: [],
    dependencies: ['fixture_host'],
    schemaExtensions: [base],
  };

  it('refuses a declaration on a host that is not rolled out (Phase A: all of them)', () => {
    expect(() =>
      configuredMigrationsFrom({
        coreEntries: [],
        coreModuleDependencies: new Map([['core', []], ['fixture_host', []]]),
        packages: [contribution],
      }),
    ).toThrow(/host-not-extensible/);
  });

  it('merges one generated entry per declaring module and reports its origin and ownership', () => {
    const configured = configuredMigrationsFrom({
      coreEntries: [],
      coreModuleDependencies: new Map([['core', []], ['fixture_host', []]]),
      packages: [contribution],
      extensibleHosts: new Map([['x178_hosts', { table: 'x178_hosts', ownerModuleId: 'fixture_host' }]]),
    });
    const name = schemaExtensionMigrationName('acme_erp', [base]);
    expect(configured.registered).toEqual([{ name, origin: 'generated' }]);
    expect(configured.ownership.migrationNamesFor('acme_erp')).toEqual([name]);
  });
});

/**
 * Review finding 4 — `x_<module>_<snake(key)>` is ambiguous across modules
 * (`acme` + `erpCode` and `acme_erp` + `code` are both `x_acme_erp_code`), so
 * discovery refuses a physical name another installed declaration already uses.
 */
describe('configuredMigrationsFrom — physical-name collisions between modules', () => {
  const hosts = new Set(['x178_hosts']);
  const pkg = (id: string, columns: Record<string, unknown>): PackageSchemaContribution => ({
    id,
    packageName: `@acme/${id}`,
    version: '1.0.0',
    migrationsDirectory: null,
    migrations: [],
    entities: [],
    dependencies: ['fixture_host'],
    schemaExtensions: [createColumnExtension({ host: 'x178_hosts', module: id, columns }, hosts)],
  });

  it('refuses two modules declaring the same physical column, naming both', () => {
    let thrown: unknown;
    try {
      configuredMigrationsFrom({
        coreEntries: [],
        coreModuleDependencies: new Map([['core', []], ['fixture_host', []]]),
        packages: [
          pkg('acme', { erpCode: { type: 'text', nullable: true } }),
          pkg('acme_erp', { code: { type: 'text', nullable: true } }),
        ],
        extensibleHosts: new Map([['x178_hosts', { table: 'x178_hosts', ownerModuleId: 'fixture_host' }]]),
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { rule?: string }).rule).toBe('physical-name-collision');
    expect(String((thrown as Error).message)).toMatch(/x_acme_erp_code.*acme.*acme_erp|x_acme_erp_code.*acme_erp.*acme/s);
  });
});
