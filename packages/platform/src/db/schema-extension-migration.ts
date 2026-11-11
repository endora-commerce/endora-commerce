import { randomUUID } from 'node:crypto';
import { Migration } from '@mikro-orm/migrations';
import { resolvedColumnExtension } from '../kernel/schema-extensions/define.js';
import { SchemaExtensionReconcileError } from '../kernel/schema-extensions/errors.js';
import { physicalColumnPrefix } from '../kernel/schema-extensions/naming.js';
import type { ColumnExtension } from '../kernel/schema-extensions/types.js';
import { PLATFORM_VERSION } from '../http/platform-version.js';
import type { MigrationRegistryEntry } from './migration-order.js';
import {
  addColumnSql,
  canonicalJson,
  columnMismatch,
  columnsQuery,
  createIndexSql,
  declaredElements,
  indexMismatch,
  indexesQuery,
  sha256,
  type DeclaredElement,
  type PhysicalColumn,
  type PhysicalIndex,
} from './schema-extension-sql.js';

/**
 * The generated migration step of a declaring module
 * (`specs/178-extensible-columns/` FR-020 – FR-024,
 * `contracts/generated-ddl-and-ledger.md` §1, §3; research R-5).
 *
 * One synthetic registry entry per installed module that declares extension
 * columns, merged into the order like any of that module's migrations. Its stamp
 * is the reserved `10000101T000000`, a real instant that sorts **first** in the
 * module's block — so it runs after every module the declaring module depends
 * on, the host included, and before the module's own migrations, which may
 * back-fill the columns it adds (OD-178-1, ruled D-291). Its name ends in a
 * digest of the declarations, so it is pending exactly when they changed, and
 * ownership and hard uninstall treat it as the module's own.
 *
 * `up()` reconciles the declarations with the `schema_extensions` ledger inside
 * the migration transaction: additive DDL only, refusals roll the whole run
 * back. `down()` — which `uninstall --hard` runs — marks the module's rows
 * `orphaned` and drops nothing (OD-29).
 */

/** The reserved stamp; `orderMigrations` refuses it on anything not generated. */
export const SCHEMA_EXTENSION_STAMP = '10000101T000000';

