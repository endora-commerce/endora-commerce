import type { MikroORM } from '@mikro-orm/postgresql';
import type { UmzugMigration } from '@mikro-orm/migrations';
import {
  activeSchemaExtensionContext,
  type SchemaExtensionContext,
} from '../kernel/schema-extensions/registry.js';
import { GENERATED_STAMP } from './migration-order.js';
import { verifySchemaExtensions, type SchemaExtensionExec } from './schema-extension-verifier.js';
import { platformLogger } from '../kernel/logging.js';

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
 * Two bounded writes beyond the migrations themselves (D-291), both inside the
 * same transaction as `up` and the verifier, so a failed run takes them back:
 *
 *   - **R-A4** — a history row is pruned only when its name carries the reserved
 *     generated stamp **and** is not in the current migration list; each pruned
 *     name is logged at `info`. No other row is ever touched.
 *   - **R-A5** — the `applied` ledger rows of a module with **no discovered
 *     declaration at all** (a package removed without `uninstall --hard`) become
 *     `orphaned`, so `module:schema-extensions drop` can clean up after it. A
 *     module that still declares something is left to its generated step. Boot
 *     stays read-only: the verifier only warns (FR-026).
 *
 * With no declaration and nothing of the kind to clean up it is a bare
 * `migrator.up()`: a deployment that declares nothing migrates exactly as it did
 * before the feature.
 */
export async function migrateUpVerified(
  orm: MikroORM,
  context: SchemaExtensionContext = activeSchemaExtensionContext(),
  log?: (message: string) => void,
  info: (message: string) => void = (message) => platformLogger().info({ scope: 'schema-extensions' }, message),
): Promise<UmzugMigration[]> {
  const migrator = orm.getMigrator();
  const connection = orm.em.getConnection();
  const migrationsTable = (orm.config.get('migrations').tableName ?? 'mikro_orm_migrations').replace(/"/g, '');
  const current = (orm.config.get('migrations').migrationsList ?? [])
    .map((migration) => migration.name)
    .filter((name) => name.startsWith(`Migration${GENERATED_STAMP}`));
  const declaringModules = [...new Set(context.declarations.map((declaration) => declaration.module))];
  const exec = (trx?: unknown): SchemaExtensionExec => (sql, params = []) =>
    connection.execute(sql, params, 'all', trx as never) as Promise<Record<string, unknown>[]>;

  // D-291 R-A4 — the only rows of the history this may delete: the reserved
  // stamp (which `orderMigrations` refuses on anything not generated, so no
  // author can write one) **and** not in the current migration list.
  const keep = current.length === 0 ? '' : ` and name not in (${current.map(() => '?').join(', ')})`;
  const staleSql = `select name from "${migrationsTable}" where name like ?${keep} order by name`;
  const staleParams = [`Migration${GENERATED_STAMP}%`, ...current];
  // D-291 R-A5 — applied ledger rows of a module with no discovered declaration.
  const vanishedWhere =
    `status = 'applied'` +
    (declaringModules.length === 0 ? '' : ` and module_id not in (${declaringModules.map(() => '?').join(', ')})`);

  if (context.declarations.length === 0) {
    // Nothing declared: a bare `up()`, exactly as before the feature — unless
    // the database remembers a generated step or applied ledger rows of a
    // package that has since gone, which this run must clean up.
    const [state] = (await exec()(
      `select to_regclass(?) is not null as history, to_regclass('schema_extensions') is not null as ledger`,
      [migrationsTable],
    )) as { history: boolean; ledger: boolean }[];
    const stale = state?.history ? await exec()(staleSql, staleParams) : [];
    const vanished = state?.ledger
      ? await exec()(`select 1 from schema_extensions where ${vanishedWhere} limit 1`, declaringModules)
      : [];
    if (stale.length === 0 && vanished.length === 0) return migrator.up();
  }

  return connection.transactional(async (trx) => {
    const run = exec(trx);
    const [exists] = (await run(`select to_regclass(?) as present`, [migrationsTable])) as {
      present: string | null;
    }[];
    if (exists?.present != null) {
      const stale = ((await run(staleSql, staleParams)) as { name: string }[]).map((row) => row.name);
      for (const name of stale) {
        await run(`delete from "${migrationsTable}" where name = ?`, [name]);
        info(`[schema-extensions] pruned stale generated step ${name} from ${migrationsTable} (D-291 R-A4)`);
      }
    }
    const applied = await migrator.up({ transaction: trx });
    const [ledger] = (await run(`select to_regclass('schema_extensions') as present`)) as {
      present: string | null;
    }[];
    if (ledger?.present != null) {
      const orphaned = (await run(
        `update schema_extensions set status = 'orphaned', orphaned_at = now() where ${vanishedWhere} ` +
          `returning module_id, physical_name`,
        declaringModules,
      )) as { module_id: string; physical_name: string }[];
      for (const row of orphaned) {
        info(
          `[schema-extensions] ${row.module_id} declares nothing any more: ${row.physical_name} is orphaned ` +
            `(drop it with module:schema-extensions drop ${row.module_id} --confirm)`,
        );
      }
    }
    await verifySchemaExtensions(run, context, log);
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
