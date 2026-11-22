import { useId, type ComponentProps, type ReactNode } from 'react';
import { FORM_ENTRY_STATUSES, type FormEntryStatus, type FormSummary } from '@endora-commerce/contracts';
import { ListToolbar, ListToolbarSearch, SalesChannelPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Badge, Input, Label, MultiSelect, Select } from '@endora-commerce/admin-kit/ui';

/**
 * The entries list's filters (`specs/170-forms-module/` FR-050, contracts/admin-surfaces.md §4):
 * the form, any of the four statuses, a date range of whole days in the administrator's own time,
 * the sales channel and a search over the submitter's e-mail and the text answers. Controlled: the
 * list owns the values and reads again on every change.
 *
 * Every control has an accessible name — the search, the form and the statuses by `aria-label` in
 * the toolbar row, the folded ones by a visible label — and the dates are native date inputs, so
 * each is reachable and operable with the keyboard alone.
 */

export interface EntryFilterValues {
  readonly formId: string;
  readonly statuses: readonly FormEntryStatus[];
  /** `YYYY-MM-DD`, or `''`. */
  readonly from: string;
  readonly to: string;
  readonly salesChannelId: string | null;
  readonly q: string;
}

export const NO_ENTRY_FILTERS: EntryFilterValues = { formId: '', statuses: [], from: '', to: '', salesChannelId: null, q: '' };

export function isFiltered(values: EntryFilterValues): boolean {
  return (
    values.formId !== '' ||
    values.statuses.length > 0 ||
    values.from !== '' ||
    values.to !== '' ||
    values.salesChannelId !== null ||
    values.q.trim() !== ''
  );
}

/** The first instant of a local day, as the API's ISO time. */
export function startOfDay(day: string): string | undefined {
  return day === '' ? undefined : new Date(`${day}T00:00:00`).toISOString();
}

/** The last instant of a local day, as the API's ISO time. */
export function endOfDay(day: string): string | undefined {
  return day === '' ? undefined : new Date(`${day}T23:59:59.999`).toISOString();
}

/** How many of the folded filters — the channel and the two dates — narrow the list. */
export function moreFiltersActiveCount(values: EntryFilterValues): number {
  return [values.salesChannelId !== null, values.from !== '', values.to !== ''].filter(Boolean).length;
}

export interface EntryFiltersProps {
  readonly values: EntryFilterValues;
  /** The forms to choose from; empty when the reader may not list forms. */
  readonly forms: readonly FormSummary[];
  readonly onChange: (next: EntryFilterValues) => void;
  /** The search box, so a screen can return focus to it (after *Clear filters*, WCAG 2.4.3). */
  // Typed off the kit's `Input`, whose React types this package does not share.
  readonly searchRef?: ComponentProps<typeof Input>['ref'];
  readonly className?: string;
}

/**
 * The kit's `ListToolbar` (issue #1440, UX audit DS-06): the search, the form and the statuses —
 * what triage starts from — always visible; the channel and the date range behind *More filters*,
 * which counts the ones in use while it is closed (Hick's Law, Zeigarnik). *Clear all filters*
 * ends the row while anything narrows the list, and hands focus back to the search.
 */
export function EntryFilters({ values, forms, onChange, searchRef, className }: EntryFiltersProps): ReactNode {
  const t = useTranslation('forms');
  const id = useId();
  const set = (patch: Partial<EntryFilterValues>): void => onChange({ ...values, ...patch });
  const statusOptions = FORM_ENTRY_STATUSES.map((status) => ({ value: status, label: t(`entryStatus.${status}`) }));

  return (
    <ListToolbar
      {...(className !== undefined ? { className } : {})}
      label={t('entries.toolbar')}
      search={
        <ListToolbarSearch
          ref={searchRef}
          label={t('entries.filter.search')}
          placeholder={t('entries.filter.search')}
          value={values.q}
          onValueChange={(q) => set({ q })}
        />
      }
      filters={
        <>
          <Select
            aria-label={t('entries.filter.form')}
            className="w-auto"
            value={values.formId}
            onChange={(event) => set({ formId: event.target.value })}
          >
            <option value="">{t('entries.filter.allForms')}</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </Select>
          <MultiSelect
            className="w-44"
            ariaLabel={t('entries.filter.status')}
            placeholder={t('entries.filter.status')}
            options={statusOptions}
            selected={[...values.statuses]}
            onChange={(next) =>
              set({ statuses: FORM_ENTRY_STATUSES.filter((status) => next.includes(status)) })
            }
          />
        </>
      }
      moreFiltersActiveCount={moreFiltersActiveCount(values)}
      moreFilters={
        <>
          <div className="space-y-1">
            <Label htmlFor={`${id}-channel`}>{t('entries.filter.channel')}</Label>
            <SalesChannelPicker
              id={`${id}-channel`}
              value={values.salesChannelId}
              onChange={(salesChannelId) => set({ salesChannelId })}
              ariaLabel={t('entries.filter.channel')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-from`}>{t('entries.filter.from')}</Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={values.from}
              max={values.to || undefined}
              onChange={(event) => set({ from: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-to`}>{t('entries.filter.to')}</Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={values.to}
              min={values.from || undefined}
              onChange={(event) => set({ to: event.target.value })}
            />
          </div>
        </>
      }
      filtersActive={isFiltered(values)}
      onClearFilters={() => onChange(NO_ENTRY_FILTERS)}
    />
  );
}

const STATUS_VARIANT: Record<FormEntryStatus, 'default' | 'secondary' | 'outline' | 'warning'> = {
  new: 'default',
  read: 'secondary',
  closed: 'outline',
  spam: 'warning',
};

/** An entry's status as a badge with its word (never colour alone). */
export function EntryStatusBadge({ status }: { readonly status: FormEntryStatus }): ReactNode {
  const t = useTranslation('forms');
  return <Badge variant={STATUS_VARIANT[status]}>{t(`entryStatus.${status}`)}</Badge>;
}
