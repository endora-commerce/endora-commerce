import type { MikroORM } from '@mikro-orm/postgresql';
import type { CommandBus } from '../../commands/command-bus.js';
import { withSystemScope } from '../../tenancy/escape-hatch.js';
import { resolvedColumnExtension } from '../../kernel/schema-extensions/define.js';
import type { ColumnExtension } from '../../kernel/schema-extensions/types.js';
import { declaredElements, dropColumnSql, dropIndexSql, quoteIdent } from '../../db/schema-extension-sql.js';
import { auditForeignSchemaWrites, type AuditedPackage } from '../../db/foreign-schema-guard.js';
import { PLATFORM_ENTITIES } from '../../db/platform-schema.js';
import { FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS } from '../../migrations/index.js';

/**
 * `module:schema-extensions list | drop | audit-packages` — the operator's view of the
 * `schema_extensions` ledger and the one way an extension's columns are ever
 * dropped (`specs/178-extensible-columns/` FR-081,
 * `contracts/generated-ddl-and-ledger.md` §6; OD-29).
 *
 * Uninstalling a declaring module keeps its columns and their data, as
 * `orphaned` ledger rows. Dropping them is a separate, explicit, audited act:
 * `drop <moduleId>` prints the plan, `drop <moduleId> --confirm` runs the
 * Command `schema_extension.drop` under the system scope. It refuses an element
 * an installed package still declares (`extension-still-declared`) and one that
 * is not orphaned (`not-orphaned`). The audit entry names what was dropped and
 * how many rows held a value — never the values (audit-state D-288).
 *
 * `audit-packages` (FR-073) runs the foreign-schema guard's classification over
 * every installed package's migrations **without executing them** and lists each
 * statement the guard would refuse at `migrate` — so an operator can check the
 * packages on the current release before upgrading to the one that refuses
 * (OD-17 b). It writes nothing; exit 65 when anything would be refused.
 */

export interface SchemaExtensionsRuntime {
  readonly orm: () => Promise<MikroORM>;
  /** Every declaration the discovered packages make — the "still declared" set. */
  readonly declarations: () => readonly ColumnExtension[];
  readonly commandBus: () => Promise<CommandBus>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The installed packages' raw schema contributions — `audit-packages`' population. */
  readonly packages?: () => Promise<readonly AuditedPackage[]>;
}

export const SCHEMA_EXTENSIONS_EXIT = { ok: 0, usage: 64, refused: 65, failed: 70 } as const;

interface LedgerRow {
  readonly id: string;
  readonly module_id: string;
  readonly host_table: string;
  readonly kind: 'column' | 'index';
  readonly physical_name: string;
  readonly declared_key: string;
  readonly status: string;
  readonly applied_at: Date | string;
  readonly orphaned_at: Date | string | null;
}

const USAGE =
  'usage: module:schema-extensions list [--module <id>] [--json]\n' +
  '       module:schema-extensions drop <moduleId> [--key <key>] [--confirm]\n' +
  '       module:schema-extensions audit-packages [--json]\n';

const MODULE_ID_RE = /^[a-z][a-z0-9_]*$/;
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

interface Parsed {
  readonly verb: 'list' | 'drop' | 'audit-packages';
  readonly moduleId?: string;
  readonly key?: string;
  readonly confirm: boolean;
  readonly json: boolean;
}

function parse(argv: readonly string[]): Parsed | string {
  const [verb, ...rest] = argv;
  if (verb !== 'list' && verb !== 'drop' && verb !== 'audit-packages') {
    return `unknown verb ${JSON.stringify(verb ?? '')}`;
  }
  let moduleId: string | undefined;
  let key: string | undefined;
  let confirm = false;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === '--confirm') confirm = true;
    else if (arg === '--json') json = true;
    else if (arg === '--module' || arg === '--key') {
      const value = rest[index + 1];
      if (value === undefined) return `${arg} takes a value`;
      index += 1;
      if (arg === '--module') moduleId = value;
      else key = value;
    } else if (arg.startsWith('--')) return `unknown flag: ${arg}`;
    else if (verb === 'drop' && moduleId === undefined) moduleId = arg;
    else return `unexpected argument: ${arg}`;
  }
  if (moduleId !== undefined && !MODULE_ID_RE.test(moduleId)) return `invalid module id: ${moduleId}`;
  if (key !== undefined && !KEY_RE.test(key)) return `invalid key: ${key}`;
  if (verb === 'drop' && moduleId === undefined) return 'drop takes a module id';
  if (verb === 'list' && (confirm || key !== undefined)) return 'list takes --module and --json only';
  if (verb === 'audit-packages' && (confirm || key !== undefined || moduleId !== undefined)) {
    return 'audit-packages takes --json only';
  }
  return {
    verb,
    confirm,
    json,
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(key === undefined ? {} : { key }),
  };
}

