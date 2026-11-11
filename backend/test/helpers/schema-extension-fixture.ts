import { randomBytes } from 'node:crypto';

import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Migration } from '@mikro-orm/migrations';
import { MikroORM, type Options } from '@mikro-orm/postgresql';
import { Client } from 'pg';
import {
  PLATFORM_ENTITIES,
  PLATFORM_MIGRATION_ENTRIES,
  configuredMigrationsFrom,
  createColumnExtension,
  mikroOrmConfigFrom,
  type ExtensibleHostSet,
} from '@endora-commerce/platform/db';
import type { ColumnExtension } from '@endora-commerce/platform/kernel';
import { SchemaExtensionElement } from '@endora-commerce/platform/composition';
import { GlobalEntity, OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * A throwaway platform for the declared-extension integration tests
 * (`specs/178-extensible-columns/` tasks.md T020 – T029).
 *
 * Phase A rolls out no real host, so the mechanism is proved over a host table
 * of a fixture module that owns it: `fixture_host` creates `x178_hosts` (global)
 * and `x178_org_hosts` (org-scoped), and the declaring module `acme_erp`
 * depends on it. Each test builds a database of its own on the run's server and
 * opens an ORM through the platform's real configuration path —
 * `configuredMigrationsFrom` and `mikroOrmConfigFrom` — with the throwaway host
 * set passed where production passes the rolled-out one.
 */

export const FIXTURE_HOST_MODULE = 'fixture_host';
export const DECLARING_MODULE = 'acme_erp';
export const HOST_TABLE = 'x178_hosts';
export const ORG_HOST_TABLE = 'x178_org_hosts';

@GlobalEntity()
@Entity({ tableName: HOST_TABLE })
export class X178Host {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'text' })
  name!: string;
}

@OrgScoped()
@Entity({ tableName: ORG_HOST_TABLE })
export class X178OrgHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'text' })
  name!: string;
}

