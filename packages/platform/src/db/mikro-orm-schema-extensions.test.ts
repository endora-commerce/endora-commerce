import { Entity, PrimaryKey } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';
import { GlobalEntity } from '../tenancy/org-scoped.decorator.js';
import { createColumnExtension } from '../kernel/schema-extensions/define.js';
import { SchemaExtensionInvalidError } from '../kernel/schema-extensions/errors.js';
import { activeSchemaExtensions } from '../kernel/schema-extensions/registry.js';
import { migrationOwnershipOf, type ConfiguredMigrations } from './configured-migrations.js';
import { mikroOrmConfigFrom } from './mikro-orm.config.js';
import type { PackageSchemaContribution } from '../packages/package-runtime.js';

/**
 * `specs/178-extensible-columns/` FR-030, FR-031 (tasks.md T016) — the one place
 * the platform builds its ORM configuration always sets the discovery pair, and
 * appends a projection for every declaration an installed package contributes.
 */

@GlobalEntity()
@Entity({ tableName: 'x178_config_hosts' })
class X178ConfigHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

const hosts = new Map([['x178_config_hosts', { table: 'x178_config_hosts', ownerModuleId: 'fixture_host' }]]);
const declaration = createColumnExtension(
  { host: 'x178_config_hosts', module: 'acme_erp', columns: { note: { type: 'text', nullable: true } } },
  new Set(hosts.keys()),
);

function migrationsWith(packages: readonly PackageSchemaContribution[]): ConfiguredMigrations {
  return {
    migrations: [],
    registered: [],
    names: [],
    diagnostics: [],
    ownership: migrationOwnershipOf([], []),
    packages,
  };
}

const acmePackage: PackageSchemaContribution = {
  id: 'acme_erp',
  packageName: '@acme/mod-acme-erp',
  version: '1.0.0',
  migrationsDirectory: null,
  migrations: [],
  entities: [],
  dependencies: ['fixture_host'],
  schemaExtensions: [declaration],
};

describe('mikroOrmConfigFrom — schema extensions', () => {
  it('always sets the discovery pair, even with no declaration', () => {
    const config = mikroOrmConfigFrom({ entities: [X178ConfigHost], migrations: migrationsWith([]) });
    expect(config.discovery?.checkDuplicateTableNames).toBe(false);
    expect(typeof config.discovery?.afterDiscovered).toBe('function');
    expect(config.entities).toEqual([X178ConfigHost]);
  });

  it('refuses a declaration on a host that is not rolled out (Phase A: every host)', () => {
    expect(() =>
      mikroOrmConfigFrom({ entities: [X178ConfigHost], migrations: migrationsWith([acmePackage]) }),
    ).toThrow(SchemaExtensionInvalidError);
  });

  it('appends one projection per declaration on a rolled-out host', () => {
    const config = mikroOrmConfigFrom({
      entities: [X178ConfigHost],
      migrations: migrationsWith([acmePackage]),
      extensibleHosts: hosts,
    });
    expect(config.entities).toHaveLength(2);
    expect(activeSchemaExtensions()).toEqual([declaration]);
  });
});
