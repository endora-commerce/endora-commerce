import {
  OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
  OpportunityFieldFilterSchema,
  opportunityBoardFieldRefSchema,
  type OpportunityBoardCardField,
  type OpportunityBoardFieldKind,
  type OpportunityFieldFilter,
  type OpportunityFieldFilters,
} from '@endora-commerce/contracts';
import {
  NO_SHARED_FILTERS,
  type AssigneeFilter,
  type SharedOpportunityFilters,
} from '../components/OpportunityFilterFields.js';

/**
 * The board's fields and filters as the Admin UI holds them
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12c, User Story
 * 19): which operators a field's filter has, and the board's filters as its
 * address carries them.
 */

/** The operators of a field's filter, by its kind — the server's table, §12c. */
const OPERATORS: Partial<Record<OpportunityBoardFieldKind, readonly (keyof OpportunityFieldFilter)[]>> = {
  text: ['contains'],
  number: ['min', 'max'],
  money: ['min', 'max'],
  boolean: ['is'],
  date: ['from', 'to'],
  select: ['in'],
  multiselect: ['in'],
  contact: ['in'],
};

/** Fields of a filterable kind that the board's shared filters already cover (§12c). */
const COVERED_BY_SHARED_FILTERS: ReadonlySet<string> = new Set(['builtin:createdAt', 'builtin:number']);

/**
 * The operators of `field`'s own filter; none for a field the shared filters
 * already cover — the Organization, the assignee, the Sales Channel, the tags,
 * the creation date, and the number, which the search box finds.
 */
export function fieldFilterOperators(field: OpportunityBoardCardField): readonly (keyof OpportunityFieldFilter)[] {
  if (COVERED_BY_SHARED_FILTERS.has(field.ref)) return [];
  return OPERATORS[field.kind] ?? [];
}

/** The card before anybody configured it, for a board answer that names no fields. */
export const DEFAULT_BOARD_CARD_FIELDS: OpportunityBoardCardField[] = OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS.map(
  (ref) => {
    const key = ref.replace(/^builtin:/, '');
    const kinds: Record<string, OpportunityBoardFieldKind> = {
      number: 'text',
      organization: 'organization',
      value: 'money',
      assignee: 'assignee',
      tags: 'tags',
    };
    return { ref, source: 'builtin', key, kind: kinds[key] ?? 'text', label: {}, labelDefault: null, options: [] };
  },
);

/** A field's name: a custom field's own label in the reader's language, a built-in one's from the bundle. */
export function boardFieldLabel(
  field: OpportunityBoardCardField,
  language: string,
  t: (key: string) => string,
): string {
  if (field.source === 'builtin') return t(`board.field.${field.key}`);
  return field.label[language] ?? field.label[language.split('-')[0] ?? language] ?? field.labelDefault ?? field.key;
}

/** One option's name in the reader's language. */
export function boardFieldOptionLabel(
  field: OpportunityBoardCardField,
  value: string,
  language: string,
  t: (key: string) => string,
): string {
  if (field.ref === 'builtin:source') return t(`opportunity.source.${value}`);
  const option = field.options.find((candidate) => candidate.value === value);
  return option ? (option.label[language] ?? option.labelDefault) : value;
}

// --- The board's filters in its address --------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** As many fields as one request may name (§12c). */
const MAX_FILTERED_FIELDS = 20;
const ASSIGNEE_TOKENS: ReadonlySet<string> = new Set(['me', 'unassigned', 'person']);
const FIELD_PARAM = /^f\.((?:builtin|custom):[A-Za-z0-9_]+)\.(contains|in|is|min|max|from|to)$/;

export interface BoardFilters {
  shared: SharedOpportunityFilters;
  fields: OpportunityFieldFilters;
}

export const NO_BOARD_FILTERS: BoardFilters = { shared: NO_SHARED_FILTERS, fields: {} };

/**
 * One operator of a field filter as the server would take it, or `null` when
 * it would refuse it. **The server's own schema decides** — a second statement
 * of "a date", "a number" or "a text" here is one that drifts, and it had: a
 * date no calendar has, a text of spaces and an over-long option each passed
 * this file's patterns and had the whole board refused.
 */
function accepted<K extends keyof OpportunityFieldFilter>(
  operator: K,
  value: unknown,
): OpportunityFieldFilter[K] | null {
  const parsed = OpportunityFieldFilterSchema.safeParse({ [operator]: value });
  return parsed.success ? (parsed.data[operator] ?? null) : null;
}

/** A day of the calendar as `YYYY-MM-DD`, or nothing — the shape `from` has. */
const calendarDate = (value: string | null): string => (value ? (accepted('from', value) ?? '') : '');

