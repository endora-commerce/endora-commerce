import type { MikroORM } from '@mikro-orm/postgresql';
import type { UmzugMigration } from '@mikro-orm/migrations';
import {
  activeSchemaExtensionContext,
  type SchemaExtensionContext,
} from '../kernel/schema-extensions/registry.js';
import { GENERATED_STAMP } from './migration-order.js';
import { verifySchemaExtensions, type SchemaExtensionExec } from './schema-extension-verifier.js';

/**
 * `migrate up`, verified (`specs/178-extensible-columns/` FR-025, research R-6).
 *
 * With declared extension columns, the run is one explicit transaction: the
 * pending migrations apply on it, then the verifier holds the physical schema to
 * the declarations **on the same transaction**, so a core migration that loses a
 * declared column in this run rolls the whole run back instead of committing.
 *
 * Before the run, the migration history forgets every generated
 * schema-extension step that is not the current one. The step is named after a
 * digest of the module's declarations, so a module that goes back to a
 * declaration set it had before (A → B → A) would otherwise find A recorded as
 * executed and never reconcile B's removal. The pruned rows name steps that are
 * no longer in the migration list — which umzug already ignores — so nothing
 * that is still a migration of this platform is forgotten.
 *
 * With no declaration it is a bare `migrator.up()`: a deployment that declares
 * nothing migrates exactly as it did before the feature.
 */
export async function migrateUpVerified(
  orm: MikroORM,
  context: SchemaExtensionContext = activeSchemaExtensionContext(),
  log?: (message: string) => void,
): Promise<UmzugMigration[]> {
  const migrator = orm.getMigrator();
  if (context.declarations.length === 0) return migrator.up();

  const connection = orm.em.getConnection();
  const migrationsTable = orm.config.get('migrations').tableName ?? 'mikro_orm_migrations';
  const current = (orm.config.get('migrations').migrationsList ?? [])
    .map((migration) => migration.name)
    .filter((name) => name.startsWith(`Migration${GENERATED_STAMP}`));
  return connection.transactional(async (trx) => {
    const exec: SchemaExtensionExec = (sql, params = []) =>
      connection.execute(sql, params, 'all', trx) as Promise<Record<string, unknown>[]>;
    const [exists] = (await exec(`select to_regclass(?) as present`, [migrationsTable])) as {
      present: string | null;
    }[];
    if (exists?.present != null) {
      const keep = current.length === 0 ? '' : ` and name not in (${current.map(() => '?').join(', ')})`;
      await exec(
        `delete from "${migrationsTable.replace(/"/g, '')}" where name like ?${keep}`,
        [`Migration${GENERATED_STAMP}%`, ...current],
      );
    }
    const applied = await migrator.up({ transaction: trx });
    await verifySchemaExtensions(exec, context, log);
    return applied;
  });
}

/**
 * The four migration verbs, as a function of an open ORM.
 *
 * The **entry point** stays in the application — `backend/src/db/migrate.ts`,
 * which `db:fresh`, `migration:up`, `migration:down` and `migration:pending`
 * spawn and which production runs as `node dist/db/migrate.js up`. That split is
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` §1.1's, one
 * surface over: a path a `package.json` script names is an operator-facing
 * address, so it stays where the operator's documentation says it is, while the
 * verbs behind it are the platform's and every instance runs the same four.
 *
 * It writes to injected streams and returns an exit code rather than calling
 * `process.exit`, so the entry point owns the process and this owns the work.
 */
export interface MigrationCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export async function runMigrationCommand(
  orm: MikroORM,
  command: string,
  io: MigrationCommandIo,
): Promise<number> {
  const migrator = orm.getMigrator();

  switch (command) {
    case 'up': {
      const applied = await migrateUpVerified(orm);
      io.out(`applied ${applied.length} migration(s)\n`);
      for (const m of applied) io.out(`  + ${m.name}\n`);
      return 0;
    }
    case 'down': {
      const reverted = await migrator.down();
      io.out(`reverted ${reverted.length} migration(s)\n`);
      for (const m of reverted) io.out(`  - ${m.name}\n`);
      return 0;
    }
    case 'pending': {
      const pending = await migrator.getPendingMigrations();
      if (pending.length === 0) {
        io.out('no pending migrations\n');
      } else {
        for (const m of pending) io.out(`  ~ ${m.name}\n`);
      }
      return 0;
    }
    case 'fresh': {
      // Drop the entire schema by name rather than relying on
      // `dropSchema()`, which only removes tables present in the current
      // entity metadata. Tables that exist in the DB but are no longer (or
      // not yet) reflected in metadata — e.g. pivot tables — would survive
      // that path and make Migration001 fail with "relation already exists".
      // A raw `DROP SCHEMA ... CASCADE` guarantees a clean slate.
      const conn = orm.em.getConnection();
      await conn.execute('drop schema public cascade; create schema public;');
      const applied = await migrateUpVerified(orm);
      io.out(`dropped and re-applied ${applied.length} migration(s)\n`);
      return 0;
    }
    default: {
      io.err(`unknown command: ${command}\n`);
      return 1;
    }
  }
}
