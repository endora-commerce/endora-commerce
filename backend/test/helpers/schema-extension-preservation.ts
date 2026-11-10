import { MikroORM, type Options } from '@mikro-orm/postgresql';

/**
 * The core column-preservation walk (`specs/178-extensible-columns/` FR-080,
 * `contracts/preservation-test.md`).
 *
 * Applies a configured migration order to an empty database **one migration at
 * a time**. After each step, every extensible table that now exists and has not
 * been seeded yet receives the three fixture elements an extension would add —
 * a nullable column, a defaulted NOT NULL column and a nullable column with a
 * unique partial index — and every table seeded earlier is re-checked. A core
 * migration that rebuilds a host table without carrying its `x_*` columns
 * forward is reported naming the table, the element and the first migration
 * after which it was absent.
 *
 * It drives the migrator, so it lives here rather than in a test file: the
 * callers run it on a database of their own (`throwawayDatabase`), never on the
 * invocation's shared run database — the reason `test/migrator-driving-tests.ts`
 * exists — and that ledger's subject is test files calling the migrator on the
 * shared one.
 */

export interface PreservationFinding {
  readonly table: string;
  readonly element: string;
  /** The first migration after which the element was missing or changed. */
  readonly afterMigration: string;
}

export interface PreservationReport {
  /** table → the migration after which it was seeded (the one that created it). */
  readonly seededAfter: ReadonlyMap<string, string>;
  readonly findings: readonly PreservationFinding[];
  /** How many migrations were applied, one at a time. */
  readonly steps: number;
  readonly elapsedMs: number;
}

/** What an extension adds, as the preservation contract §2 spells it. */
const FIXTURE_COLUMNS = [
  { name: 'x_fixture_note', dataType: 'text', nullable: true, defaultPrefix: null },
  { name: 'x_fixture_flag', dataType: 'boolean', nullable: false, defaultPrefix: 'false' },
  { name: 'x_fixture_code', dataType: 'character varying', nullable: true, defaultPrefix: null },
] as const;

const fixtureIndexName = (table: string): string => `${table}_x_fixture_code_uq`.slice(0, 63);

function seedSql(table: string): string[] {
  return [
    `alter table "${table}" add column "x_fixture_note" text null, ` +
      `add column "x_fixture_flag" boolean not null default false, ` +
      `add column "x_fixture_code" varchar(32) null`,
    `create unique index "${fixtureIndexName(table)}" on "${table}" ("x_fixture_code") ` +
      `where "x_fixture_code" is not null`,
  ];
}

interface CatalogRow {
  readonly kind: 'table' | 'column' | 'index';
  readonly table_name: string;
  readonly name: string;
  readonly data_type: string | null;
  readonly is_nullable: string | null;
  readonly column_default: string | null;
}

/**
 * One catalog round trip per step: which hosts exist, their fixture columns and
 * their fixture index (contract §"Cost budget").
 */
const CATALOG_SQL = `
  select 'table' as kind, t.table_name, t.table_name as name, null as data_type, null as is_nullable, null as column_default
    from information_schema.tables t
   where t.table_schema = current_schema() and t.table_name in (?)
  union all
  select 'column', c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
    from information_schema.columns c
   where c.table_schema = current_schema() and c.table_name in (?) and c.column_name like 'x\\_fixture\\_%'
  union all
  select 'index', i.tablename, i.indexname, null, null, i.indexdef
    from pg_indexes i
   where i.schemaname = current_schema() and i.tablename in (?) and i.indexname like '%x\\_fixture\\_code\\_uq'`;

function missingElements(table: string, rows: readonly CatalogRow[]): string[] {
  const missing: string[] = [];
  for (const column of FIXTURE_COLUMNS) {
    const row = rows.find((r) => r.kind === 'column' && r.table_name === table && r.name === column.name);
    if (row === undefined) {
      missing.push(`column ${column.name}`);
      continue;
    }
    if (row.data_type !== column.dataType) missing.push(`column ${column.name} type (${row.data_type})`);
    if ((row.is_nullable === 'YES') !== column.nullable) missing.push(`column ${column.name} nullability`);
    if (column.defaultPrefix !== null && !(row.column_default ?? '').startsWith(column.defaultPrefix)) {
      missing.push(`column ${column.name} default (${row.column_default ?? 'none'})`);
    }
  }
  const index = rows.find((r) => r.kind === 'index' && r.table_name === table);
  if (index === undefined) missing.push(`index ${fixtureIndexName(table)}`);
  else if (!/unique/i.test(index.column_default ?? '') || !/where/i.test(index.column_default ?? '')) {
    missing.push(`index ${fixtureIndexName(table)} shape`);
  }
  return missing;
}

/**
 * Walk `config`'s migration order on the empty database `url`, seeding and
 * re-checking `hosts`. Opens and closes its own ORM.
 */
export async function walkPreservation(input: {
  readonly url: string;
  readonly config: Options;
  readonly hosts: readonly string[];
}): Promise<PreservationReport> {
  const started = Date.now();
  const orm = await MikroORM.init({ ...input.config, clientUrl: input.url, debug: false });
  const seededAfter = new Map<string, string>();
  const findings: PreservationFinding[] = [];
  const reported = new Set<string>();
  let steps = 0;
  try {
    const migrator = orm.getMigrator();
    const connection = orm.em.getConnection();
    const pending = (await migrator.getPendingMigrations()).map((migration) => migration.name);
    const hosts = [...input.hosts];
    for (const name of pending) {
      await migrator.up({ migrations: [name] });
      steps += 1;
      const rows = (await connection.execute(CATALOG_SQL, [hosts, hosts, hosts], 'all')) as CatalogRow[];
      for (const table of hosts) {
        const exists = rows.some((row) => row.kind === 'table' && row.table_name === table);
        if (!seededAfter.has(table)) {
          if (!exists) continue;
          for (const sql of seedSql(table)) await connection.execute(sql);
          seededAfter.set(table, name);
          continue;
        }
        const missing = exists ? missingElements(table, rows) : ['table'];
        for (const element of missing) {
          const key = `${table}:${element}`;
          if (reported.has(key)) continue;
          reported.add(key);
          findings.push({ table, element, afterMigration: name });
        }
      }
    }
  } finally {
    await orm.close(true);
  }
  return { seededAfter, findings, steps, elapsedMs: Date.now() - started };
}

/** One line per finding, for an assertion message. */
export function describeFindings(findings: readonly PreservationFinding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.table}: ${finding.element} is gone after ${finding.afterMigration} — a core migration ` +
        `rebuilt an extensible table without carrying its x_* columns forward`,
    )
    .join('\n');
}
