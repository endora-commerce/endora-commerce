import { MikroORM } from '@mikro-orm/postgresql';
import {
  configuredMigrationsFrom,
  mikroOrmConfigFrom,
  type ConfiguredMigrations,
} from '@endora-commerce/platform/db';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';

import { configuredEntities } from '../../src/db/configured-entities.js';
import { coreModuleDependencies } from '../../src/db/configured-migrations.js';
import { MIGRATION_REGISTRY } from '../../src/db/migrations-registry.generated.js';
import { closureOf } from '../../scripts/lib/manifest-dependencies.js';

/**
 * A platform that composes **some** of this repository's modules, and the
 * migration order it computes — so a test can migrate the database an instance
 * that omits a module would have (issue #1033).
 *
 * The order is the platform's own: `configuredMigrationsFrom` over the committed
 * core registry narrowed to the composition, the live manifest graph and the
 * published baseline list. Baseline membership is by identity among the entries
 * present (`migration-order.ts`, step 2), so a module left out of the
 * composition takes its baseline migrations with it, exactly as it does in an
 * instance that never installed it.
 */

/** `roots`, everything their manifests depend on, transitively, and `core`. */
export function compositionOf(...roots: readonly string[]): ReadonlySet<string> {
  const dependencies = coreModuleDependencies();
  const modules = new Set<string>(['core']);
  for (const root of roots) {
    modules.add(root);
    for (const dependency of closureOf(root, dependencies)) modules.add(dependency);
  }
  return modules;
}

/** The migration order a platform composing exactly `modules` computes. */
export function compositionMigrations(modules: ReadonlySet<string>): ConfiguredMigrations {
  return configuredMigrationsFrom({
    coreEntries: MIGRATION_REGISTRY.filter((entry) => modules.has(entry.moduleId)),
    coreModuleDependencies: coreModuleDependencies(),
    packages: [],
    baseline: BASELINE_MIGRATIONS,
  });
}

/**
 * Apply every pending migration of the composition to the database at `url`,
 * and answer the names applied, in order.
 *
 * Run over a database that already holds a smaller composition, this is a late
 * install: only the arriving modules' migrations are pending.
 */
export async function migrateComposition(
  url: string,
  modules: ReadonlySet<string>,
): Promise<readonly string[]> {
  const orm = await MikroORM.init({
    ...mikroOrmConfigFrom({
      entities: await configuredEntities(),
      migrations: compositionMigrations(modules),
    }),
    clientUrl: url,
  });
  try {
    const applied = await orm.getMigrator().up();
    return applied.map((migration) => migration.name);
  } finally {
    await orm.close(true);
  }
}

/** Apply the named migrations, and nothing else, on an open ORM. */
export async function applyMigration(orm: MikroORM, name: string): Promise<void> {
  await orm.getMigrator().up({ migrations: [name] });
}
