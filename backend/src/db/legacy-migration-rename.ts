import type { MikroORM } from '@mikro-orm/postgresql';
import { LEGACY_MIGRATION_RENAMES } from './legacy-migration-names.js';

/**
 * Pre-flight that rewrites `mikro_orm_migrations.name` from the pre-feature-065
 * legacy migration names to the current timestamped ones.
 *
 * Without it, a deployed database would see all 112 renamed migrations as
 * pending and re-run them against populated tables: umzug computes
 * `pending = list.filter(name ∉ executed)` and silently ignores executed names
 * it does not recognize.
 *
 * Contract: specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md §3.
 * It is invoked only through `getMigrator(orm)` in ./migrator.ts.
 */

export interface LegacyRenameResult {
  /** Rows whose `name` was rewritten by this invocation. */
  renamed: number;
  /** Executed-migration names matching neither a legacy nor a current migration. */
  unknown: string[];
  /** True when the migrations table did not exist (fresh database). */
  skipped: boolean;
}

/** The bookkeeping table's identity, taken from the ORM's own configuration. */
function resolveTable(orm: MikroORM): { schema: string; table: string } {
  const configured = orm.config.get('migrations').tableName ?? 'mikro_orm_migrations';
  const separator = configured.indexOf('.');
  if (separator >= 0) {
    return {
      schema: configured.slice(0, separator),
      table: configured.slice(separator + 1),
    };
  }
  return { schema: orm.config.get('schema') ?? 'public', table: configured };
}

/** Migration names this build knows about — the registry plus the new legacy names. */
function knownNames(orm: MikroORM): Set<string> {
  const known = new Set<string>();
  for (const entry of orm.config.get('migrations').migrationsList ?? []) {
    if (typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
      known.add(entry.name);
    }
  }
  for (const rename of LEGACY_MIGRATION_RENAMES) known.add(rename.name);
  return known;
}

export async function applyLegacyMigrationRenames(orm: MikroORM): Promise<LegacyRenameResult> {
  const { schema, table } = resolveTable(orm);
  const connection = orm.em.getConnection();
  const qualified = `"${schema}"."${table}"`;

  const existence = await connection.execute<{ reg: string | null }[]>(
    'select to_regclass(?) as reg',
    [`${schema}.${table}`],
  );
  if (!existence[0]?.reg) {
    return { renamed: 0, unknown: [], skipped: true };
  }

  // One guarded, parameterized statement. The `.ts`/`.js` variants are matched
  // because MikroORM's own `unlogMigration` deletes all three forms, so
  // suffixed rows exist in the wild. The `not exists` guard is required because
  // `name` carries no unique index — a second run must not duplicate a row.
  const params: string[] = [];
  const tuples = LEGACY_MIGRATION_RENAMES.map((rename) => {
    params.push(rename.legacyName, rename.name);
    return '(?, ?)';
  }).join(', ');

  const updated = await connection.execute<{ name: string }[]>(
    `update ${qualified} m
        set "name" = r.new_name
       from (values ${tuples}) as r(old_name, new_name)
      where m."name" in (r.old_name, r.old_name || '.ts', r.old_name || '.js')
        and not exists (select 1 from ${qualified} x where x."name" = r.new_name)
      returning m."name"`,
    params,
  );

  const known = knownNames(orm);
  const rows = await connection.execute<{ name: string }[]>(
    `select "name" from ${qualified} order by "id"`,
  );
  const unknown = rows.map((row) => row.name).filter((name) => !known.has(name));

  return { renamed: updated.length, unknown, skipped: false };
}