const iso = (value: Date | string | null): string =>
  value === null ? '—' : value instanceof Date ? value.toISOString() : String(value);

async function list(rt: SchemaExtensionsRuntime, args: Parsed): Promise<number> {
  const orm = await rt.orm();
  const rows = (await orm.em
    .getConnection()
    .execute(
      `select id, module_id, host_table, kind, physical_name, declared_key, status, applied_at, orphaned_at ` +
        `from schema_extensions ${args.moduleId === undefined ? '' : 'where module_id = ? '}` +
        `order by module_id, host_table, kind, physical_name`,
      args.moduleId === undefined ? [] : [args.moduleId],
    )) as LedgerRow[];
  if (args.json) {
    rt.out(`${JSON.stringify({ elements: rows }, null, 2)}\n`);
    return SCHEMA_EXTENSIONS_EXIT.ok;
  }
  if (rows.length === 0) {
    rt.out('(no schema extensions recorded)\n');
    return SCHEMA_EXTENSIONS_EXIT.ok;
  }
  const header = ['MODULE', 'HOST', 'KIND', 'ELEMENT', 'KEY', 'STATUS', 'APPLIED', 'ORPHANED'];
  const table = rows.map((row) => [
    row.module_id,
    row.host_table,
    row.kind,
    row.physical_name,
    row.declared_key,
    row.status,
    iso(row.applied_at),
    iso(row.orphaned_at),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...table.map((cells) => cells[column]!.length)));
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd();
  rt.out(`${[line(header), ...table.map(line)].join('\n')}\n`);
  return SCHEMA_EXTENSIONS_EXIT.ok;
}

async function drop(rt: SchemaExtensionsRuntime, args: Parsed): Promise<number> {
  const moduleId = args.moduleId!;
  const orm = await rt.orm();
  const connection = orm.em.getConnection();
  const targets = (
    (await connection.execute(
      `select id, module_id, host_table, kind, physical_name, declared_key, status, applied_at, orphaned_at ` +
        `from schema_extensions where module_id = ? and status <> 'dropped' order by kind desc, physical_name`,
      [moduleId],
    )) as LedgerRow[]
  ).filter((row) => args.key === undefined || row.declared_key === args.key);
  if (targets.length === 0) {
    rt.err(`[schema-extensions] nothing to drop: "${moduleId}" has no live ledger element${args.key === undefined ? '' : ` for key "${args.key}"`}.\n`);
    return SCHEMA_EXTENSIONS_EXIT.refused;
  }

  const declared = new Set(
    rt
      .declarations()
      .flatMap((declaration) => declaredElements(resolvedColumnExtension(declaration)))
      .map((element) => `${element.host}.${element.physicalName}`),
  );
  const stillDeclared = targets.filter((row) => declared.has(`${row.host_table}.${row.physical_name}`));
  if (stillDeclared.length > 0) {
    rt.err(
      `[schema-extensions] extension-still-declared: ${stillDeclared.map((r) => `${r.host_table}.${r.physical_name}`).join(', ')} ` +
        `is declared by an installed package. Stop declaring it (or uninstall "${moduleId}") first.\n`,
    );
    return SCHEMA_EXTENSIONS_EXIT.refused;
  }
  const live = targets.filter((row) => row.status !== 'orphaned');
  if (live.length > 0) {
    rt.err(
      `[schema-extensions] not-orphaned: ${live.map((r) => `${r.host_table}.${r.physical_name} (${r.status})`).join(', ')}. ` +
        `Only orphaned elements are dropped.\n`,
    );
    return SCHEMA_EXTENSIONS_EXIT.refused;
  }

  const indexes = targets.filter((row) => row.kind === 'index');
  const columns = targets.filter((row) => row.kind === 'column');
  const statements = [
    ...indexes.map((row) => dropIndexSql(row.physical_name)),
    ...columns.map((row) => dropColumnSql(row.host_table, row.physical_name)),
  ];
  const nonNull: Record<string, number> = {};
  for (const row of columns) {
    const [count] = (await connection.execute(
      `select count(${quoteIdent(row.physical_name)})::int as n from ${quoteIdent(row.host_table)}`,
    )) as { n: number }[];
    nonNull[`${row.host_table}.${row.physical_name}`] = count?.n ?? 0;
  }

  rt.out(`Plan for "${moduleId}":\n`);
  for (const statement of statements) rt.out(`  ${statement}\n`);
  for (const [column, count] of Object.entries(nonNull)) rt.out(`  -- ${column}: ${count} row(s) hold a value\n`);
  if (!args.confirm) {
    rt.out('Nothing was changed. Re-run with --confirm to drop these elements.\n');
    return SCHEMA_EXTENSIONS_EXIT.ok;
  }

  const bus = await rt.commandBus();
  const ids = targets.map((row) => row.id);
  await withSystemScope('schema-extensions drop', () =>
    bus.run({
      action: 'schema_extension.drop',
      objectType: 'schema_extension',
      objectId: moduleId,
      async run({ em }) {
        const tx = em.getConnection();
        const ctx = em.getTransactionContext();
        for (const statement of statements) await tx.execute(statement, [], 'run', ctx);
        await tx.execute(
          `update schema_extensions set status = 'dropped', dropped_at = now() ` +
            `where id in (${ids.map(() => '?').join(', ')})`,
          ids,
          'run',
          ctx,
        );
        return {
          result: undefined,
          before: {
            elements: targets.map((row) => ({
              host: row.host_table,
              kind: row.kind,
              element: row.physical_name,
              key: row.declared_key,
              status: row.status,
            })),
            nonNullRows: nonNull,
          },
          after: { dropped: targets.map((row) => `${row.host_table}.${row.physical_name}`) },
        };
      },
    }),
  );
  // The audit entry is written by the bus inside the Command's transaction, so
  // its id is known only once that commits; link it to the rows it dropped.
  await connection.execute(
    `update schema_extensions set drop_audit_id = (` +
      `select id from audit_log_entries where action = 'schema_extension.drop' and object_id = ? ` +
      `order by acted_at desc limit 1) where id in (${ids.map(() => '?').join(', ')})`,
    [moduleId, ...ids],
  );
  rt.out(`Dropped ${targets.length} element(s) of "${moduleId}".\n`);
  return SCHEMA_EXTENSIONS_EXIT.ok;
}

