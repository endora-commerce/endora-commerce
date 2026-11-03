import {
  PRODUCT_FIELD_SCOPE_SETS,
  attributeFieldSpec,
  type AttributeValueType,
  type FieldPath,
  type FieldScopeSpec,
  type ScopeLevel,
  type ScopeRef,
} from '@endora-commerce/contracts';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/contracts/import-profiles-and-csv.md`
 * §2.1, research R14) — the one anchored header grammar of the products file.
 *
 * | Column | Meaning |
 * | --- | --- |
 * | `sku` | the key |
 * | `id`, `slug`, `type` | export-only, ignored on import |
 * | `visibility` | Global only |
 * | `<field>` | the Global value |
 * | `<field>@<channel code>` | the Channel scope |
 * | `<field>@<channel code>/<language>` | the Channel × language scope (fields whose set has CL) |
 * | `<field>[<locale>]`, `<field>[<locale>\|<source channel>]` | a source-locale value, mapped by the profile |
 *
 * `<field>` is `name`, `description`, `urlKey`, `status`, `minOrderQuantity`, `returnable` or
 * `attribute:<key>` (coordinator ruling 2026-11-03: the minimum order quantity, the returnable
 * flag and multiselect attributes travel at G and C; MOQ `NULL` = no minimum, multiselect
 * `NULL` = none selected). Every header
 * either matches exactly one rule or is a file error, and so is an unknown channel code, a
 * language the channel does not offer, an unknown attribute, a scope the field's set lacks, and
 * two headers naming the same column after normalisation (locale tags compare
 * case-insensitively with `_` = `-`; languages and channel codes case-insensitively).
 */

/** Channel and source-channel codes (R14). */
const CODE = '[A-Za-z0-9_.-]{1,100}';
const FIELD = '(name|description|urlKey|status|minOrderQuantity|returnable|attribute:[a-z0-9_]{1,64})';
const LANGUAGE = '([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)';
const LOCALE = '([A-Za-z]{2,3}(?:[_-][A-Za-z]{2})?)';
const GLOBAL_COLUMN = new RegExp(`^${FIELD}$`);
const SCOPE_COLUMN = new RegExp(`^${FIELD}@(${CODE})(?:/${LANGUAGE})?$`);
const LOCALE_COLUMN = new RegExp(`^${FIELD}\\[${LOCALE}(?:\\|(${CODE}))?\\]$`);

/** The most columns and rows one products file carries (`import-profiles-and-csv.md` §2). */
export const PRODUCTS_CSV_COLUMNS_MAX = 500;
export const PRODUCTS_CSV_ROWS_MAX = 50_000;
/** The longest cell (a description, `scoped-values-api.md` R21 bounds). */
export const PRODUCTS_CSV_CELL_MAX = 20_000;
/**
 * The most row errors, and the most field errors, one report lists (C2/C3 security review): the
 * file caps alone allow 25 million refused cells. The rest are counted, never listed.
 */
export const PRODUCTS_REPORT_ERRORS_MAX = 1_000;

export interface GrammarChannel {
  id: string;
  code: string;
  languages: readonly string[];
}

export interface GrammarAttribute {
  key: string;
  valueType: AttributeValueType;
  scopable: boolean;
  isRequired: boolean;
}

export interface ProductsHeaderContext {
  channels: readonly GrammarChannel[];
  attributes: ReadonlyMap<string, GrammarAttribute>;
}

/**
 * How a column's cells read. A text column is read verbatim (never trimmed); a guarded column
 * takes the formula guard both ways (FR-118). Every text column is guarded, and so is an option
 * column (select, enum, multiselect): its values are text a PIM sync can create (C2/C3 security
 * review). Numbers, prices, booleans, dates and the status are neither.
 */
export interface FieldInfo {
  field: FieldPath;
  spec: FieldScopeSpec;
  text: boolean;
  guarded: boolean;
  valueType: AttributeValueType | 'text' | 'status';
}

export type ProductsColumn =
  | { kind: 'key'; header: string }
  | { kind: 'ignored'; header: string }
  | { kind: 'visibility'; header: string }
  | { kind: 'scoped'; header: string; info: FieldInfo; scope: ScopeRef }
  | { kind: 'locale'; header: string; info: FieldInfo; locale: string; sourceChannel: string | null };

export type HeaderParse = { ok: true; columns: ProductsColumn[] } | { ok: false; errors: string[] };

const EXPORT_ONLY = new Set(['id', 'slug', 'type']);

/** The product fields whose cells are values, not text: no formula guard, typed on import. */
const VALUE_FIELDS: Readonly<Record<string, FieldInfo['valueType']>> = {
  status: 'status',
  minOrderQuantity: 'number',
  returnable: 'boolean',
};

/** Whether an attribute's cells take the formula guard: text and option values do. */
export function isGuardedAttributeType(valueType: AttributeValueType): boolean {
  return valueType === 'string' || valueType === 'select' || valueType === 'enum' || valueType === 'multiselect';
}

function fieldInfo(field: string, ctx: ProductsHeaderContext): FieldInfo | string {
  if (field.startsWith('attribute:')) {
    const key = field.slice('attribute:'.length);
    const def = ctx.attributes.get(key);
    if (def === undefined) return `unknown attribute "${key}"`;
    return {
      field: field as FieldPath,
      spec: attributeFieldSpec(def),
      text: def.valueType === 'string',
      guarded: isGuardedAttributeType(def.valueType),
      valueType: def.valueType,
    };
  }
  const spec = (PRODUCT_FIELD_SCOPE_SETS as Record<string, FieldScopeSpec>)[field]!;
  const valueType = VALUE_FIELDS[field];
  return {
    field: field as FieldPath,
    spec,
    text: valueType === undefined,
    guarded: valueType === undefined,
    valueType: valueType ?? 'text',
  };
}

const levelOf = (scope: ScopeRef): ScopeLevel =>
  scope.level === 'global' ? 'G' : scope.level === 'channel' ? 'C' : 'CL';

const normalisedLocale = (tag: string): string => tag.toLowerCase().replace(/-/g, '_');

/** Parse the header row (§2.1). The order of the answer is the order of the header. */
export function parseProductsHeader(header: readonly string[], ctx: ProductsHeaderContext): HeaderParse {
  const errors: string[] = [];
  const columns: ProductsColumn[] = [];
  const seen = new Map<string, string>();
  const byCode = new Map(ctx.channels.map((channel) => [channel.code.toLowerCase(), channel]));

  if (header.length > PRODUCTS_CSV_COLUMNS_MAX) {
    return { ok: false, errors: [`The file has ${header.length} columns; at most ${PRODUCTS_CSV_COLUMNS_MAX} are accepted.`] };
  }

  for (const raw of header) {
    const name = raw.trim();
    let column: ProductsColumn | null = null;
    let key = '';
    if (name === 'sku') {
      column = { kind: 'key', header: name };
      key = 'sku';
    } else if (EXPORT_ONLY.has(name)) {
      column = { kind: 'ignored', header: name };
      key = name;
    } else if (name === 'visibility') {
      column = { kind: 'visibility', header: name };
      key = name;
    } else if (GLOBAL_COLUMN.test(name)) {
      const info = fieldInfo(name, ctx);
      if (typeof info === 'string') {
        errors.push(`${name}: ${info}`);
        continue;
      }
      column = { kind: 'scoped', header: name, info, scope: { level: 'global' } };
      key = `${name}@G`;
    } else if (SCOPE_COLUMN.test(name)) {
      const [, field, code, language] = SCOPE_COLUMN.exec(name)!;
      const info = fieldInfo(field!, ctx);
      if (typeof info === 'string') {
        errors.push(`${name}: ${info}`);
        continue;
      }
      const channel = byCode.get(code!.toLowerCase());
      if (channel === undefined) {
        errors.push(`${name}: unknown sales channel "${code}"`);
        continue;
      }
      let scope: ScopeRef = { level: 'channel', channelId: channel.id };
      if (language !== undefined) {
        const spelled = channel.languages.find((l) => l.toLowerCase() === language.toLowerCase());
        if (spelled === undefined) {
          errors.push(`${name}: the channel "${channel.code}" does not offer the language "${language}"`);
          continue;
        }
        scope = { level: 'channel_language', channelId: channel.id, languageCode: spelled };
      }
      if (!info.spec.levels.includes(levelOf(scope))) {
        errors.push(`${name}: "${field}" cannot be set at this scope (its levels are ${info.spec.levels.join(', ')})`);
        continue;
      }
      column = { kind: 'scoped', header: name, info, scope };
      key = `${field}@${channel.id}${scope.level === 'channel_language' ? `/${scope.languageCode.toLowerCase()}` : ''}`;
    } else if (LOCALE_COLUMN.test(name)) {
      const [, field, locale, sourceChannel] = LOCALE_COLUMN.exec(name)!;
      const info = fieldInfo(field!, ctx);
      if (typeof info === 'string') {
        errors.push(`${name}: ${info}`);
        continue;
      }
      column = { kind: 'locale', header: name, info, locale: locale!, sourceChannel: sourceChannel ?? null };
      key = `${field}[${normalisedLocale(locale!)}|${(sourceChannel ?? '').toLowerCase()}]`;
    } else {
      errors.push(`${name === '' ? '(empty header)' : name.slice(0, 120)}: not a column of the products file`);
      continue;
    }
    const previous = seen.get(key);
    if (previous !== undefined) {
      errors.push(`${name}: names the same column as "${previous}"`);
      continue;
    }
    seen.set(key, name);
    columns.push(column);
  }
  if (!columns.some((column) => column.kind === 'key')) errors.push('Missing required header column: sku');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, columns };
}

/** A products file refused as a whole (`import-profiles-and-csv.md` §2.1): no row is imported. */
export class ProductsFileError extends Error {
  constructor(readonly fileErrors: readonly string[]) {
    super(`The products file is not valid: ${fileErrors.slice(0, 5).join('; ')}`);
    this.name = 'ProductsFileError';
  }
}
