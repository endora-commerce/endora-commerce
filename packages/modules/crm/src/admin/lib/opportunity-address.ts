import { opportunityStatusCodeSchema, type AdminListViewMode, type OpportunityStatusKind } from '@endora-commerce/contracts';
import type { SharedOpportunityFilters } from '../components/OpportunityFilterFields.js';
import { readBoardFilters, writeBoardFilters, type BoardFilters } from './board-fields.js';

/**
 * The Opportunities page's address (issue #1558, UX audit WORK-07, DEC-13).
 *
 * The list and the board are **one page**, `/crm/opportunities`; the board is
 * `?view=board`. One address holds the filters of both views, and switching
 * view changes `view` alone — so the filters the two share (the search, the
 * Organization, the assignee, the tags, the Sales Channel, the creation dates)
 * carry over, and each view's own ones (the list's state, status, sort and
 * custom-field filters; the board's card-field filters) wait in the address
 * until that view is back. **Each view writes only the parameters it owns.**
 */

/** The page's path; the board's former one redirects here. */
export const OPPORTUNITIES_PATH = '/crm/opportunities';

const VIEW_PARAM = 'view';

/** The parameters the shared filters are written as — {@link writeBoardFilters}' own names. */
const SHARED_PARAMS: readonly string[] = [
  'q',
  'organizationId',
  'assignee',
  'tagId',
  'salesChannelId',
  'createdFrom',
  'createdTo',
];
const STATE_PARAM = 'state';
const STATUS_PARAM = 'status';
const SORT_PARAM = 'sort';
/** The list's custom-field filters, the kit's `cf.<key>.<op>`. */
const CUSTOM_FIELD_PREFIX = 'cf.';
/** The board's card-field filters, `f.<ref>.<op>`. */
const BOARD_FIELD_PREFIX = 'f.';
/** The board's contact-person filter, one of its card-field filters. */
const CONTACT_FILTER_PREFIX = 'f.builtin:contact.';

/** `<field>:<direction>` — the list's one sort control for the two query parameters. */
export const OPPORTUNITY_LIST_SORTS = [
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'value:desc',
  'expectedCloseDate:asc',
] as const;
export type OpportunityListSort = (typeof OPPORTUNITY_LIST_SORTS)[number];
const DEFAULT_SORT: OpportunityListSort = 'createdAt:desc';

const STATES: readonly OpportunityStatusKind[] = ['open', 'won', 'lost'];

/** The list's filters: the shared ones, and the two the board has no use for — its columns *are* the statuses. */
export interface ListFilters {
  shared: SharedOpportunityFilters;
  state: OpportunityStatusKind | '';
  statusCode: string;
}

/** A copy of `params` without the parameters `drop` says are someone else's to write. */
function without(params: URLSearchParams, drop: (name: string) => boolean): URLSearchParams {
  const next = new URLSearchParams();
  for (const [name, value] of params) if (!drop(name)) next.append(name, value);
  return next;
}

function append(target: URLSearchParams, source: URLSearchParams): URLSearchParams {
  for (const [name, value] of source) target.append(name, value);
  return target;
}

/** The board at `view=board`; the list for no `view` and for anything else. */
export function readOpportunityView(params: URLSearchParams): AdminListViewMode {
  return params.get(VIEW_PARAM) === 'board' ? 'board' : 'list';
}

/** The same address in the other view: every filter kept, the list being the bare address. */
export function withOpportunityView(params: URLSearchParams, view: AdminListViewMode): URLSearchParams {
  const next = without(params, (name) => name === VIEW_PARAM);
  if (view === 'board') next.set(VIEW_PARAM, 'board');
  return next;
}

/** The list's filters as the address carries them. Forgiving, as {@link readBoardFilters} is. */
export function readListFilters(params: URLSearchParams): ListFilters {
  const state = params.get(STATE_PARAM) ?? '';
  const status = params.get(STATUS_PARAM) ?? '';
  return {
    shared: readBoardFilters(params).shared,
    state: (STATES as readonly string[]).includes(state) ? (state as OpportunityStatusKind) : '',
    statusCode: opportunityStatusCodeSchema.safeParse(status).success ? status : '',
  };
}

/**
 * The address with the list's filters replaced; the board's, the view and the
 * sort untouched — but for the board's contact-person filter, which is chosen
 * within an Organization and goes when the Organization does, as on the board.
 */
