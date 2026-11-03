import { useId, type ReactNode } from 'react';
import { FORM_ENTRY_STATUSES, type FormEntryStatus, type FormSummary } from '@endora-commerce/contracts';
import { SalesChannelPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Badge, Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';

/**
 * The entries list's filters (`specs/170-forms-module/` FR-050, contracts/admin-surfaces.md §4):
 * the form, any of the four statuses, a date range of whole days in the administrator's own time,
 * the sales channel and a search over the submitter's e-mail and the text answers. Controlled: the
 * list owns the values and reads again on every change.
 *
 * Every control is a labelled native one — the statuses a fieldset of checkboxes, the dates native
 * date inputs — so each is reachable and operable with the keyboard alone.
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

export interface EntryFiltersProps {
  readonly values: EntryFilterValues;
  /** The forms to choose from; empty when the reader may not list forms. */
  readonly forms: readonly FormSummary[];
  readonly onChange: (next: EntryFilterValues) => void;
}

export function EntryFilters({ values, forms, onChange }: EntryFiltersProps): ReactNode {
  const t = useTranslation('forms');
  const id = useId();
  const set = (patch: Partial<EntryFilterValues>): void => onChange({ ...values, ...patch });
  const toggle = (status: FormEntryStatus, on: boolean): void =>
    set({ statuses: FORM_ENTRY_STATUSES.filter((candidate) => (candidate === status ? on : values.statuses.includes(candidate))) });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor={`${id}-q`}>{t('entries.filter.search')}</Label>
          <Input id={`${id}-q`} type="search" value={values.q} onChange={(event) => set({ q: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-form`}>{t('entries.filter.form')}</Label>
          <Select id={`${id}-form`} value={values.formId} onChange={(event) => set({ formId: event.target.value })}>
            <option value="">{t('entries.filter.allForms')}</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-48 space-y-1">
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
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">{t('entries.filter.status')}</legend>
          <span aria-hidden="true" className="text-sm font-medium">
            {t('entries.filter.status')}
          </span>
          {FORM_ENTRY_STATUSES.map((status) => (
            <div key={status} className="flex items-center gap-1.5">
              <Checkbox
                id={`${id}-status-${status}`}
                checked={values.statuses.includes(status)}
                onChange={(event) => toggle(status, event.target.checked)}
              />
              <Label htmlFor={`${id}-status-${status}`} className="font-normal">
                {t(`entryStatus.${status}`)}
              </Label>
            </div>
          ))}
        </fieldset>
        {isFiltered(values) ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(NO_ENTRY_FILTERS)}>
            {t('entries.filter.clear')}
          </Button>
        ) : null}
      </div>
    </div>
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
