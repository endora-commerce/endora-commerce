import type { z } from 'zod';
import { SchemaExtensionInvalidError } from './errors.js';
import { EXTENSIBLE_HOSTS } from './extensible-hosts.js';
import { MAX_IDENTIFIER_BYTES, indexName, physicalColumnName } from './naming.js';
import type {
  ColumnExtension,
  ColumnExtensionInput,
  ColumnSpec,
  ColumnType,
  ExtensibleHostTable,
  NormalisedColumnSpec,
  ResolvedColumn,
  ResolvedColumnExtension,
  SpecLiteral,
} from './types.js';

/**
 * `defineColumnExtension` — the declaration of additive `x_<moduleId>_*`
 * columns on an extensible host table (`specs/178-extensible-columns/`
 * FR-001 – FR-007, `contracts/column-extension-declaration.md`).
 *
 * It applies the **shape** rules at import — V1 – V8 and V12, with V2 asked of
 * the full derived host list — and throws {@link SchemaExtensionInvalidError}
 * naming the module, the key and the rule. Discovery re-asks V2 of the
 * *rolled-out* list and adds V9 – V11, which need the declaring package
 * (`validateDeclarationContext`).
 */

/** Manifest module ids, without the platform's reserved leading underscore. */
const MODULE_ID_RE = /^[a-z][a-z0-9_]*$/;
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;
const MAX_COLUMNS = 32;

const COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'text',
  'varchar',
  'boolean',
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'date',
  'timestamptz',
  'uuid',
  'jsonb',
]);

/** Keys a later version may offer; refused now rather than ignored (FR-060, FR-063). */
const NOT_OFFERED_COLUMN_KEYS = ['filterable', 'sortable', 'references', 'unique', 'check'] as const;
const NOT_OFFERED_DECLARATION_KEYS = ['indexes', 'filterable', 'sortable'] as const;
const KNOWN_COLUMN_KEYS = new Set(['type', 'nullable', 'default', 'index', 'length', 'precision', 'scale', 'schema']);

/**
 * The brand: a registered symbol, set non-enumerable, so a spread copy of a
 * declaration is not one and two copies of this file in one process (a test
 * reading `src` beside a package reading `dist`) still recognise each other's.
 * It guards against a mistake, not against a forger — the derived facts are
 * re-derived from the declaration itself on a cache miss, so a forged brand
 * still passes every shape rule or is refused.
 */
const BRAND = Symbol.for('@endora-commerce/platform:column-extension');
const resolvedByDeclaration = new WeakMap<object, ResolvedColumnExtension>();

/** Whether `value` is a declaration `defineColumnExtension` made (not a copy of one). */
export function isColumnExtension(value: unknown): value is ColumnExtension {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, BRAND) &&
    (value as Record<symbol, unknown>)[BRAND] === true
  );
}

