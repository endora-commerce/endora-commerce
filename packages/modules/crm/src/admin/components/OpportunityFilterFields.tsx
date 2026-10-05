import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input, Label } from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker, SalesChannelPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OpportunityFilterParams } from '../api.js';

/**
 * The filters the list and the board share, as the two screens hold them:
 * text, Organization, Sales Channel and the creation-date range
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1, §10).
 */
export interface SharedOpportunityFilters {
  q: string;
  organizationId: string | null;
  salesChannelId: string | null;
  createdFrom: string;
  createdTo: string;
}

export const NO_SHARED_FILTERS: SharedOpportunityFilters = {
  q: '',
  organizationId: null,
  salesChannelId: null,
  createdFrom: '',
  createdTo: '',
};

export function hasSharedFilters(filters: SharedOpportunityFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.organizationId !== null ||
    filters.salesChannelId !== null ||
    filters.createdFrom !== '' ||
    filters.createdTo !== ''
  );
}

/** What the screens hold, as the query parameters both endpoints take. */
export function sharedFilterParams(filters: SharedOpportunityFilters): OpportunityFilterParams {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
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
        <OrganizationPicker
          id={`${idPrefix}-organization`}
          ariaLabel={t('opportunity.list.filter.organization')}
          value={filters.organizationId}
          onChange={(organizationId): void => onChange({ organizationId })}
          placeholder={t('opportunity.list.filter.organizationAny')}
          emptyMessage={t('opportunity.picker.organizationEmpty')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-channel`}>{t('opportunity.list.filter.salesChannel')}</Label>
        <SalesChannelPicker
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
