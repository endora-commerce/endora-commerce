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