async function auditPackages(rt: SchemaExtensionsRuntime, args: Parsed): Promise<number> {
  if (rt.packages === undefined) {
    rt.err('[schema-extensions] audit-packages: this entry point supplies no installed-package population\n');
    return SCHEMA_EXTENSIONS_EXIT.failed;
  }
  const orm = await rt.orm();
  const audit = await auditForeignSchemaWrites({
    packages: await rt.packages(),
    driver: orm.em.getDriver(),
    config: orm.config,
    platformEntities: PLATFORM_ENTITIES,
    exemptions: FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS,
  });
  if (args.json) {
    rt.out(`${JSON.stringify(audit, null, 2)}\n`);
  } else {
    for (const finding of audit.findings) {
      rt.out(
        `${finding.packageName} (${finding.moduleId}) ${finding.migration}.${finding.method}() → ${finding.table}: ` +
          `${finding.statement}\n`,
      );
    }
    for (const index of audit.unresolvedIndexes) {
      rt.out(`(not judged) drop index "${index}": no audited migration creates it\n`);
    }
    for (const failure of audit.dryRunErrors) {
      rt.out(`(partly judged) ${failure.migration}: its up() threw in a dry run — ${failure.message}\n`);
    }
    rt.out(
      audit.findings.length === 0
        ? `no installed package migration would be refused (${audit.migrations} migration(s), ` +
            `${audit.statements} statement(s) read)\n`
        : `${audit.findings.length} statement(s) would be refused as foreign-schema-write at migrate ` +
            `(${audit.migrations} migration(s) read). A package migration may write only its own tables ` +
            `and, on a host it declares, its own x_<module>_ columns.\n`,
    );
  }
  return audit.findings.length === 0 ? SCHEMA_EXTENSIONS_EXIT.ok : SCHEMA_EXTENSIONS_EXIT.refused;
}

export async function runSchemaExtensionsCommand(
  argv: readonly string[],
  rt: SchemaExtensionsRuntime,
): Promise<number> {
  const args = parse(argv);
  if (typeof args === 'string') {
    rt.err(`${USAGE}error: ${args}\n`);
    return SCHEMA_EXTENSIONS_EXIT.usage;
  }
  try {
    if (args.verb === 'audit-packages') return await auditPackages(rt, args);
    return args.verb === 'list' ? await list(rt, args) : await drop(rt, args);
  } catch (error) {
    rt.err(`[schema-extensions] ${error instanceof Error ? error.message : String(error)}\n`);
    return SCHEMA_EXTENSIONS_EXIT.failed;
  }
}
