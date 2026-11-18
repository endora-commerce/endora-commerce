import {
  TASK_LIST_SORTS,
  type CustomFieldFilters,
  type TaskListSort,
  type TaskSortDirection,
} from '@endora-commerce/contracts';
import {
  emptyCustomFieldFilters,
  readCustomFieldFilterParams,
  toCustomFieldFiltersParam,
  writeCustomFieldFilterParams,
} from '@endora-commerce/admin-kit/components';

/**
 * The Tasks filters as the address carries them (`specs/165-task-management/`
 * User Story 3 scenario 4, FR-020; research R-12, R-13).
 *
 * **The address is the state.** Each filter is a query parameter named as the
 * API names it, so the list, the board and *My Tasks* read one set of filters,
 * a filtered screen can be reloaded or sent to a colleague, and switching
 * between list and board carries everything over. Custom-field filters are the
 * kit's `cf.<key>.<op>` parameters, turned into the API's `customFieldFilters`
 * only when a request is made. The list's sort is two more parameters, which
 * the board ignores.
 */

/** The filters that repeat (any of; for tags, all of). */
export const REPEATED_FILTERS = ['status', 'statusCategory', 'assignee', 'priority', 'tagId'] as const;
/** The filters that take one value. */
export const SINGLE_FILTERS = [
  'q',
  'creator',
  'dueFrom',
  'dueTo',
  'overdue',
  'linkedKind',
  'linkedId',
  'contextType',
  'contextId',
  'parentId',
  'isSubtask',
  'hasSubtasks',
  'draft',
  'private',
] as const;

export type RepeatedFilter = (typeof REPEATED_FILTERS)[number];
export type SingleFilter = (typeof SINGLE_FILTERS)[number];

/** Narrowing to one record the screen has no picker for: shown as a notice that removes it. */
export const RECORD_FILTERS = ['linkedKind', 'linkedId', 'contextType', 'contextId', 'parentId'] as const;

export interface TaskSort {
  sort: TaskListSort;
  dir: TaskSortDirection;
}

export const DEFAULT_SORT: TaskSort = { sort: 'created', dir: 'desc' };

const SORTS: ReadonlySet<string> = new Set(TASK_LIST_SORTS);

/** The sort the address names, or the list's default. */
export function readSort(params: URLSearchParams): TaskSort {
  const sort = params.get('sort');
  const dir = params.get('dir');
  if (sort === null || !SORTS.has(sort)) return DEFAULT_SORT;
  return { sort: sort as TaskListSort, dir: dir === 'asc' || dir === 'desc' ? dir : DEFAULT_SORT.dir };
}

/** `params` with only the filters (and custom-field filters) kept — what the list, the board and a saved view share. */
export function filtersOnly(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of REPEATED_FILTERS) for (const value of params.getAll(key)) if (value) next.append(key, value);
  for (const key of SINGLE_FILTERS) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return writeCustomFieldFilterParams(next, readCustomFieldFilterParams(params));
}

/** Whether the address narrows anything — the empty state then offers to clear. */
export function hasFilters(params: URLSearchParams): boolean {
  return filtersOnly(params).toString() !== '';
}

/**
 * How many of the filters the filter bar folds behind *More filters* are in
 * use (issue #512) — so a collapsed bar still says the list is narrowed. A
 * filter the screen implies (*My Tasks*' open, published Tasks) is not offered
 * and so not counted; each custom-field filter counts as one.
 */
export function hiddenFilterCount(
  params: URLSearchParams,
  implied: { statusCategory?: boolean; draft?: boolean } = {},
): number {
  const present = (key: string): boolean => params.getAll(key).some(Boolean);
  const hidden = [
    !implied.statusCategory && present('statusCategory'),
    present('creator'),
    present('priority'),
    present('tagId'),
    present('isSubtask') || present('hasSubtasks'),
    !implied.draft && present('draft'),
    present('private'),
  ].filter(Boolean).length;
  return hidden + Object.keys(readCustomFieldFilterParams(params)).length;
}

/** One filter set, others kept; an empty value removes it. Sort and custom-field filters untouched. */
export function withFilter(
  params: URLSearchParams,
  key: RepeatedFilter | SingleFilter | 'sort' | 'dir',
  value: string | readonly string[] | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(key);
  const values = value === null ? [] : typeof value === 'string' ? [value] : value;
  for (const item of values) if (item) next.append(key, item);
  return next;
}

