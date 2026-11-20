import type { ReactNode } from 'react';
import { Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OpportunityFilterParams } from '../api.js';
import { AssigneeLookup, OrganizationLookup, SalesChannelLookup } from './LookupPickers.js';
import { TagMultiSelect } from '@endora-commerce/admin-kit/components';
import { crmApi } from '../api.js';

/**
 * The filters the list and the board share, as the two screens hold them:
 * text, Organization, assignee, tags, Sales Channel and the creation-date range
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1, §10).
 */
export interface SharedOpportunityFilters {
  q: string;
  organizationId: string | null;
  /** Anyone (`''`), the operator's own, nobody's, or one person's — chosen in `assigneeId`. */
  assignee: AssigneeFilter;
  assigneeId: string | null;
  /** Every tag chosen must be carried — the list's AND. */
  tagIds: readonly string[];
  salesChannelId: string | null;
  createdFrom: string;
  createdTo: string;
}

export type AssigneeFilter = '' | 'me' | 'unassigned' | 'person';

const ASSIGNEE_FILTERS: readonly Exclude<AssigneeFilter, ''>[] = ['me', 'unassigned', 'person'];

export const NO_SHARED_FILTERS: SharedOpportunityFilters = {
  q: '',
  organizationId: null,
  assignee: '',
  assigneeId: null,
  tagIds: [],
  salesChannelId: null,
  createdFrom: '',
  createdTo: '',
};

export function hasSharedFilters(filters: SharedOpportunityFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.organizationId !== null ||
    filters.assignee !== '' ||
    filters.tagIds.length > 0 ||
    filters.salesChannelId !== null ||
    filters.createdFrom !== '' ||
    filters.createdTo !== ''
  );
}

/** One filter of {@link SharedOpportunityFilters}, the search aside — the search is the toolbar's own box. */
export type SharedFilterKey = 'organization' | 'assignee' | 'tags' | 'salesChannel' | 'created';

/** Every shared filter, in the order a screen's *More filters* panel lists those it folds away. */
export const SHARED_FILTER_KEYS: readonly SharedFilterKey[] = ['organization', 'assignee', 'tags', 'salesChannel', 'created'];

/** Whether one shared filter narrows the list. "A person" with nobody chosen yet narrows nothing. */
export function sharedFilterActive(filters: SharedOpportunityFilters, key: SharedFilterKey): boolean {
  switch (key) {
    case 'organization':
      return filters.organizationId !== null;
    case 'assignee':
      return assigneeParam(filters) !== null;
    case 'tags':
      return filters.tagIds.length > 0;
    case 'salesChannel':
      return filters.salesChannelId !== null;
    case 'created':
      return filters.createdFrom !== '' || filters.createdTo !== '';
  }
}

/**
 * How many shared filters a screen folds behind *More filters* are in use
 * (issue #1505, WORK-05) — so a collapsed bar still says the list is narrowed.
 * The creation-date range counts once, as it is one cell.
 */
export function hiddenSharedFilterCount(filters: SharedOpportunityFilters, primary: readonly SharedFilterKey[]): number {
  return SHARED_FILTER_KEYS.filter((key) => !primary.includes(key) && sharedFilterActive(filters, key)).length;
}

/** The filters the board's toolbar always shows beside the search (issue #1505, WORK-05). */
export const BOARD_PRIMARY_FILTERS: readonly SharedFilterKey[] = ['assignee', 'organization'];
/** The board's other shared filters, behind *More filters* with the card-field filters. */
export const BOARD_MORE_FILTERS: readonly SharedFilterKey[] = SHARED_FILTER_KEYS.filter(
  (key) => !BOARD_PRIMARY_FILTERS.includes(key),
);
/** The shared filter the list's toolbar shows beside the search, its state and its status (issue #1505). */
export const LIST_PRIMARY_FILTERS: readonly SharedFilterKey[] = ['assignee'];
/** The list's other shared filters, behind *More filters* with the custom-field filters. */
export const LIST_MORE_FILTERS: readonly SharedFilterKey[] = SHARED_FILTER_KEYS.filter(
  (key) => !LIST_PRIMARY_FILTERS.includes(key),
);

/** `me` / `unassigned` as they are; "a person" only once somebody is chosen. */
function assigneeParam(filters: SharedOpportunityFilters): string | null {
  if (filters.assignee === 'person') return filters.assigneeId;
  return filters.assignee === '' ? null : filters.assignee;
}

/** What the screens hold, as the query parameters both endpoints take. */
export function sharedFilterParams(filters: SharedOpportunityFilters): OpportunityFilterParams {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(assigneeParam(filters) ? { assignedAdminUserId: assigneeParam(filters) as string } : {}),
    ...(filters.tagIds.length > 0 ? { tagId: filters.tagIds } : {}),
    ...(filters.salesChannelId ? { salesChannelId: filters.salesChannelId } : {}),
    ...(filters.createdFrom ? { createdFrom: filters.createdFrom } : {}),
    ...(filters.createdTo ? { createdTo: filters.createdTo } : {}),
  };
}

export interface OpportunityFilterFieldsProps {
  /** Prefix of the fields' ids — two screens, one component, no shared id. */
  idPrefix: string;
  filters: SharedOpportunityFilters;
  onChange: (patch: Partial<SharedOpportunityFilters>) => void;
  /** Which filters to render, in this order. */
  only: readonly SharedFilterKey[];
  /**
   * `toolbar`: the kit `ListToolbar`'s filter row, each control named by
   * `aria-label` and its first choice saying what it filters ("Any
   * organization"). `panel`: a labelled cell of the *More filters* panel.
   */
  placement: 'toolbar' | 'panel';
}

