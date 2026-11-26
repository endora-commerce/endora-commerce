import { MikroORM } from '@mikro-orm/postgresql';
import { Client } from 'pg';
import {
  PLATFORM_MIGRATION_ENTRIES,
  committedModuleDependencies,
  configuredMigrationsFrom,
  mikroOrmConfigFrom,
  requiredModulesOf,
  type MigrationRegistryEntry,
} from '@endora-commerce/platform/db';
import {
  BASE_DATABASE_URL_ENV,
  cloneTemplateForCaller,
  dropRunDatabase,
  TEMPLATE_DATABASE_ENV,
} from '@endora-commerce/test-kit/database';

import { configuredEntities } from '../../src/db/configured-entities.js';
import { ENTITY_OWNERS } from '../../src/db/entities-registry.generated.js';
import { MIGRATION_REGISTRY } from '../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';
// The fixture's published files, by path — see the note on module instances below.
import * as acmeLinksBackend from '../fixtures/installed-packages/mod-acme-links/lib/backend/index.js';
import { manifest as acmeLinksManifest } from '../fixtures/installed-packages/mod-acme-links/lib/manifest.js';
import { migrations as acmeLinksMigrations } from '../fixtures/installed-packages/mod-acme-links/lib/migrations/index.js';

/**
 * The side-table fixture `mod-acme-links` as one installed package over a clone
 * of the invocation's migrated template (`specs/187-side-table-extensions/`
 * T016, T017).
 *
 * The configuration is the platform's real one — `configuredMigrationsFrom`
 * over this repository's committed registries plus the package's contribution,
 * then `mikroOrmConfigFrom` with the committed `ENTITY_OWNERS` — so the
 * declarations, the metadata rules, the foreign-schema guard around the
 * package's migration and the verifier are exactly what an instance gets. The
 * contribution is assembled from the fixture's `lib/` here rather than found by
 * a `node_modules` scan, for one reason: under vitest a module found under
 * `node_modules` is imported natively, so its `@endora-commerce/platform/tenancy`
 * would be a **second** instance of the classification registry beside the one
 * this process's platform reads, and its entities would arrive unclassified.
 * Nothing in production has two instances. That the scan reads a package's
 * `extends` is held by `test/unit/db/entity-extension-package-discovery.test.ts`.
 *
 * The database is never the invocation's shared run database: the fixture's
 * tables must not leak into the files beside this one. Nothing is migrated here;
 * the caller drives `migrateUpVerified`, because what the run does is the subject.
 */

export interface AcmeLinksInstance {
  readonly databaseUrl: string;
  readonly orm: MikroORM;
  /** A query on a connection of its own — outside every ORM transaction. */
  readonly query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  /** Close the ORM and drop the database. */
  readonly dispose: () => Promise<void>;
}

function acmeLinksContribution() {
  return {
    id: acmeLinksManifest.id,
    packageName: '@acme/mod-acme-links',
    version: acmeLinksManifest.version,
    migrationsDirectory: null,
    migrations: acmeLinksMigrations.map(
      (entry): MigrationRegistryEntry => ({ moduleId: acmeLinksManifest.id, cls: entry.class as never, origin: 'external' }),
    ),
    entities: acmeLinksBackend.entities,
    dependencies: acmeLinksManifest.dependencies,
    schemaExtensions: [],
    entityExtensions: acmeLinksManifest.extends,
  };
}

/**
 * Who ships the module: an installed package (the default) or a deployment's
 * overlay module (`specs/190-overlay-full-modules/` #1850), contributed to the
 * merge as overlay discovery contributes one — its migration tagged `overlay`,
 * no first-party exemption. OR-5: nothing downstream may differ but the origin.
 */
export type AcmeLinksDeclarer = 'package' | 'overlay';

function acmeLinksOverlayContribution() {
  const contribution = acmeLinksContribution();
  return {
    id: contribution.id,
    source: `overlay apps/fixture/modules/${contribution.id}`,
    version: contribution.version,
    migrationsDirectory: null,
    migrations: contribution.migrations.map((entry) => ({ ...entry, origin: 'overlay' as const })),
    entities: contribution.entities,
    dependencies: contribution.dependencies,
    nonDeactivatable: false,
    schemaExtensions: [],
    entityExtensions: contribution.entityExtensions,
  };
}

export async function openAcmeLinksInstance(declarer: AcmeLinksDeclarer = 'package'): Promise<AcmeLinksInstance> {
  const baseUrl = process.env[BASE_DATABASE_URL_ENV];
  const template = process.env[TEMPLATE_DATABASE_ENV];
  if (!baseUrl || !template) {
    throw new Error(
      `acme-links-instance: ${BASE_DATABASE_URL_ENV}/${TEMPLATE_DATABASE_ENV} are not set, so there is no ` +
        `migrated template to clone; run under the backend vitest configuration.`,
    );
  }
  const clone = await cloneTemplateForCaller(baseUrl, template);
  let orm: MikroORM | undefined;
  const dispose = async (): Promise<void> => {
    try {
      if (orm) await orm.close(true);
    } finally {
      await dropRunDatabase(baseUrl, clone.name, () => {});
    }
  };
  try {
    const platformEntries = PLATFORM_MIGRATION_ENTRIES.filter(
      (entry) => !MIGRATION_REGISTRY.some((core) => core.cls === entry.cls),
    );
    const migrations = configuredMigrationsFrom({
      coreEntries: [...MIGRATION_REGISTRY, ...platformEntries],
      coreModuleDependencies: committedModuleDependencies(DISCOVERED_MANIFESTS),
      packages: declarer === 'package' ? [acmeLinksContribution()] : [],
      overlays: declarer === 'overlay' ? [acmeLinksOverlayContribution()] : [],
      requiredModules: requiredModulesOf(DISCOVERED_MANIFESTS),
      coreEntityExtensions: DISCOVERED_MANIFESTS.map((entry) => ({
        moduleId: entry.id,
        origin: 'core' as const,
        dependencies: entry.manifest.dependencies ?? [],
        extends: entry.manifest.extends,
      })),
    });
    const config = mikroOrmConfigFrom({
      entities: [...(await configuredEntities()), ...acmeLinksBackend.entities],
      migrations,
      coreEntityOwners: ENTITY_OWNERS,
    });
    orm = await MikroORM.init({ ...config, clientUrl: clone.url });
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    databaseUrl: clone.url,
    orm,
    query: async (sql, params = []) => {
      const client = new Client({ connectionString: clone.url });
      await client.connect();
      try {
        return (await client.query(sql, params)).rows;
      } finally {
        await client.end();
      }
    },
    dispose,
  };
}
