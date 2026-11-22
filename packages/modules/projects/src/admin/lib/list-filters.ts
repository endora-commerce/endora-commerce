import { ProjectListQuerySchema, type CustomFieldFilters, type ProjectState } from '@endora-commerce/contracts';
import {
  emptyCustomFieldFilters,
  readCustomFieldFilterParams,
  writeCustomFieldFilterParams,
} from '@endora-commerce/admin-kit/components';

/**
 * The Projects list's filters and sort as the address carries them (issue
 * #454; `specs/163-projects-and-tasks/` carry-over C4).
 *
 * **The address is the state** — the Tasks screen's precedent
 * (`tasks/src/admin/lib/task-filters.ts`): Back, a reload and a shared link
 * keep the filters, and another screen can link to a pre-filtered list (the
 * Organization screen's *All projects*). Each filter is a query parameter
 * named as `GET /projects` names it; custom-field filters are the kit's
 * `cf.<key>.<op>` parameters, turned into `customFieldFilters` only when a
 * request is made.
 *
 * A value the list does not take — an unknown state, an id that is not one,
 * a sort the server does not serve — is read as absent, through the
 * contract's own schema, so it is never sent and never answered with a 400.
 */

export const STATES: readonly ProjectState[] = ['open', 'completed', 'lost'];

/** `<field>:<direction>` — one control for the two query parameters. */
export const SORTS = [
  'createdAt:desc',
  'createdAt:asc',
  'value:desc',
  'value:asc',
  'deadline:asc',
  'deadline:desc',
] as const;
export type SortOption = (typeof SORTS)[number];

export const DEFAULT_SORT: SortOption = 'createdAt:desc';

export interface Filters {
  q: string;
  state: ProjectState | '';
  organizationId: string | null;
  /** "Only mine" and {@link memberId} are one filter (`memberId`): setting one clears the other. */
  mine: boolean;
  memberId: string | null;
  roleId: string;
  templateId: string;
  stageName: string;
  /** Custom fields marked as list filters, applied by the server (`customFieldFilters`). */
  customFields: CustomFieldFilters;
}

export const NO_FILTERS: Readonly<Filters> = Object.freeze({
  q: '',
  state: '',
  organizationId: null,
  mine: false,
  memberId: null,
  roleId: '',
  templateId: '',
  stageName: '',
  customFields: emptyCustomFieldFilters(),
});

export interface ListAddress {
  filters: Filters;
  sort: SortOption;
}

const shape = ProjectListQuerySchema.shape;

/** `value` when the contract's schema for that parameter takes it, otherwise `null`. */
function accepted(schema: { safeParse: (value: unknown) => { success: boolean } }, value: string | null): string | null {
  return value !== null && schema.safeParse(value).success ? value : null;
}

const isState = (value: string): value is ProjectState => (STATES as readonly string[]).includes(value);
const isSort = (value: string): value is SortOption => (SORTS as readonly string[]).includes(value);

function readSort(params: URLSearchParams): SortOption {
  const field = params.get('sort');
  if (field === null) return DEFAULT_SORT;
  const asked = `${field}:${params.get('order') ?? ''}`;
  if (isSort(asked)) return asked;
  // A known field with an unknown direction reads in the direction it is offered first.
  return SORTS.find((option) => option.startsWith(`${field}:`)) ?? DEFAULT_SORT;
}

/** The filters and sort `params` carries; whatever the list does not take is left out. */
export function readListAddress(params: URLSearchParams): ListAddress {
  const member = accepted(shape.memberId, params.get('memberId'));
  return {
    filters: {
      q: accepted(shape.q, params.get('q')) ?? '',
      state: params.getAll('state').find(isState) ?? '',
      organizationId: accepted(shape.organizationId, params.get('organizationId')),
      mine: member === 'me',
      memberId: member === 'me' ? null : member,
      roleId: accepted(shape.roleId, params.get('roleId')) ?? '',
      templateId: accepted(shape.templateId, params.get('templateId')) ?? '',
      stageName: accepted(shape.stageName, params.get('stageName')) ?? '',
      customFields: readCustomFieldFilterParams(params),
    },
    sort: readSort(params),
  };
}

/** The address of `address`: only what narrows the list, and the sort when it is not the default. */
export function writeListAddress(address: ListAddress): URLSearchParams {
  const { filters, sort } = address;
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.state) params.set('state', filters.state);
  if (filters.organizationId) params.set('organizationId', filters.organizationId);
  if (filters.mine) params.set('memberId', 'me');
  else if (filters.memberId) params.set('memberId', filters.memberId);
  if (filters.roleId) params.set('roleId', filters.roleId);
  if (filters.templateId) params.set('templateId', filters.templateId);
  if (filters.stageName.trim()) params.set('stageName', filters.stageName.trim());
  if (sort !== DEFAULT_SORT) {
    const [field, order] = sort.split(':') as [string, string];
    params.set('sort', field);
    params.set('order', order);
  }
  return writeCustomFieldFilterParams(params, filters.customFields);
}

/**
 * How many of the filters the Projects toolbar folds behind *More filters*
 * are in use (issue #1505, WORK-05) — so a collapsed bar still says the list
 * is narrowed. The search, the state, the Organization and the Member are
 * always shown and not counted; each custom-field filter counts as one, and
 * only for a reader who may view custom fields, since no other reader's
 * request carries them.
 */
export function hiddenFilterCount(filters: Filters, options: { customFields: boolean }): number {
  const folded = [filters.roleId !== '', filters.templateId !== '', filters.stageName.trim() !== ''].filter(Boolean).length;
  return folded + (options.customFields ? Object.keys(filters.customFields).length : 0);
}

/** A saved view's state, as the kit's `SavedViewsControl` stores and applies it. */
export interface SavedProjectView {
  filters: Record<string, unknown>;
  sort?: { field: string; dir: 'asc' | 'desc' } | null;
}

/**
 * A saved view of the list (issue #1734): the filters under the names the
 * address carries them by — one value as text, a repeated one as a list — and
 * the sort apart, `null` for the default one. "Only mine" is `memberId=me`, so
 * a shared view means whoever applies it.
 */
export function toSavedProjectView(address: ListAddress): SavedProjectView {
  const params = writeListAddress({ filters: address.filters, sort: DEFAULT_SORT });
  const filters: Record<string, unknown> = {};
  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    filters[name] = values.length === 1 ? values[0] : values;
  }
  const [field, dir] = address.sort.split(':') as [string, 'asc' | 'desc'];
  return { filters, sort: address.sort === DEFAULT_SORT ? null : { field, dir } };
}

/**
 * The address a saved view stands for. It goes through {@link readListAddress},
 * so what the list no longer takes — an unknown state, an id that is not one,
 * a key or a sort it does not know — is dropped rather than sent.
 */
export function fromSavedProjectView(view: SavedProjectView): URLSearchParams {
  const raw = new URLSearchParams();
  for (const [name, value] of Object.entries(view.filters)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) if (typeof entry === 'string' && entry !== '') raw.append(name, entry);
  }
  if (view.sort) {
    raw.set('sort', view.sort.field);
    raw.set('order', view.sort.dir);
  }
  const address = readListAddress(raw);
  // A field the list does not sort by reads as the default; a known field keeps only its offered direction.
  const asked = view.sort ? `${view.sort.field}:${view.sort.dir}` : DEFAULT_SORT;
  return writeListAddress({ ...address, sort: isSort(asked) ? asked : DEFAULT_SORT });
}