/**
 * The shared filter fields of the Opportunities list and of the board.
 *
 * **One component, so the two screens cannot drift apart** — and so a story
 * that adds a filter both endpoints accept (the assignee, the tags) adds one
 * field here, one key to {@link SharedOpportunityFilters}, {@link SharedFilterKey}
 * and {@link sharedFilterParams}, and neither screen is restructured.
 *
 * Each screen renders it twice — once with the filters its toolbar always
 * shows, once with the rest in the *More filters* panel (issue #1505,
 * WORK-05) — and renders no container: the kit `ListToolbar` lays both out.
 */
export function OpportunityFilterFields(props: OpportunityFilterFieldsProps): ReactNode {
  const { idPrefix, filters, onChange, only, placement } = props;
  const t = useTranslation('crm');
  const inRow = placement === 'toolbar';

  /** A control under its visible label in the panel; on its own, named by `aria-label`, in the row. */
  const cell = (key: string, label: ReactNode, control: ReactNode, rowClassName: string): ReactNode =>
    inRow ? (
      <div key={key} className={rowClassName}>
        {control}
      </div>
    ) : (
      <div key={key} className="space-y-1">
        {label}
        {control}
      </div>
    );

  const render = (key: SharedFilterKey): ReactNode => {
    switch (key) {
      case 'organization':
        return cell(
          key,
          <Label htmlFor={`${idPrefix}-organization`}>{t('opportunity.list.filter.organization')}</Label>,
          <OrganizationLookup
            id={`${idPrefix}-organization`}
            ariaLabel={t('opportunity.list.filter.organization')}
            value={filters.organizationId}
            onChange={(organizationId): void => onChange({ organizationId })}
            placeholder={t('opportunity.list.filter.organizationAny')}
            emptyMessage={t('opportunity.picker.organizationEmpty')}
          />,
          'w-full sm:w-56',
        );
      case 'assignee':
        return [
          cell(
            key,
            <Label htmlFor={`${idPrefix}-assignee`}>{t('assignment.filter.label')}</Label>,
            <Select
              id={`${idPrefix}-assignee`}
              {...(inRow ? { 'aria-label': t('assignment.filter.label') } : {})}
              value={filters.assignee}
              onChange={(event): void =>
                onChange({ assignee: event.target.value as AssigneeFilter, assigneeId: null })
              }
            >
              <option value="">{t('assignment.filter.anyone')}</option>
              {ASSIGNEE_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {t(`assignment.filter.option.${option}`)}
                </option>
              ))}
            </Select>,
            'w-auto',
          ),
          filters.assignee === 'person'
            ? cell(
                `${key}-person`,
                <Label htmlFor={`${idPrefix}-assignee-person`}>{t('assignment.filter.person')}</Label>,
                <AssigneeLookup
                  id={`${idPrefix}-assignee-person`}
                  ariaLabel={t('assignment.filter.person')}
                  value={filters.assigneeId}
                  onChange={(assigneeId): void => onChange({ assigneeId })}
                  placeholder={t('assignment.picker.placeholder')}
                  emptyMessage={t('assignment.picker.empty')}
                />,
                'w-full sm:w-56',
              )
            : null,
        ];
      case 'tags':
        return cell(
          key,
          // The multi-select's trigger is a button; the visible label names it.
          <span className="text-sm font-medium leading-none">{t('tags.filter.label')}</span>,
          <TagMultiSelect
            ariaLabel={t('tags.filter.label')}
            loadTags={crmApi.listTags}
            selected={filters.tagIds}
            onChange={(tagIds): void => onChange({ tagIds })}
            className="w-full"
          />,
          'w-44',
        );
      case 'salesChannel':
        return cell(
          key,
          <Label htmlFor={`${idPrefix}-channel`}>{t('opportunity.list.filter.salesChannel')}</Label>,
          <SalesChannelLookup
            id={`${idPrefix}-channel`}
            ariaLabel={t('opportunity.list.filter.salesChannel')}
            value={filters.salesChannelId}
            onChange={(salesChannelId): void => onChange({ salesChannelId })}
            placeholder={t('opportunity.list.filter.salesChannelAny')}
            emptyMessage={t('opportunity.picker.salesChannelEmpty')}
          />,
          'w-full sm:w-56',
        );
      case 'created':
        // One cell: two dates read as one filter.
        return (
          <div key={key} className="grid grid-cols-2 gap-x-2">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-created-from`}>{t('opportunity.list.filter.createdFrom')}</Label>
              <Input
                id={`${idPrefix}-created-from`}
                type="date"
                value={filters.createdFrom}
                max={filters.createdTo || undefined}
                onChange={(event): void => onChange({ createdFrom: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-created-to`}>{t('opportunity.list.filter.createdTo')}</Label>
              <Input
                id={`${idPrefix}-created-to`}
                type="date"
                value={filters.createdTo}
                min={filters.createdFrom || undefined}
                onChange={(event): void => onChange({ createdTo: event.target.value })}
              />
            </div>
          </div>
        );
    }
  };

  return <>{only.map(render)}</>;
}
