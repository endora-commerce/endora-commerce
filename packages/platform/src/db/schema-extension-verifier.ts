import { resolvedColumnExtension } from '../kernel/schema-extensions/define.js';
import {
  SchemaExtensionDriftError,
  type SchemaExtensionDrift,
} from '../kernel/schema-extensions/errors.js';
import type { SchemaExtensionContext } from '../kernel/schema-extensions/registry.js';
import {
  columnMismatch,
  columnsQuery,
  declaredElements,
  indexMismatch,
  indexesQuery,
  type DeclaredElement,
  type PhysicalColumn,
  type PhysicalIndex,
} from './schema-extension-sql.js';

/**
 * The verifier (`specs/178-extensible-columns/` FR-025 – FR-027,
 * `contracts/generated-ddl-and-ledger.md` §4; research R-6).
 *
 * Holds the physical schema to the declarations: every declared column present
 * with its type, nullability and default, every declared index present. Drift
 * is fatal — inside the migration transaction it rolls the whole run back (a
 * core migration that loses a column in the same run cannot commit), and at
 * boot it stops the platform, naming the module, the key, the column, the host
 * and the last executed migration of the host's owning module. Orphaned and
 * unledgered `x_*` columns are a `warn`, never fatal.
 *
 * Two catalog reads regardless of how many declarations there are — one
 * `information_schema.columns`, one `pg_indexes` — plus one ledger read.
 */

/** Run `sql` and return its rows — bound to the migration transaction or to a plain connection. */
export type SchemaExtensionExec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export interface SchemaExtensionReport {
  readonly drift: readonly SchemaExtensionDrift[];
  readonly warnings: readonly string[];
  /** How many statements the inspection issued — FR-027's budget, asserted by a test. */
  readonly queries: number;
}

interface LedgerRow {
  readonly module_id: string;
  readonly host_table: string;
  readonly physical_name: string;
  readonly status: string;
}

/**
 * `"last executed migration of <owner>: <name> (executed at …)"` — research
 * R-6: which core migration touched the table is not knowable without parsing
 * SQL at run time, so the error names the owner's last executed one, and says
 * that is what it is.
 */
async function ownerLastMigration(
  exec: SchemaExtensionExec,
  context: SchemaExtensionContext,
  host: string,
): Promise<string> {
  const owner = context.hosts.get(host)?.ownerModuleId;
  if (owner === undefined) return `the owner of "${host}" is unknown`;
  const names = context.ownership?.migrationNamesFor(owner) ?? null;
  if (names === null || names.length === 0) {
    return `last executed migration of "${owner}": none this platform can name`;
  }
  const placeholders = names.map(() => '?').join(', ');
  const [row] = (await exec(
    `select name, executed_at from mikro_orm_migrations where name in (${placeholders}) ` +
      `order by executed_at desc, id desc limit 1`,
    [...names],
  )) as { name?: string; executed_at?: unknown }[];
  if (row?.name === undefined) return `last executed migration of "${owner}": none recorded`;
  const at = row.executed_at instanceof Date ? row.executed_at.toISOString() : String(row.executed_at);
  return `last executed migration of "${owner}": ${row.name} (executed at ${at})`;
}

/** The inspection, without the reaction. */
export async function inspectSchemaExtensions(
  exec: SchemaExtensionExec,
  context: SchemaExtensionContext,
): Promise<SchemaExtensionReport> {
  if (context.declarations.length === 0) return { drift: [], warnings: [], queries: 0 };

  const elements: DeclaredElement[] = context.declarations.flatMap((declaration) =>
    declaredElements(resolvedColumnExtension(declaration)),
  );
  const hosts = [...new Set(context.declarations.map((declaration) => declaration.host))].sort();
  const columns = (await exec(columnsQuery(hosts), hosts)) as unknown as PhysicalColumn[];
  const indexes = (await exec(indexesQuery(hosts), hosts)) as unknown as PhysicalIndex[];
  const ledger = (await exec(
    `select module_id, host_table, physical_name, status from schema_extensions where status <> 'dropped'`,
  )) as unknown as LedgerRow[];
  let queries = 3;

  const columnByName = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const indexByName = new Map(indexes.map((row) => [row.indexname, row]));

  const found: Omit<SchemaExtensionDrift, 'ownerLastMigration'>[] = [];
  const declaredNames = new Set<string>();
  for (const element of elements) {
    const { moduleId } = element;
    declaredNames.add(`${element.host}.${element.physicalName}`);
    if (element.kind === 'column') {
      const physical = columnByName.get(`${element.host}.${element.physicalName}`);
      if (physical === undefined) {
        found.push({ moduleId, key: element.key, host: element.host, physicalName: element.physicalName, kind: 'missing-column', detail: 'the column does not exist' });
        continue;
      }
      const mismatch = columnMismatch(element.column.spec, physical);
      if (mismatch !== null) {
        found.push({ moduleId, key: element.key, host: element.host, physicalName: element.physicalName, kind: 'column-mismatch', detail: mismatch });
      }
    } else {
      const physical = indexByName.get(element.physicalName);
      const mismatch = physical === undefined ? 'the index does not exist' : indexMismatch(element, physical);
      if (mismatch !== null) {
        found.push({ moduleId, key: element.key, host: element.host, physicalName: element.physicalName, kind: 'missing-index', detail: mismatch });
      }
    }
  }

  const warnings: string[] = [];
  const ledgered = new Set(ledger.map((row) => `${row.host_table}.${row.physical_name}`));
  for (const row of ledger) {
    if (row.status === 'applied' && !declaredNames.has(`${row.host_table}.${row.physical_name}`)) {
      warnings.push(
        `[schema-extensions] "${row.physical_name}" on "${row.host_table}" is recorded as applied for ` +
          `module "${row.module_id}", which no longer declares it; it is kept (orphan candidate).`,
      );
    }
  }
  for (const column of columns) {
    const name = `${column.table_name}.${column.column_name}`;
    if (!ledgered.has(name) && !declaredNames.has(name)) {
      warnings.push(
        `[schema-extensions] "${column.column_name}" on "${column.table_name}" has no ledger record ` +
          `and no declaration (unledgered).`,
      );
    }
  }

  const drift: SchemaExtensionDrift[] = [];
  const lastByHost = new Map<string, string>();
  for (const finding of found) {
    let last = lastByHost.get(finding.host);
    if (last === undefined) {
      last = await ownerLastMigration(exec, context, finding.host);
      queries += 1;
      lastByHost.set(finding.host, last);
    }
    drift.push({ ...finding, ownerLastMigration: last });
  }
  return { drift, warnings, queries };
}

/**
 * Inspect, warn, and throw {@link SchemaExtensionDriftError} on drift. With no
 * declaration it issues no statement at all, which is what keeps the mechanism
 * inert for a deployment that declares nothing.
 */
export async function verifySchemaExtensions(
  exec: SchemaExtensionExec,
  context: SchemaExtensionContext,
  log: (message: string) => void = (message) => console.warn(message),
): Promise<SchemaExtensionReport> {
  const report = await inspectSchemaExtensions(exec, context);
  for (const warning of report.warnings) log(warning);
  if (report.drift.length > 0) throw new SchemaExtensionDriftError(report.drift);
  return report;
}
