import { raw, type FilterQuery } from '@mikro-orm/core';
import {
  OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS,
  OPPORTUNITY_BOARD_CARD_MAX_FIELDS,
  OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
  opportunityBoardBuiltinFieldRef,
  opportunityBoardCustomFieldRef,
  type CustomFieldDefinitionWithOptions,
  type OpportunityBoardBuiltinFieldKey,
  type OpportunityBoardCardField,
  type OpportunityBoardFieldKind,
  type OpportunityFieldFilter,
  type OpportunityFieldFilters,
} from '@endora-commerce/contracts';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { effectiveOpportunityValueSql } from './effective-value.js';

/**
 * What a board card can show and how the board is filtered by it
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12c, User Story
 * 19). Pure: the catalogue of built-in fields, the reading of the stored
 * choice, and a field filter as a condition on `crm_opportunities`.
 */

/** What each built-in field is to a renderer and to a filter. */
const BUILTIN_KINDS: Record<OpportunityBoardBuiltinFieldKey, OpportunityBoardFieldKind> = {
  number: 'text',
  organization: 'organization',
  contact: 'contact',
  assignee: 'assignee',
  value: 'money',
  salesChannel: 'salesChannel',
  tags: 'tags',
  expectedCloseDate: 'date',
  source: 'select',
  createdAt: 'date',
  updatedAt: 'date',
  closedAt: 'date',
  linkedOrders: 'number',
  linkedQuoteRequests: 'number',
};

const SOURCES = ['manual', 'order', 'quote_request'] as const;

/** The built-in fields a card can show; the Quote Request count only while that module is present. */
export function builtinBoardCardFields(quoteRequestsPresent: boolean): OpportunityBoardCardField[] {
  return OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS.filter(
    (key) => key !== 'linkedQuoteRequests' || quoteRequestsPresent,
  ).map((key) => ({
    ref: opportunityBoardBuiltinFieldRef(key),
    source: 'builtin' as const,
    key,
    kind: BUILTIN_KINDS[key],
    label: {},
    labelDefault: null,
    options:
      key === 'source' ? SOURCES.map((value) => ({ value, label: {}, labelDefault: value })) : [],
  }));
}

/** A custom field of the `opportunity` host type as a card field. */
export function customBoardCardField(entry: CustomFieldDefinitionWithOptions): OpportunityBoardCardField {
  const { definition, options } = entry;
  return {
    ref: opportunityBoardCustomFieldRef(definition.key),
    source: 'custom',
    key: definition.key,
    // The six value types of `custom_fields` are six of the kinds, by name.
    kind: definition.valueType,
    label: { ...definition.label },
    labelDefault: definition.labelDefault,
    options: [...options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((option) => ({ value: option.value, label: { ...option.label }, labelDefault: option.labelDefault })),
  };
}

/**
 * The stored choice as references — forgiving, because the Settings screen can
 * store anything under the code: a value that is not an array is the default,
 * an entry that is not a string or repeats one is skipped.
 */
export function storedBoardCardFieldRefs(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS];
  return [...new Set(stored.filter((entry): entry is string => typeof entry === 'string'))];
}

/** Whether a stored choice names a custom field at all — when not, no definition is read. */
export function namesCustomBoardField(refs: readonly string[]): boolean {
  return refs.some((ref) => ref.startsWith('custom:'));
}

/** The references that are offered, in their stored order, no more than a card shows. */
export function resolveBoardCardFields(
  refs: readonly string[],
  offered: readonly OpportunityBoardCardField[],
): OpportunityBoardCardField[] {
  const byRef = new Map(offered.map((field) => [field.ref, field]));
  return refs
    .map((ref) => byRef.get(ref))
    .filter((field): field is OpportunityBoardCardField => field !== undefined)
    .slice(0, OPPORTUNITY_BOARD_CARD_MAX_FIELDS);
}

// --- Field filters -----------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A predicate over `crm_opportunities f`, with its bound values in order. */
type Predicate = readonly [sql: string, params: readonly unknown[]];

const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
const dayStart = (date: string): string => `${date}T00:00:00.000Z`;