/** The custom-field filters of the address. */
export function customFilters(params: URLSearchParams): CustomFieldFilters {
  return readCustomFieldFilterParams(params);
}

/**
 * The API query of the address: its filters, `customFieldFilters` as the
 * server takes it (only for a reader who may view custom fields), and the
 * implied filters a screen adds (*My Tasks*: `assignee=me`, open, published).
 */
export function apiQuery(
  params: URLSearchParams,
  options: { customFields: boolean; implied?: URLSearchParams; withSort?: boolean },
): URLSearchParams {
  const filters = filtersOnly(params);
  const out = new URLSearchParams();
  for (const [key, value] of filters) if (!key.startsWith('cf.')) out.append(key, value);
  if (options.customFields) {
    const custom = toCustomFieldFiltersParam(readCustomFieldFilterParams(params));
    if (custom !== null) out.set('customFieldFilters', custom);
  }
  for (const [key, value] of options.implied ?? []) {
    out.delete(key);
    out.append(key, value);
  }
  if (options.withSort) {
    const sort = readSort(params);
    if (sort.sort !== DEFAULT_SORT.sort || sort.dir !== DEFAULT_SORT.dir) {
      out.set('sort', sort.sort);
      out.set('dir', sort.dir);
    }
  }
  return out;
}

/** A saved view's `filters`: the address's filters as JSON — lists for repeated ones, `cf` for custom fields. */
export function toSavedFilters(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REPEATED_FILTERS) {
    const values = params.getAll(key).filter(Boolean);
    if (values.length > 0) out[key] = values;
  }
  for (const key of SINGLE_FILTERS) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  const custom = toCustomFieldFiltersParam(readCustomFieldFilterParams(params));
  if (custom !== null) out['cf'] = JSON.parse(custom) as unknown;
  return out;
}

/** What a saved view no longer matches: the codes and ids the screen knows exist today. */
export interface KnownValues {
  statuses: ReadonlySet<string> | null;
  priorities: ReadonlySet<string> | null;
  tags: ReadonlySet<string> | null;
}

/**
 * The address a saved view stands for, its sort included, with every value
 * that no longer exists left out — a removed status, priority or tag (research
 * R-13) — and how many were. A list the screen could not read (`null`) drops
 * nothing: the server matches an unknown value with nothing rather than
 * refusing it.
 */
export function fromSavedView(
  filters: Record<string, unknown>,
  sort: { field: string; dir: 'asc' | 'desc' } | null,
  known: KnownValues,
): { params: URLSearchParams; dropped: number } {
  let dropped = 0;
  let params = new URLSearchParams();
  const keep = (key: RepeatedFilter, value: string): boolean => {
    const set =
      key === 'status' ? known.statuses : key === 'priority' ? known.priorities : key === 'tagId' ? known.tags : null;
    if (set === null || (key === 'priority' && value === 'none') || set.has(value)) return true;
    dropped += 1;
    return false;
  };
  for (const key of REPEATED_FILTERS) {
    const raw = filters[key];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const value of values) if (typeof value === 'string' && value && keep(key, value)) params.append(key, value);
  }
  for (const key of SINGLE_FILTERS) {
    const value = filters[key];
    if (typeof value === 'string' && value) params.set(key, value);
    else if (typeof value === 'boolean') params.set(key, String(value));
  }
  const custom = filters['cf'];
  if (typeof custom === 'object' && custom !== null && !Array.isArray(custom)) {
    params = writeCustomFieldFilterParams(params, parseCustomFilterJson(JSON.stringify(custom)));
  }
  if (sort && SORTS.has(sort.field)) {
    params.set('sort', sort.field);
    params.set('dir', sort.dir);
  }
  return { params, dropped };
}

/** `customFieldFilters` JSON back to the kit's record, through its own address reader (which validates). */
function parseCustomFilterJson(json: string): CustomFieldFilters {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return emptyCustomFieldFilters();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyCustomFieldFilters();
  const asAddress = writeCustomFieldFilterParams(new URLSearchParams(), value as CustomFieldFilters);
  return readCustomFieldFilterParams(asAddress);
}