/** The physical names and normalised specs of a declaration. */
export function resolvedColumnExtension(declaration: ColumnExtension): ResolvedColumnExtension {
  const cached = resolvedByDeclaration.get(declaration);
  if (cached !== undefined) return cached;
  if (!isColumnExtension(declaration)) {
    throw new SchemaExtensionInvalidError(
      'not-a-declaration',
      String((declaration as { module?: unknown }).module),
      null,
      'the value was not made by defineColumnExtension',
    );
  }
  const resolved = resolveShape(declaration, null);
  resolvedByDeclaration.set(declaration, resolved);
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BIGINT_RE = /^-?\d{1,19}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RANGE: Record<'smallint' | 'integer', readonly [number, number]> = {
  smallint: [-32768, 32767],
  integer: [-2147483648, 2147483647],
};

/** The regex a `numeric(p, s)` decimal string must match. */
export function numericPattern(precision: number, scale: number): RegExp {
  const integerDigits = precision - scale;
  const integerPart = integerDigits === 0 ? '0' : `\\d{1,${integerDigits}}`;
  const fraction = scale === 0 ? '' : `(\\.\\d{1,${scale}})?`;
  return new RegExp(`^-?${integerPart}${fraction}$`);
}

/** Whether `iso` (YYYY-MM-DD) names a real calendar day. */
export function isCalendarDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

interface ShapeContext {
  readonly moduleId: string;
  readonly key: string;
}

function refuse(
  rule: ConstructorParameters<typeof SchemaExtensionInvalidError>[0],
  at: ShapeContext,
  detail: string,
): never {
  throw new SchemaExtensionInvalidError(rule, at.moduleId, at.key, detail);
}

/** Whether `value` is a constant of the column's type (V6). */
function defaultFits(spec: Record<string, unknown>, value: unknown): boolean {
  switch (spec['type'] as ColumnType) {
    case 'text':
      return typeof value === 'string';
    case 'varchar':
      return typeof value === 'string' && value.length <= (spec['length'] as number);
    case 'uuid':
      return typeof value === 'string' && UUID_RE.test(value);
    case 'date':
      return typeof value === 'string' && isCalendarDate(value);
    case 'bigint':
      return typeof value === 'string' && BIGINT_RE.test(value);
    case 'numeric':
      return (
        typeof value === 'string' &&
        numericPattern(spec['precision'] as number, spec['scale'] as number).test(value)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'smallint':
    case 'integer': {
      const [min, max] = INT_RANGE[spec['type'] as 'smallint' | 'integer'];
      return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
    }
    case 'timestamptz':
    case 'jsonb':
      return false;
  }
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** V3 – V8 and V12 on one column; returns its normalised spec. */
function normaliseColumn(at: ShapeContext, raw: unknown): NormalisedColumnSpec {
  if (!KEY_RE.test(at.key)) {
    refuse('key', at, 'a key matches ^[a-z][a-zA-Z0-9]*$ (camelCase, starting with a letter)');
  }
  if (!isRecord(raw)) refuse('type', at, 'a column spec is an object with a `type`');
  for (const key of NOT_OFFERED_COLUMN_KEYS) {
    if (key in raw) refuse('not-offered-yet', at, `\`${key}\` is not offered (FR-060 – FR-063)`);
  }
  if ('default' in raw && isRecord(raw['default'])) {
    refuse('not-offered-yet', at, 'a default is a constant of the column type; expression defaults are not offered (FR-063)');
  }
  const type = raw['type'];
  if (typeof type !== 'string' || !COLUMN_TYPES.has(type as ColumnType)) {
    refuse('type', at, `unknown type ${JSON.stringify(type)}; one of ${[...COLUMN_TYPES].join(', ')}`);
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_COLUMN_KEYS.has(key)) refuse('not-offered-yet', at, `\`${key}\` is not a column option`);
  }

  if (type === 'varchar' && !isIntegerIn(raw['length'], 1, 1024)) {
    refuse('type-params', at, 'varchar takes `length` 1 – 1024');
  }
  if (type === 'numeric') {
    if (!isIntegerIn(raw['precision'], 1, 38)) refuse('type-params', at, 'numeric takes `precision` 1 – 38');
    if (!isIntegerIn(raw['scale'], 0, raw['precision'] as number)) {
      refuse('type-params', at, 'numeric takes `scale` 0 – precision');
    }
  }
  if (type !== 'varchar' && 'length' in raw) refuse('type-params', at, '`length` is a varchar option');
  if (type !== 'numeric' && ('precision' in raw || 'scale' in raw)) {
    refuse('type-params', at, '`precision` and `scale` are numeric options');
  }
  if (type === 'jsonb') {
    const schema = raw['schema'] as { safeParse?: unknown } | undefined;
    if (typeof schema?.safeParse !== 'function') refuse('type-params', at, 'jsonb requires a Zod `schema`');
  } else if ('schema' in raw) {
    refuse('type-params', at, '`schema` is a jsonb option');
  }

  const nullable = raw['nullable'] === true;
  if (raw['nullable'] !== undefined && typeof raw['nullable'] !== 'boolean') {
    refuse('type-params', at, '`nullable` is a boolean');
  }
  const hasDefault = 'default' in raw && raw['default'] !== undefined;
  if ((type === 'timestamptz' || type === 'jsonb') && hasDefault) {
    refuse('default-type', at, `${type} columns take no default (FR-004)`);
  }
  if (!nullable && !hasDefault) {
    refuse(
      'not-null-without-default',
      at,
      type === 'timestamptz' || type === 'jsonb'
        ? `${type} columns must be nullable (FR-004)`
        : 'a column is nullable or carries a constant default (FR-004)',
    );
  }
  if (hasDefault && !defaultFits(raw, raw['default'])) {
    refuse('default-type', at, `default ${JSON.stringify(raw['default'])} is not a constant of type ${type}`);
  }

  const index = raw['index'] ?? false;
  if (index !== false && index !== true && index !== 'unique') {
    refuse('index', at, '`index` is true, false or \'unique\'');
  }
  if (index !== false && type === 'jsonb') refuse('index', at, 'jsonb columns cannot be indexed (FR-005)');
  if (index === 'unique' && !nullable) {
    refuse('index', at, "a 'unique' index is partial (where the column is not null) and needs a nullable column (FR-005)");
  }

  const physical = physicalColumnName(at.moduleId, at.key);
  if (Buffer.byteLength(physical, 'utf8') > MAX_IDENTIFIER_BYTES) {
    refuse('name-length', at, `physical name "${physical}" is over ${MAX_IDENTIFIER_BYTES} bytes`);
  }

  // Fixed key order: the canonical JSON of this object is the hash input.
  return {
    type: type as ColumnType,
    ...(type === 'varchar' ? { length: raw['length'] as number } : {}),
    ...(type === 'numeric'
      ? { precision: raw['precision'] as number, scale: raw['scale'] as number }
      : {}),
    nullable,
    default: hasDefault ? (raw['default'] as SpecLiteral) : null,
    index: index as NormalisedColumnSpec['index'],
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  // A Zod schema is the author's object; freezing it would break Zod's own caches.
  if (typeof (value as { safeParse?: unknown }).safeParse === 'function') return value;
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

/**
 * Apply the shape rules and build the frozen, branded declaration.
 *
 * `hosts` is the table set V2 is asked of. {@link defineColumnExtension} passes
 * the derived list; the platform's own tests pass a throwaway host table, so the
 * mechanism is proved without rolling out a real host (tasks.md T020). Not
 * published: a package declares through `defineColumnExtension` only.
 */
export function createColumnExtension(
  input: unknown,
  hosts: ReadonlySet<string> | null = new Set(EXTENSIBLE_HOSTS.keys()),
): ColumnExtension {
  const shape = resolveShape(input, hosts);
  const declaration = shape.declaration;
  resolvedByDeclaration.set(declaration, shape);
  return declaration;
}

/** The shape rules over `input`, and the frozen, branded declaration they admit. */
function resolveShape(input: unknown, hosts: ReadonlySet<string> | null): ResolvedColumnExtension {
  if (!isRecord(input)) {
    throw new SchemaExtensionInvalidError('not-a-declaration', String(input), null, 'a declaration is an object');
  }
  const moduleId = input['module'];
  if (typeof moduleId !== 'string' || !MODULE_ID_RE.test(moduleId)) {
    throw new SchemaExtensionInvalidError(
      'module-id',
      String(moduleId),
      null,
      'the module id matches ^[a-z][a-z0-9_]*$ — the declaring package\'s endora.id',
    );
  }
  const host = input['host'];
  if (typeof host !== 'string' || host.length === 0) {
    throw new SchemaExtensionInvalidError('host-not-extensible', moduleId, null, 'the declaration names no host table');
  }
  if (hosts !== null && !hosts.has(host)) {
    throw new SchemaExtensionInvalidError(
      'host-not-extensible',
      moduleId,
      null,
      `"${host}" is not an extensible host table; extensible hosts: ${[...hosts].sort().join(', ') || '(none)'}`,
    );
  }
  for (const key of NOT_OFFERED_DECLARATION_KEYS) {
    if (key in input) {
      throw new SchemaExtensionInvalidError('not-offered-yet', moduleId, null, `\`${key}\` is not offered (FR-060 – FR-063)`);
    }
  }
  if (input['adminReads'] !== undefined && typeof input['adminReads'] !== 'boolean') {
    throw new SchemaExtensionInvalidError('type-params', moduleId, null, '`adminReads` is a boolean');
  }
  const columns = input['columns'];
  if (!isRecord(columns)) {
    throw new SchemaExtensionInvalidError('type', moduleId, null, '`columns` is an object of column specs');
  }
  const keys = Object.keys(columns);
  if (keys.length > MAX_COLUMNS) {
    throw new SchemaExtensionInvalidError(
      'name-length',
      moduleId,
      null,
      `a declaration holds at most ${MAX_COLUMNS} columns, this one holds ${keys.length}`,
    );
  }

  const resolvedColumns: ResolvedColumn[] = keys.map((key) => {
    const spec = normaliseColumn({ moduleId, key }, columns[key]);
    const physicalName = physicalColumnName(moduleId, key);
    const raw = columns[key] as { schema?: z.ZodType };
    return {
      key,
      physicalName,
      spec,
      indexName: spec.index === false ? null : indexName(host, physicalName, spec.index === 'unique'),
      jsonSchema: spec.type === 'jsonb' ? (raw.schema ?? null) : null,
    };
  });

  // A declaration that is already branded is returned as it is: re-resolving
  // one must not mint a second object for the same declaration.
  const declaration = (
    isColumnExtension(input)
      ? input
      : deepFreeze(
          Object.defineProperty(
            {
              host,
              module: moduleId,
              columns: { ...columns },
              adminReads: input['adminReads'] === true,
              id: `${moduleId}:${host}`,
            },
            BRAND,
            { value: true, enumerable: false },
          ),
        )
  ) as unknown as ColumnExtension;
  return Object.freeze({ declaration, host, module: moduleId, columns: Object.freeze(resolvedColumns) });
}

/**
 * Declare additive extension columns on a host table.
 *
 * ```ts
 * export const acmeOrganizationColumns = defineColumnExtension({
 *   host: 'organizations',
 *   module: 'acme_erp',
 *   adminReads: true,
 *   columns: {
 *     erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
 *     creditTier: { type: 'smallint', default: 0 },
 *   },
 * });
 * ```
 *
 * Export it from the package's `./backend` subpath as
 * `schemaExtensions = [acmeOrganizationColumns]`; the platform generates the
 * DDL, records it in its `schema_extensions` ledger and verifies it.
 */
export function defineColumnExtension<
  const H extends ExtensibleHostTable,
  const M extends string,
  const C extends Record<string, ColumnSpec>,
>(declaration: ColumnExtensionInput<H, M, C>): ColumnExtension<H, M, C> {
  return createColumnExtension(declaration) as ColumnExtension<H, M, C>;
}