/** The first instant after the day named — a range is inclusive of its last day. */
function dayEnd(date: string): string {
  const end = new Date(dayStart(date));
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

/** `min` / `max` over a numeric SQL expression; `prefix` is that expression's own bound values. */
function bounds(expression: string, prefix: readonly unknown[], filter: OpportunityFieldFilter): Predicate[] {
  const predicates: Predicate[] = [];
  if (filter.min !== undefined) predicates.push([`${expression} >= ?::numeric`, [...prefix, filter.min]]);
  if (filter.max !== undefined) predicates.push([`${expression} <= ?::numeric`, [...prefix, filter.max]]);
  return predicates;
}

/** `from` / `to` over a timestamp column, by UTC day — as the list's `createdFrom` / `createdTo`. */
function instantRange(column: string, filter: OpportunityFieldFilter): Predicate[] {
  const predicates: Predicate[] = [];
  if (filter.from !== undefined) predicates.push([`f."${column}" >= ?::timestamptz`, [dayStart(filter.from)]]);
  if (filter.to !== undefined) predicates.push([`f."${column}" < ?::timestamptz`, [dayEnd(filter.to)]]);
  return predicates;
}

const linkCount = (kind: 'order' | 'quote_request'): string =>
  `(select count(*) from "crm_opportunity_links" l where l."opportunity_id" = f."id" and l."document_kind" = '${kind}')`;

function builtinPredicates(key: string, filter: OpportunityFieldFilter): Predicate[] {
  switch (key as OpportunityBoardBuiltinFieldKey) {
    case 'value':
      return bounds(effectiveOpportunityValueSql('f'), [], filter);
    case 'expectedCloseDate': {
      const predicates: Predicate[] = [];
      if (filter.from !== undefined) predicates.push(['f."expected_close_date" >= ?::date', [filter.from]]);
      if (filter.to !== undefined) predicates.push(['f."expected_close_date" <= ?::date', [filter.to]]);
      return predicates;
    }
    case 'updatedAt':
      return instantRange('updated_at', filter);
    case 'closedAt':
      return instantRange('closed_at', filter);
    case 'source':
      return filter.in === undefined ? [] : [[`f."source" in (${placeholders(filter.in)})`, filter.in]];
    case 'contact': {
      if (filter.in === undefined) return [];
      // An id that is not one names nobody: the filter then matches nothing.
      const ids = filter.in.filter((id) => UUID.test(id));
      return ids.length === 0
        ? [['false', []]]
        : [[`f."customer_account_id" in (${placeholders(ids)})`, ids]];
    }
    case 'linkedOrders':
      return bounds(linkCount('order'), [], filter);
    case 'linkedQuoteRequests':
      return bounds(linkCount('quote_request'), [], filter);
    // `organization`, `assignee`, `salesChannel`, `tags` and `createdAt` are
    // the list's own parameters (§1) and have no entry among the field filters;
    // neither has `number`, which `q` finds.
    default:
      return [];
  }
}

/**
 * A custom field's value is a member of the Opportunity's own
 * `custom_field_values` bag, so the filter is a condition on that column. The
 * key is the definition's, bound and never spliced.
 */
function customPredicates(field: OpportunityBoardCardField, filter: OpportunityFieldFilter): Predicate[] {
  const key = field.key;
  const text = 'f."custom_field_values"->>?';
  const json = 'f."custom_field_values"->?';
  switch (field.kind) {
    case 'text':
      return filter.contains === undefined ? [] : [[`${text} ilike ?`, [key, likePattern(filter.contains)]]];
    case 'number':
      // Cast only what is a number: a value stored before the definition's
      // type was what it is now must not fail the whole read.
      return bounds(`(case when jsonb_typeof(${json}) = 'number' then (${text})::numeric end)`, [key, key], filter);
    case 'boolean':
      if (filter.is === undefined) return [];
      return filter.is
        ? [[`${json} = 'true'::jsonb`, [key]]]
        : [[`${json} is distinct from 'true'::jsonb`, [key]]];
    case 'date': {
      // Stored as `YYYY-MM-DD`, which orders as text.
      const predicates: Predicate[] = [];
      if (filter.from !== undefined) predicates.push([`${text} >= ?`, [key, filter.from]]);
      if (filter.to !== undefined) predicates.push([`${text} <= ?`, [key, filter.to]]);
      return predicates;
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
    default:
      return [];
  }
}

/**
 * The field filters as conditions on `CrmOpportunity` — the one statement of
 * them, used by the list for the cards and by the board for its figures.
 *
 * **Only fields the card shows are filtered by**: a reference that is not among
 * `fields` is ignored, and so is an operator that does not belong to the
 * field's kind. Each condition is "the id is among those of the rows that
 * satisfy the predicate" — the shape of the tag filter — so it can only narrow
 * the tenant-scoped statement it joins, in an `em.find` and in a QueryBuilder
 * alike.
 *
 * Called once per statement: a raw fragment is not reused.
 */
export function boardFieldFilterConditions(
  fields: readonly OpportunityBoardCardField[],
  filters: OpportunityFieldFilters | undefined,
): FilterQuery<CrmOpportunity>[] {
  if (!filters) return [];
  const conditions: FilterQuery<CrmOpportunity>[] = [];
  for (const field of fields) {
    const filter = filters[field.ref];
    if (!filter) continue;
    const predicates =
      field.source === 'builtin' ? builtinPredicates(field.key, filter) : customPredicates(field, filter);
    for (const [sql, params] of predicates) {
      conditions.push({
        id: { $in: raw(`(select f."id" from "crm_opportunities" f where ${sql})`, [...params]) },
      });
    }
  }
  return conditions;
}
