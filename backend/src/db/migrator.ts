import type { MikroORM } from '@mikro-orm/postgresql';
import type { IMigrator } from '@mikro-orm/core';
import { applyLegacyMigrationRenames } from './legacy-migration-rename.js';

/**
 * The single sanctioned way application and test code obtains a migrator.
 *
 * It runs the legacy-name pre-flight once per ORM instance — before anything
 * can compute pending work — so a database migrated under the pre-feature-065
 * naming scheme is never asked to re-run its 112 applied migrations.
 *
 * An ESLint `no-restricted-syntax` rule fails the build on any other
 * `.getMigrator(` call site. Contract:
 * specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md §4.
 */

const prepared = new WeakSet<MikroORM>();

export async function getMigrator(orm: MikroORM): Promise<IMigrator> {
  if (!prepared.has(orm)) {
    const result = await applyLegacyMigrationRenames(orm);
    if (!result.skipped) {
      process.stdout.write(
        `[migrations] legacy name pre-flight: renamed ${result.renamed} row(s)\n`,
      );
    }
    for (const name of result.unknown) {
      process.stdout.write(
        `[migrations] warning: unrecognized executed migration "${name}" — left untouched\n`,
      );
    }
    prepared.add(orm);
  }
  return orm.getMigrator();
}
