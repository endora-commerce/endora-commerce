import { createHash } from 'node:crypto';
import type {
  NormalisedColumnSpec,
  ResolvedColumn,
  ResolvedColumnExtension,
  SpecLiteral,
} from '../kernel/schema-extensions/types.js';

/**
 * The only SQL the platform generates for declared extension columns
 * (`specs/178-extensible-columns/contracts/generated-ddl-and-ledger.md` §2), and
 * the physical-shape comparison the reconcile and the verifier share.
 *
 * Every identifier is quoted, and every one of them was validated before it got
 * here: a host is a member of the extensible set and a physical name is
 * `x_<module id>_<snake key>`, both by regex. A default is rendered by
 * {@link sqlLiteral} from a value the shape rules already held to its type.
 */

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

/** `"name"`; refuses anything that is not a plain lower-case identifier. */
export function quoteIdent(name: string): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`[schema-extensions] refusing to quote the identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** A constant default as SQL. Strings are single-quoted with `'` doubled. */
export function sqlLiteral(value: SpecLiteral): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`[schema-extensions] non-integer numeric default ${value}`);
    return String(value);
  }
  if (value.includes('\0')) throw new Error('[schema-extensions] a default may not contain NUL');
  return `'${value.replace(/'/g, "''")}'`;
}

/** The column's SQL type (`data-model.md` §3). */
export function sqlType(spec: NormalisedColumnSpec): string {
  switch (spec.type) {
    case 'varchar':
      return `varchar(${String(spec.length)})`;
    case 'numeric':
      return `numeric(${String(spec.precision)}, ${String(spec.scale)})`;
    default:
      return spec.type;
  }
}

export function addColumnSql(host: string, column: ResolvedColumn): string {
  const tail = column.spec.nullable
    ? 'null'
    : `not null default ${sqlLiteral(column.spec.default)}`;
  return `alter table ${quoteIdent(host)} add column ${quoteIdent(column.physicalName)} ${sqlType(column.spec)} ${tail};`;
}

export function createIndexSql(host: string, column: ResolvedColumn): string {
  const name = quoteIdent(column.indexName!);
  const col = quoteIdent(column.physicalName);
  return column.spec.index === 'unique'
    ? `create unique index ${name} on ${quoteIdent(host)} (${col}) where ${col} is not null;`
    : `create index ${name} on ${quoteIdent(host)} (${col});`;
}

export function dropIndexSql(indexName: string): string {
  return `drop index if exists ${quoteIdent(indexName)};`;
}

export function dropColumnSql(host: string, column: string): string {
  return `alter table ${quoteIdent(host)} drop column if exists ${quoteIdent(column)};`;
}

/** Canonical JSON: keys sorted, recursively. The ledger's hash input. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** One declared element as the ledger records it. */
export interface DeclaredElement {
  readonly kind: 'column' | 'index';
  readonly moduleId: string;
  readonly host: string;
  readonly key: string;
  readonly physicalName: string;
  readonly spec: Record<string, unknown>;
  readonly specHash: string;
  readonly column: ResolvedColumn;
}

/** Columns first, then their indexes — the order the reconcile applies them in. */
export function declaredElements(resolved: ResolvedColumnExtension): DeclaredElement[] {
  const columns: DeclaredElement[] = resolved.columns.map((column) => ({
    kind: 'column',
    moduleId: resolved.module,
    host: resolved.host,
    key: column.key,
    physicalName: column.physicalName,
    spec: { ...column.spec },
    specHash: sha256(canonicalJson(column.spec)),
    column,
  }));
  const indexes: DeclaredElement[] = resolved.columns
    .filter((column) => column.indexName !== null)
    .map((column) => {
      const spec = { column: column.physicalName, unique: column.spec.index === 'unique' };
      return {
        kind: 'index',
        moduleId: resolved.module,
        host: resolved.host,
        key: column.key,
        physicalName: column.indexName!,
        spec,
        specHash: sha256(canonicalJson(spec)),
        column,
      };
    });
  return [...columns, ...indexes];
}

/** One `information_schema.columns` row, as the two readers select it. */
export interface PhysicalColumn {
  readonly table_name: string;
  readonly column_name: string;
  readonly udt_name: string;
  readonly character_maximum_length: number | null;
  readonly numeric_precision: number | null;
  readonly numeric_scale: number | null;
  readonly is_nullable: 'YES' | 'NO';
  readonly column_default: string | null;
}

/** One `pg_indexes` row. */
export interface PhysicalIndex {
  readonly tablename: string;
  readonly indexname: string;
  readonly indexdef: string;
}

