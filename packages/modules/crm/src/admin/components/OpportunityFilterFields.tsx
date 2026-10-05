import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OpportunityFilterParams } from '../api.js';
import { AssigneeLookup, OrganizationLookup, SalesChannelLookup } from './LookupPickers.js';

/**
 * The filters the list and the board share, as the two screens hold them:
 * text, Organization, assignee, Sales Channel and the creation-date range
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1, §10).
 */
export interface SharedOpportunityFilters {
  q: string;
  organizationId: string | null;
  /** Anyone (`''`), the operator's own, nobody's, or one person's — chosen in `assigneeId`. */
  assignee: AssigneeFilter;
  assigneeId: string | null;
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
  salesChannelId: null,
  createdFrom: '',
  createdTo: '',
};

export function hasSharedFilters(filters: SharedOpportunityFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.organizationId !== null ||
    filters.assignee !== '' ||
    filters.salesChannelId !== null ||
    filters.createdFrom !== '' ||
    filters.createdTo !== ''
  );
}

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
    ...(filters.salesChannelId ? { salesChannelId: filters.salesChannelId } : {}),
    ...(filters.createdFrom ? { createdFrom: filters.createdFrom } : {}),
    ...(filters.createdTo ? { createdTo: filters.createdTo } : {}),
  };
}

export interface OpportunityFilterFieldsProps {
  /** Prefix of the fields' ids — two screens, one component, no shared id. */
  idPrefix: string;
  /** The search box as typed; the screen debounces it into `filters.q`. */
  search: string;
  onSearchChange: (search: string) => void;
  filters: SharedOpportunityFilters;
  onChange: (patch: Partial<SharedOpportunityFilters>) => void;
  /** Fields only one screen has (the list's state and status), placed after the search. */
  children?: ReactNode;
}

/**
 * The filter fields of the Opportunities list and of the board.
 *
 * **One component, so the two screens cannot drift apart** — and so a story
 * that adds a filter both endpoints accept (the assignee, the tags) adds one
 * field here, one key to {@link SharedOpportunityFilters} and one line to
 * {@link sharedFilterParams}, and neither screen is restructured.
 *
 * It renders grid cells and no container: each screen lays its own grid out,
 * and puts its own controls (sort, *Clear*) beside these.
 */
export function OpportunityFilterFields(props: OpportunityFilterFieldsProps): ReactNode {
  const { idPrefix, search, onSearchChange, filters, onChange, children } = props;
  const t = useTranslation('crm');

  return (
    <>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-search`}>{t('opportunity.list.filter.search')}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={`${idPrefix}-search`}
            type="search"
            className="pl-8"
            value={search}
            placeholder={t('opportunity.list.filter.searchPlaceholder')}
            onChange={(event): void => onSearchChange(event.target.value)}
          />
        </div>
      </div>
      {children}
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-organization`}>
          {t('opportunity.list.filter.organization')}
        </Label>
        <OrganizationLookup
          id={`${idPrefix}-organization`}
          ariaLabel={t('opportunity.list.filter.organization')}
          value={filters.organizationId}
          onChange={(organizationId): void => onChange({ organizationId })}
          placeholder={t('opportunity.list.filter.organizationAny')}
          emptyMessage={t('opportunity.picker.organizationEmpty')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-assignee`}>{t('assignment.filter.label')}</Label>
        <Select
          id={`${idPrefix}-assignee`}
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
        </Select>
      </div>
      {filters.assignee === 'person' ? (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-assignee-person`}>{t('assignment.filter.person')}</Label>
          <AssigneeLookup
            id={`${idPrefix}-assignee-person`}
            ariaLabel={t('assignment.filter.person')}
            value={filters.assigneeId}
            onChange={(assigneeId): void => onChange({ assigneeId })}
            placeholder={t('assignment.picker.placeholder')}
            emptyMessage={t('assignment.picker.empty')}
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-channel`}>{t('opportunity.list.filter.salesChannel')}</Label>
        <SalesChannelLookup
          id={`${idPrefix}-channel`}
          ariaLabel={t('opportunity.list.filter.salesChannel')}
          value={filters.salesChannelId}
          onChange={(salesChannelId): void => onChange({ salesChannelId })}
          placeholder={t('opportunity.list.filter.salesChannelAny')}
          emptyMessage={t('opportunity.picker.salesChannelEmpty')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-created-from`}>
          {t('opportunity.list.filter.createdFrom')}
        </Label>
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
    </>
  );
}