export function withListFilters(params: URLSearchParams, filters: ListFilters): URLSearchParams {
  const organizationChanged = readBoardFilters(params).shared.organizationId !== filters.shared.organizationId;
  const next = without(
    params,
    (name) =>
      SHARED_PARAMS.includes(name) ||
      name === STATE_PARAM ||
      name === STATUS_PARAM ||
      (organizationChanged && name.startsWith(CONTACT_FILTER_PREFIX)),
  );
  append(next, writeBoardFilters({ shared: filters.shared, fields: {} }));
  if (filters.state) next.set(STATE_PARAM, filters.state);
  if (filters.statusCode) next.set(STATUS_PARAM, filters.statusCode);
  return next;
}

/** The list's sort; the default one for none or one it does not offer. */
export function readListSort(params: URLSearchParams): OpportunityListSort {
  const sort = params.get(SORT_PARAM) ?? '';
  return (OPPORTUNITY_LIST_SORTS as readonly string[]).includes(sort) ? (sort as OpportunityListSort) : DEFAULT_SORT;
}

/** The address with the list's sort; the default one is left out of it. */
export function withListSort(params: URLSearchParams, sort: OpportunityListSort): URLSearchParams {
  const next = without(params, (name) => name === SORT_PARAM);
  if (sort !== DEFAULT_SORT) next.set(SORT_PARAM, sort);
  return next;
}

/** The address with the board's filters replaced; the list's own, the view and the sort untouched. */
export function withBoardFilters(params: URLSearchParams, filters: BoardFilters): URLSearchParams {
  const next = without(params, (name) => SHARED_PARAMS.includes(name) || name.startsWith(BOARD_FIELD_PREFIX));
  return append(next, writeBoardFilters(filters));
}

/**
 * *Clear all filters*, on either view: every filter of both goes, so the
 * other view does not open still narrowed by something this one did not show.
 * The view and the sort are not filters, and stay.
 */
export function withoutOpportunityFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const view = params.get(VIEW_PARAM);
  const sort = params.get(SORT_PARAM);
  if (view !== null) next.set(VIEW_PARAM, view);
  if (sort !== null) next.set(SORT_PARAM, sort);
  return next;
}

/**
 * Where `/crm/board` — the board's address before it joined the list's page —
 * sends a bookmark: the board view, with the filters the bookmark carried.
 */
export function boardAddressRedirect(search: string): string {
  const params = withOpportunityView(new URLSearchParams(search), 'board');
  return `${OPPORTUNITIES_PATH}?${params.toString()}`;
}

/** A saved view's state, as the kit's `SavedViewsControl` stores and applies it. */
export interface SavedOpportunityView {
  filters: Record<string, unknown>;
  sort?: { field: string; dir: 'asc' | 'desc' } | null;
}

/** A parameter a saved view keeps: a filter of either view. The view and the sort are not filters. */
function isSavedFilterParam(name: string): boolean {
  return (
    SHARED_PARAMS.includes(name) ||
    name === STATE_PARAM ||
    name === STATUS_PARAM ||
    name.startsWith(CUSTOM_FIELD_PREFIX) ||
    name.startsWith(BOARD_FIELD_PREFIX)
  );
}

/**
 * A saved view of the page (issue #1734): every filter of **both** views, as
 * the address carries them — one value as text, a repeated one as a list —
 * and the list's sort apart, `null` for the default one. One view serves the
 * list and the board, as the address does; the view itself is not stored, so
 * a view opens in whichever view the page is in.
 */
export function toSavedOpportunityView(params: URLSearchParams): SavedOpportunityView {
  const filters: Record<string, unknown> = {};
  for (const name of new Set(params.keys())) {
    if (!isSavedFilterParam(name)) continue;
    const values = params.getAll(name).filter((value) => value !== '');
    if (values.length === 0) continue;
    filters[name] = values.length === 1 ? values[0] : values;
  }
  const sort = readListSort(params);
  const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  return { filters, sort: sort === DEFAULT_SORT ? null : { field, dir } };
}

/**
 * The address a saved view stands for, applied to `params`: every filter of
 * both views and the sort replaced, the view kept. A key the page does not
 * read, a value that is not text, and a sort the list does not offer are left
 * out; what remains is read by the views' own forgiving readers, as a link is.
 */
export function fromSavedOpportunityView(view: SavedOpportunityView, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const current = params.get(VIEW_PARAM);
  if (current !== null) next.set(VIEW_PARAM, current);
  for (const [name, raw] of Object.entries(view.filters)) {
    if (!isSavedFilterParam(name)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) if (typeof value === 'string' && value !== '') next.append(name, value);
  }
  const sort = view.sort ? `${view.sort.field}:${view.sort.dir}` : DEFAULT_SORT;
  if (sort !== DEFAULT_SORT && (OPPORTUNITY_LIST_SORTS as readonly string[]).includes(sort)) {
    next.set(SORT_PARAM, sort);
  }
  return next;
}