/** `orders` → `Orders`, `acme_erp` → `AcmeErp` — the module prefix of a class name. */
function modulePrefix(moduleId: string): string {
  return (moduleId.startsWith('_') ? moduleId.slice(1) : moduleId)
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The normalised shape of a module's declarations — the hash input, sorted by host. */
function normalisedDeclarations(declarations: readonly ColumnExtension[]): unknown {
  return [...declarations]
    .map((declaration) => {
      const resolved = resolvedColumnExtension(declaration);
      return {
        host: resolved.host,
        columns: Object.fromEntries(resolved.columns.map((column) => [column.key, column.spec])),
      };
    })
    .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
}

/** First 12 hex of sha256 over the canonical JSON of the module's declarations. */
export function schemaExtensionHash(declarations: readonly ColumnExtension[]): string {
  return sha256(canonicalJson(normalisedDeclarations(declarations))).slice(0, 12);
}

export function schemaExtensionMigrationName(
  moduleId: string,
  declarations: readonly ColumnExtension[],
): string {
  return `Migration${SCHEMA_EXTENSION_STAMP}${modulePrefix(moduleId)}SchemaExtensions${schemaExtensionHash(declarations)}`;
}

/** One declaring module, as the entry factory takes it. */
export interface DeclaringModule {
  readonly moduleId: string;
  /** The declaring package's version, recorded on the ledger rows it applies. */
  readonly version: string | null;
  readonly declarations: readonly ColumnExtension[];
}

interface LedgerRow {
  readonly id: string;
  readonly host_table: string;
  readonly kind: 'column' | 'index';
  readonly physical_name: string;
  readonly declared_key: string;
  readonly spec: unknown;
  readonly spec_hash: string;
  readonly status: 'applied' | 'orphaned';
}

/** Run `sql` on the migration's own transaction and return its rows. */
type Exec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * The reconcile (`contracts/generated-ddl-and-ledger.md` §3), over an executor
 * bound to the migration transaction.
 */
export async function reconcileSchemaExtensions(
  exec: Exec,
  module: DeclaringModule,
): Promise<void> {
  const { moduleId } = module;
  const elements = module.declarations.flatMap((declaration) =>
    declaredElements(resolvedColumnExtension(declaration)),
  );
  const hosts = [...new Set(module.declarations.map((declaration) => declaration.host))].sort();

  // 1. The module's live ledger rows, locked for the run.
  const ledger = (await exec(
    `select id, host_table, kind, physical_name, declared_key, spec, spec_hash, status ` +
      `from schema_extensions where module_id = ? and status <> 'dropped' for update`,
    [moduleId],
  )) as unknown as LedgerRow[];
  const ledgerByName = new Map(ledger.map((row) => [`${row.host_table}.${row.physical_name}`, row]));

  // 2. One column read and one index read for the module's hosts.
  const prefix = physicalColumnPrefix(moduleId);
  const columns =
    hosts.length === 0
      ? []
      : ((await exec(columnsQuery(hosts), hosts)) as unknown as PhysicalColumn[]).filter((row) =>
          row.column_name.startsWith(prefix),
        );
  const indexes =
    hosts.length === 0 ? [] : ((await exec(indexesQuery(hosts), hosts)) as unknown as PhysicalIndex[]);
  const columnByName = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const indexByName = new Map(indexes.map((row) => [row.indexname, row]));

  const now = new Date();
  const insertLedger = (element: DeclaredElement): Promise<unknown> =>
    exec(
      `insert into schema_extensions (id, module_id, host_table, kind, physical_name, declared_key, ` +
        `spec, spec_hash, status, platform_version, package_version, applied_at) ` +
        `values (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'applied', ?, ?, ?)`,
      [
        randomUUID(),
        moduleId,
        element.host,
        element.kind,
        element.physicalName,
        element.key,
        JSON.stringify(element.spec),
        element.specHash,
        PLATFORM_VERSION ?? '0.0.0',
        module.version,
        now,
      ],
    );

  // 3. Every declared element: columns first, then the indexes over them.
  const declaredNames = new Set<string>();
  for (const element of elements) {
    const name = `${element.host}.${element.physicalName}`;
    declaredNames.add(name);
    const row = ledgerByName.get(name);
    const present =
      element.kind === 'column' ? columnByName.get(name) : indexByName.get(element.physicalName);

    if (row !== undefined && row.spec_hash !== element.specHash) {
      throw new SchemaExtensionReconcileError(
        'non-additive-change',
        `module "${moduleId}", key "${element.key}": the ${element.kind} "${element.physicalName}" on ` +
          `"${element.host}" was applied as ${canonicalJson(row.spec)} and is now declared as ` +
          `${canonicalJson(element.spec)}. A declared element is never changed in place; declare a ` +
          `new key and stop declaring this one (it is kept as orphaned).`,
      );
    }
    if (row !== undefined) {
      if (row.status === 'orphaned') {
        if (present === undefined) await exec(ddlFor(element));
        await exec(`update schema_extensions set status = 'applied', orphaned_at = null where id = ?`, [row.id]);
      }
      // `applied`, same hash: nothing to do. Present or not is the verifier's
      // question, asked once the whole run is done.
      continue;
    }
    if (present !== undefined) {
      const mismatch =
        element.kind === 'column'
          ? columnMismatch(element.column.spec, present as PhysicalColumn)
          : indexMismatch(element, present as PhysicalIndex);
      if (mismatch !== null) {
        throw new SchemaExtensionReconcileError(
          'unledgered-column-mismatch',
          `module "${moduleId}", key "${element.key}": "${element.physicalName}" already exists on ` +
            `"${element.host}" with no ledger record, and it does not match the declaration ` +
            `(${mismatch}). Drop it by hand or declare a different key.`,
        );
      }
      // Adopted: it is what the declaration would have created.
      await insertLedger(element);
      continue;
    }
    await exec(ddlFor(element));
    await insertLedger(element);
  }

  // 4. Ledger rows the module no longer declares are kept, as orphaned.
  for (const row of ledger) {
    if (row.status !== 'applied' || declaredNames.has(`${row.host_table}.${row.physical_name}`)) continue;
    await exec(`update schema_extensions set status = 'orphaned', orphaned_at = ? where id = ?`, [now, row.id]);
  }
}

function ddlFor(element: DeclaredElement): string {
  return element.kind === 'column'
    ? addColumnSql(element.host, element.column)
    : createIndexSql(element.host, element.column);
}

/** `down()`: the module's applied rows become orphaned; nothing is dropped (FR-023). */
export async function orphanSchemaExtensions(exec: Exec, moduleId: string): Promise<void> {
  await exec(
    `update schema_extensions set status = 'orphaned', orphaned_at = ? ` +
      `where module_id = ? and status = 'applied'`,
    [new Date(), moduleId],
  );
}

/** The migration class of one declaring module. */
function schemaExtensionMigrationClass(module: DeclaringModule): MigrationRegistryEntry['cls'] {
  const name = schemaExtensionMigrationName(module.moduleId, module.declarations);
  const holder = {
    [name]: class extends Migration {
      override async up(): Promise<void> {
        await reconcileSchemaExtensions(
          (sql, params) => this.execute(sql, params) as Promise<Record<string, unknown>[]>,
          module,
        );
      }

      override async down(): Promise<void> {
        await orphanSchemaExtensions(
          (sql, params) => this.execute(sql, params) as Promise<Record<string, unknown>[]>,
          module.moduleId,
        );
      }
    },
  };
  return holder[name]! as unknown as MigrationRegistryEntry['cls'];
}

/** One `generated` entry per module that declares anything. */
export function schemaExtensionEntries(modules: readonly DeclaringModule[]): MigrationRegistryEntry[] {
  return modules
    .filter((module) => module.declarations.length > 0)
    .map((module) => ({
      moduleId: module.moduleId,
      cls: schemaExtensionMigrationClass(module),
      origin: 'generated' as const,
    }));
}