export class Migration20261110T000001FixtureHostInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "x178_hosts" ("id" uuid primary key, "name" text not null);`);
    this.addSql(
      `create table "x178_org_hosts" ("id" uuid primary key, "organization_id" uuid not null, "name" text not null);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "x178_org_hosts";`);
    this.addSql(`drop table if exists "x178_hosts";`);
  }
}

export const FIXTURE_HOSTS: ExtensibleHostSet = new Map([
  [HOST_TABLE, { table: HOST_TABLE, ownerModuleId: FIXTURE_HOST_MODULE }],
  [ORG_HOST_TABLE, { table: ORG_HOST_TABLE, ownerModuleId: FIXTURE_HOST_MODULE }],
]);

/** A declaration on a fixture host — the platform's own seam, since no real host is rolled out. */
export function declare(input: {
  readonly host?: string;
  readonly adminReads?: boolean;
  readonly columns: Record<string, unknown>;
}): ColumnExtension {
  return createColumnExtension(
    { host: input.host ?? HOST_TABLE, module: DECLARING_MODULE, adminReads: input.adminReads ?? false, columns: input.columns },
    new Set(FIXTURE_HOSTS.keys()),
  );
}

function serverUrl(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error('schema-extension fixture: DATABASE_URL is not set, so there is no server to use.');
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

async function admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: serverUrl('postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface ThrowawayDatabase {
  readonly url: string;
  readonly query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  readonly drop: () => Promise<void>;
}

/** An empty database of the caller's own, dropped by `drop()`. */
export async function throwawayDatabase(prefix = 'x178'): Promise<ThrowawayDatabase> {
  const name = `${prefix}_${randomBytes(4).toString('hex')}_test`;
  await admin((client) => client.query(`create database "${name}"`));
  const url = serverUrl(name);
  return {
    url,
    query: async (sql, params = []) => {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        return (await client.query(sql, params)).rows;
      } finally {
        await client.end();
      }
    },
    drop: () => admin((client) => client.query(`drop database if exists "${name}" with (force)`)).then(() => {}),
  };
}

/** The platform's ORM configuration over the fixture, for one declaration set. */
export interface FixtureOptions {
  readonly debug?: boolean;
  readonly logger?: (message: string) => void;
  /** More `fixture_host` migrations — a host release that rebuilds its table, say. */
  readonly hostMigrations?: readonly (new (...args: never[]) => Migration)[];
  /**
   * Every platform migration and entity rather than the ledger alone — what the
   * lifecycle orchestrator needs (registrations, settings, the audit log).
   */
  readonly platform?: boolean;
  /**
   * Migrations the declaring package itself ships, tagged `external` as package
   * discovery tags them — so the foreign-schema guard wraps them
   * (`specs/178-extensible-columns/` FR-070).
   */
  readonly packageMigrations?: readonly (new (...args: never[]) => Migration)[];
}

export function fixtureConfig(
  url: string,
  declarations: readonly ColumnExtension[],
  options: FixtureOptions = {},
): Options {
  const packageMigrations = options.packageMigrations ?? [];
  const packages =
    declarations.length === 0 && packageMigrations.length === 0
      ? []
      : [
          {
            id: DECLARING_MODULE,
            packageName: '@acme/mod-acme-erp',
            version: '1.0.0',
            migrationsDirectory: null,
            migrations: packageMigrations.map((cls) => ({
              moduleId: DECLARING_MODULE,
              cls: cls as never,
              origin: 'external' as const,
            })),
            entities: [],
            dependencies: [FIXTURE_HOST_MODULE],
            schemaExtensions: declarations,
          },
        ];
  const migrations = configuredMigrationsFrom({
    coreEntries: [
      ...(options.platform
        ? PLATFORM_MIGRATION_ENTRIES
        : PLATFORM_MIGRATION_ENTRIES.filter((entry) => entry.cls.name.endsWith('CoreSchemaExtensionsLedger'))),
      { moduleId: FIXTURE_HOST_MODULE, cls: Migration20261110T000001FixtureHostInit as never },
      ...(options.hostMigrations ?? []).map((cls) => ({ moduleId: FIXTURE_HOST_MODULE, cls: cls as never })),
    ],
    coreModuleDependencies: new Map([
      ['core', []],
      [FIXTURE_HOST_MODULE, []],
      [DECLARING_MODULE, [FIXTURE_HOST_MODULE]],
    ]),
    packages,
    baseline: [],
    extensibleHosts: FIXTURE_HOSTS,
  });
  const config = mikroOrmConfigFrom({
    entities: options.platform
      ? [...PLATFORM_ENTITIES, X178Host, X178OrgHost]
      : [SchemaExtensionElement, X178Host, X178OrgHost],
    migrations,
    extensibleHosts: FIXTURE_HOSTS,
  });
  return {
    ...config,
    clientUrl: url,
    ...(options.debug ? { debug: true, logger: options.logger ?? (() => {}) } : {}),
  };
}

/** Open the fixture ORM for `declarations`; the caller closes it. */
export async function openFixtureOrm(
  url: string,
  declarations: readonly ColumnExtension[],
  options: FixtureOptions = {},
): Promise<MikroORM> {
  return MikroORM.init(fixtureConfig(url, declarations, options));
}

/** The ownership the fixture configuration computed — what the orchestrator reverts by. */
export function fixtureMigrations(declarations: readonly ColumnExtension[], options: FixtureOptions = {}) {
  return (fixtureConfig('postgresql://unused/unused', declarations, options).migrations?.migrationsList ?? []).map(
    (migration) => migration.name,
  );
}

/**
 * Revert one migration on the fixture ORM — a declaring module's hard uninstall,
 * in miniature.
 *
 * The schema-extension tests drive the migrator on a **database of their own**
 * ({@link throwawayDatabase}), never on the invocation's shared run database, so
 * they are outside `test/migrator-driving-tests.ts`' subject: that ledger
 * contains files that would otherwise mutate the schema every other file shares.
 * It is spelled here, once, rather than in each test file for that reason.
 */
export async function revertMigration(orm: MikroORM, name: string): Promise<void> {
  await orm.getMigrator().down({ migrations: [name] });
}
