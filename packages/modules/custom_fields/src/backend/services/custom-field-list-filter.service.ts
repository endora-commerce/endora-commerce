import {
  assertCustomFieldFilterOperators,
  assertCustomFieldFilterRanges,
  customFieldFiltersSchema,
  type CustomFieldFilter,
  type CustomFieldFilterUnavailableFailure,
  type CustomFieldFilters,
  type CustomFieldListFilterCondition,
  type CustomFieldListFilterField,
  type CustomFieldListFilterPort,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import { isEntityTypeServed } from './custom-field-registry.js';
import { hostStorageBinding } from './host-storage-binding.js';

/** The per-entity definitions the port reads — the definition service's cache. */
export interface ListFilterDefinitionSource {
  listForEntity(entityType: SupportedEntityType): Promise<CachedDefinition[]>;
}

/** What {@link CustomFieldListFilterService.condition} throws for filters a list does not offer. */
export class CustomFieldFilterUnavailableError extends Error implements CustomFieldFilterUnavailableFailure {
  override readonly name = 'CustomFieldFilterUnavailableError' as const;

  constructor(readonly keys: readonly string[]) {
    // Every key passed the definition key grammar before it got here.
    super(`The custom-field filter on ${keys.map((key) => `"${key}"`).join(', ')} is not available on this list.`);
  }
}

/** One SQL predicate and the values its `?` placeholders bind, in order. */
type Predicate = readonly [sql: string, params: readonly unknown[]];

const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

/** A case-insensitive substring pattern with `%`, `_` and `\` taken literally. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

/**
 * The predicates of one key, over the bound value-bag column `column` of the
 * row alias `t`. Each requires the key to be present and of the type, so a
 * record without a value matches none. The key and every value are bound,
 * never spliced; there is no jsonb `?` operator (it collides with the
 * placeholder) and no `::date` cast (dates compare as `YYYY-MM-DD` text).
 *
 * Adapted from the CRM board's field predicates, with two deliberate
 * differences: `is: false` matches a stored `false` only, not "false or never
 * set" (`specs/157-custom-fields-list-filters/research.md` R-5), and a date
 * bound compares only a stored string.
 */
function predicates(column: string, definition: CachedDefinition['definition'], filter: CustomFieldFilter): Predicate[] {
  const key = definition.key;
  const text = `t."${column}"->>?`;
  const json = `t."${column}"->?`;
  switch (definition.valueType) {
    case 'text':
      return filter.contains === undefined ? [] : [[`${text} ilike ?`, [key, likePattern(filter.contains)]]];
    case 'number': {
      // Cast only what is a number: a value stored before the definition's
      // type was what it is now must neither match nor fail the read.
      const bound = (operator: '>=' | '<=', value: string): Predicate => [
        `case when jsonb_typeof(${json}) = 'number' then (${text})::numeric ${operator} ?::numeric end`,
        [key, key, value],
      ];
      const result: Predicate[] = [];
      if (filter.min !== undefined) result.push(bound('>=', filter.min));
      if (filter.max !== undefined) result.push(bound('<=', filter.max));
      return result;
    }
    case 'boolean':
      if (filter.is === undefined) return [];
      return [[`${json} = ${filter.is ? `'true'` : `'false'`}::jsonb`, [key]]];
    case 'date': {
      // Compared as `YYYY-MM-DD` text, and only where such a date is stored: a
      // value that drifted to another type or shape neither matches nor fails
      // the read.
      const bound = (operator: '>=' | '<=', value: string): Predicate => [
        `case when jsonb_typeof(${json}) = 'string' and ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then ${text} ${operator} ? end`,
        [key, key, key, value],
      ];
      const result: Predicate[] = [];
      if (filter.from !== undefined) result.push(bound('>=', filter.from));
      if (filter.to !== undefined) result.push(bound('<=', filter.to));
      return result;
    }
    case 'select':
      return filter.in === undefined ? [] : [[`${text} in (${placeholders(filter.in)})`, [key, ...filter.in]]];
    case 'multiselect':
      return filter.in === undefined
        ? []
        : [
            [
              `exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(${json}) = 'array' then ${json} else '[]'::jsonb end) as chosen(value) where chosen.value in (${placeholders(filter.in)}))`,
              [key, key, ...filter.in],
            ],
          ];
    case 'page_builder':
      // Feature 172 — no operator applies to a Page Builder document, so the
      // operator check refuses every filter on one before this is reached.
      return [];
    default:
      return [];
  }
}

/**
 * `customFieldListFilterPort` (`specs/157-custom-fields-list-filters/contracts/list-filter-api.md`
 * §1.4) — what an admin list offers as custom-field filters, and a request's
 * filters as **one** condition: one scan of the entity's bound host table with
 * every predicate ANDed in its `where`, so a request costs the same scan
 * whatever it filters on.
 *
 * The condition is an id sub-select. A host only ever intersects it with its
 * own tenant-scoped, assignment-scoped statement, so it cannot widen what the
 * caller sees; and the refusal depends on definitions, never on rows.
 */
export class CustomFieldListFilterService implements CustomFieldListFilterPort {
  constructor(
    private readonly definitions: ListFilterDefinitionSource,
    private readonly isServed: (entityType: SupportedEntityType) => boolean = isEntityTypeServed,
  ) {}

  async listFilterable(entityType: SupportedEntityType): Promise<CustomFieldListFilterField[]> {
    const offered = await this.offered(entityType);
    return [...offered.values()]
      .sort(
        (a, b) =>
          a.definition.sortOrder - b.definition.sortOrder || a.definition.key.localeCompare(b.definition.key),
      )
      .map(({ definition, options }) => ({
        key: definition.key,
        valueType: definition.valueType,
        label: definition.label ?? {},
        labelDefault: definition.labelDefault,
        options: [...options]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((option) => ({ value: option.value, label: option.label ?? {}, labelDefault: option.labelDefault })),
      }));
  }

  async condition(
    entityType: SupportedEntityType,
    filters: CustomFieldFilters | undefined,
  ): Promise<CustomFieldListFilterCondition | null> {
    if (filters === undefined || Object.keys(filters).length === 0) return null;
    // The caps hold for every host, whatever its own parameter schema allowed:
    // a breach is the ZodError `parse` throws, answered 400 by the platform.
    const parsed = customFieldFiltersSchema.parse(filters);
    const keys = Object.keys(parsed);

    const offered = await this.offered(entityType);
    const unavailable = keys.filter((key) => !offered.has(key));
    if (unavailable.length > 0) throw new CustomFieldFilterUnavailableError(unavailable);
    // An operator that does not apply to its field is refused, never ignored
    // (FR-011): a ZodError, answered 400 `VALIDATION_FAILED`.
    assertCustomFieldFilterOperators(parsed, (key) => offered.get(key)?.definition.valueType);
    // An inverted range could only match nothing: refused, not answered empty.
    assertCustomFieldFilterRanges(parsed);

    const { table, column } = hostStorageBinding(entityType);
    const built: Predicate[] = [];
    for (const key of keys) {
      const filter = parsed[key];
      if (filter) built.push(...predicates(column, offered.get(key)!.definition, filter));
    }
    if (built.length === 0) return null;
    return {
      sql: `select t."id" from "${table}" t where ${built.map(([sql]) => `(${sql})`).join(' and ')}`,
      params: built.flatMap(([, params]) => params),
    };
  }

  /** The served, list-filter definitions of `entityType`, by key — a `Map`, never a plain-object index. */
  private async offered(entityType: SupportedEntityType): Promise<Map<string, CachedDefinition>> {
    const offered = new Map<string, CachedDefinition>();
    if (!this.isServed(entityType)) return offered;
    for (const cached of await this.definitions.listForEntity(entityType)) {
      if (cached.definition.entityType === entityType && cached.definition.listFilter) {
        offered.set(cached.definition.key, cached);
      }
    }
    return offered;
  }
}