const UDT: Record<NormalisedColumnSpec['type'], string> = {
  text: 'text',
  varchar: 'varchar',
  boolean: 'bool',
  smallint: 'int2',
  integer: 'int4',
  bigint: 'int8',
  numeric: 'numeric',
  date: 'date',
  timestamptz: 'timestamptz',
  uuid: 'uuid',
  jsonb: 'jsonb',
};

/** `'abc'::text` → `abc`, `(0)` → `0`, `'0'::bigint` → `0`, `NULL::text` → null. */
export function normaliseDefault(columnDefault: string | null): string | null {
  if (columnDefault === null) return null;
  let text = columnDefault.trim();
  for (;;) {
    const stripped = text
      .replace(/::[a-z][a-z0-9_ ]*(\(\d+(,\s*\d+)?\))?$/i, '')
      .replace(/^\((.*)\)$/s, '$1')
      .trim();
    if (stripped === text) break;
    text = stripped;
  }
  if (/^null$/i.test(text)) return null;
  const quoted = /^'(.*)'$/s.exec(text);
  return quoted ? quoted[1]!.replace(/''/g, "'") : text;
}

function defaultMatches(spec: NormalisedColumnSpec, columnDefault: string | null): boolean {
  const actual = normaliseDefault(columnDefault);
  if (spec.default === null) return actual === null;
  if (actual === null) return false;
  const expected = String(spec.default);
  if (actual === expected) return true;
  if (spec.type === 'numeric' || spec.type === 'bigint' || spec.type === 'smallint' || spec.type === 'integer') {
    return Number(actual) === Number(expected);
  }
  return false;
}

/**
 * Why `physical` does not carry `spec`, or `null` when it does.
 *
 * Compares the type (`udt_name` plus length or precision/scale), the
 * nullability and the default — the three things an additive declaration fixes
 * and a hand edit or a core rebuild can lose.
 */
export function columnMismatch(spec: NormalisedColumnSpec, physical: PhysicalColumn): string | null {
  if (physical.udt_name !== UDT[spec.type]) {
    return `type is ${physical.udt_name}, declared ${sqlType(spec)}`;
  }
  if (spec.type === 'varchar' && physical.character_maximum_length !== spec.length) {
    return `length is ${String(physical.character_maximum_length)}, declared ${String(spec.length)}`;
  }
  if (
    spec.type === 'numeric' &&
    (physical.numeric_precision !== spec.precision || physical.numeric_scale !== spec.scale)
  ) {
    return `precision/scale is ${String(physical.numeric_precision)}/${String(physical.numeric_scale)}, declared ${String(spec.precision)}/${String(spec.scale)}`;
  }
  const nullable = physical.is_nullable === 'YES';
  if (nullable !== spec.nullable) {
    return nullable ? 'column is nullable, declared NOT NULL' : 'column is NOT NULL, declared nullable';
  }
  if (!defaultMatches(spec, physical.column_default)) {
    return `default is ${String(physical.column_default)}, declared ${sqlLiteral(spec.default)}`;
  }
  return null;
}

/** Why `physical` is not the declared index on `element.column`, or `null` when it is. */
export function indexMismatch(element: DeclaredElement, physical: PhysicalIndex): string | null {
  const def = physical.indexdef.toLowerCase();
  const unique = element.column.spec.index === 'unique';
  if (def.startsWith('create unique index') !== unique) {
    return unique ? 'index is not unique, declared unique' : 'index is unique, declared non-unique';
  }
  if (!def.includes(`(${element.column.physicalName})`) && !def.includes(`("${element.column.physicalName}")`)) {
    return `index does not cover ${element.column.physicalName}`;
  }
  return null;
}

/** `?, ?, ?` — one knex placeholder per value. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** The `information_schema.columns` read over `tables`, `x_` columns only (FR-027). */
export function columnsQuery(tables: readonly string[]): string {
  return (
    `select table_name, column_name, udt_name, character_maximum_length, numeric_precision, ` +
    `numeric_scale, is_nullable, column_default from information_schema.columns ` +
    `where table_schema = current_schema() and table_name in (${placeholders(tables.length)}) ` +
    `and column_name like 'x\\_%'`
  );
}

/** The `pg_indexes` read over `tables` (FR-027). */
export function indexesQuery(tables: readonly string[]): string {
  return (
    `select tablename, indexname, indexdef from pg_indexes ` +
    `where schemaname = current_schema() and tablename in (${placeholders(tables.length)})`
  );
}