/**
 * The filters an address carries. Forgiving: a parameter that is not of its
 * shape is left out, so an address somebody edited by hand still opens — the
 * server would refuse the whole board for one malformed bound.
 */
export function readBoardFilters(params: URLSearchParams): BoardFilters {
  const assignee = params.get('assignee') ?? '';
  const person = UUID.test(assignee);
  const date = (name: string): string => calendarDate(params.get(name));
  const uuid = (name: string): string | null => (UUID.test(params.get(name) ?? '') ? params.get(name) : null);
  const shared: SharedOpportunityFilters = {
    q: (params.get('q') ?? '').slice(0, 200),
    organizationId: uuid('organizationId'),
    // `person` alone: "a person" was chosen and nobody yet — the picker is open, nothing is filtered.
    assignee: person ? 'person' : ASSIGNEE_TOKENS.has(assignee) ? (assignee as AssigneeFilter) : '',
    assigneeId: person ? assignee : null,
    tagIds: params.getAll('tagId').filter((id) => UUID.test(id)),
    salesChannelId: uuid('salesChannelId'),
    createdFrom: date('createdFrom'),
    createdTo: date('createdTo'),
  };

  const fields: Record<string, OpportunityFieldFilter> = {};
  for (const name of new Set(params.keys())) {
    const match = FIELD_PARAM.exec(name);
    if (!match) continue;
    const [, ref, operator] = match as unknown as [string, string, keyof OpportunityFieldFilter];
    if (!opportunityBoardFieldRefSchema.safeParse(ref).success) continue;
    if (!(ref in fields) && Object.keys(fields).length >= MAX_FILTERED_FIELDS) continue;
    const values = params.getAll(name).filter((value) => value !== '');
    const first = values[0];
    if (first === undefined) continue;
    const filter: OpportunityFieldFilter = { ...fields[ref] };
    if (operator === 'in') {
      const options = values.filter((value) => accepted('in', [value]) !== null).slice(0, 50);
      if (options.length > 0) filter.in = options;
    } else if (operator === 'is') {
      if (first === 'true' || first === 'false') filter.is = first === 'true';
    } else {
      const value = accepted(operator, operator === 'contains' ? first.slice(0, 200) : first);
      if (value !== null) filter[operator] = value;
    }
    if (Object.keys(filter).length > 0) fields[ref] = filter;
  }
  return { shared, fields };
}

/** The same filters as query parameters — the inverse of {@link readBoardFilters}. */
export function writeBoardFilters(filters: BoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  const { shared } = filters;
  if (shared.q.trim()) params.set('q', shared.q.trim());
  if (shared.organizationId) params.set('organizationId', shared.organizationId);
  if (shared.assignee !== '') params.set('assignee', shared.assigneeId ?? shared.assignee);
  for (const tagId of shared.tagIds) params.append('tagId', tagId);
  if (shared.salesChannelId) params.set('salesChannelId', shared.salesChannelId);
  if (shared.createdFrom) params.set('createdFrom', shared.createdFrom);
  if (shared.createdTo) params.set('createdTo', shared.createdTo);
  for (const [ref, filter] of Object.entries(filters.fields)) {
    for (const [operator, value] of Object.entries(filter)) {
      if (value === undefined || value === '') continue;
      const name = `f.${ref}.${operator}`;
      if (Array.isArray(value)) for (const entry of value) params.append(name, entry);
      else params.set(name, String(value));
    }
  }
  return params;
}

/**
 * Field filters as one text whatever order they were put together in — two
 * addresses that say the same thing are one request, not two.
 */
export function fieldFiltersKey(filters: OpportunityFieldFilters): string {
  const sorted = <T>(record: Record<string, T>): Array<[string, T]> =>
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(
    Object.fromEntries(sorted(filters).map(([ref, filter]) => [ref, Object.fromEntries(sorted(filter))])),
  );
}

/**
 * The field filters the server is sent: those of a field the card shows, with
 * the operators of its kind, nothing empty. The server ignores the rest too;
 * this keeps the request, and "is anything filtered?", honest.
 */
export function activeFieldFilters(
  filters: OpportunityFieldFilters,
  cardFields: readonly OpportunityBoardCardField[],
): OpportunityFieldFilters {
  const active: Record<string, OpportunityFieldFilter> = {};
  for (const field of cardFields) {
    const filter = filters[field.ref];
    if (!filter) continue;
    const kept: OpportunityFieldFilter = {};
    for (const operator of fieldFilterOperators(field)) {
      const value = filter[operator];
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
      Object.assign(kept, { [operator]: typeof value === 'string' ? value.trim() : value });
    }
    if (kept.contains === '') delete kept.contains;
    if (Object.keys(kept).length > 0) active[field.ref] = kept;
  }
  return active;
}
