import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OpportunitySalesChannelOption } from '@endora-commerce/contracts';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';

/**
 * The pickers of the CRM screens — Organization, Sales Channel, assignee and
 * contact person (`specs/143-crm-sales-opportunities/research.md` N-D4).
 *
 * **Why the module has its own.** The kit's `OrganizationPicker`,
 * `SalesChannelPicker`, `CustomerPicker` and `AdminUserPicker` read the admin
 * lists of the modules that own those rows, each behind its owner's permission
 * (`customers:read`, `sales_channels:read`, `admin_users:manage`). A Sales Rep
 * holding only CRM's codes got 403 from every one of them. These read CRM's own
 * lookup endpoints instead (`contracts/admin-api.md` §10a), on the kit's
 * `Combobox`, and take the same props as the kit's pickers so a screen swaps
 * one for the other by name.
 *
 * Every picker has its three states: *loading* is the combobox's own, *empty*
 * is the caller's `emptyMessage`, and a failed read is said under the field —
 * a picker that silently offers nothing reads as "there are none".
 */

const SEARCH_DEBOUNCE_MS = 250;

export interface LookupPickerProps {
  id?: string;
  ariaLabel: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** The label of `value` when it was chosen elsewhere (a preselection, a stored value). */
  selectedLabel?: string;
}

interface RemoteOptions {
  options: ComboboxOption<string>[];
  loading: boolean;
  failed: boolean;
  /** Label of an option seen during this visit, by id. */
  labelOf: (id: string | null) => string;
  search: (query: string) => void;
}

/**
 * Server-side search behind a combobox: one read on mount (what the list shows
 * before anything is typed), then one per pause in typing. A slower answer to
 * an earlier query never replaces a later one.
 */
function useRemoteOptions(
  load: (query: string) => Promise<ComboboxOption<string>[]>,
  enabled = true,
): RemoteOptions {
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(() => new Map());
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (query: string): Promise<void> => {
      const current = ++sequence.current;
      setLoading(true);
      setFailed(false);
      try {
        const found = await load(query.trim());
        if (current !== sequence.current) return;
        setOptions(found);
        setLabels((previous) => {
          const next = new Map(previous);
          for (const option of found) next.set(option.value, option.label);
          return next;
        });
      } catch {
        if (current !== sequence.current) return;
        setOptions([]);
        setFailed(true);
      } finally {
        if (current === sequence.current) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    if (!enabled) {
      sequence.current += 1;
      setOptions([]);
      setLoading(false);
      setFailed(false);
      return undefined;
    }
    void run('');
    return (): void => {
      sequence.current += 1;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [run, enabled]);

  const search = useCallback(
    (query: string): void => {
      if (!enabled) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(query), SEARCH_DEBOUNCE_MS);
    },
    [run, enabled],
  );

  const labelOf = useCallback((id: string | null): string => (id ? (labels.get(id) ?? '') : ''), [labels]);

  return { options, loading, failed, labelOf, search };
}

function LoadError(props: { shown: boolean }): ReactNode {
  const t = useTranslation('crm');
  if (!props.shown) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {t('opportunity.picker.loadError')}
    </p>
  );
}

function RemotePicker(props: LookupPickerProps & { remote: RemoteOptions }): ReactNode {
  const { remote } = props;
  const t = useTranslation('crm');
  return (
    <>
      <Combobox<string>
        id={props.id ?? ''}
        ariaLabel={props.ariaLabel}
        options={remote.options}
        value={props.value}
        onChange={props.onChange}
        onSearchChange={remote.search}
        manualFilter
        loading={remote.loading}
        loadingMessage={t('opportunity.picker.loading')}
        clearable={props.clearable ?? true}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? ''}
        emptyMessage={props.emptyMessage ?? ''}
        selectedLabel={remote.labelOf(props.value) || (props.selectedLabel ?? '')}
      />
      <LoadError shown={remote.failed} />
    </>
  );
}

/** An Organization the caller may reach, by name. */
export function OrganizationLookup(props: LookupPickerProps): ReactNode {
  const load = useCallback(
    async (query: string): Promise<ComboboxOption<string>[]> =>
      (await crmApi.lookupOrganizations(query)).map((organization) => ({
        value: organization.id,
        label: organization.name,
      })),
    [],
  );
  return <RemotePicker {...props} remote={useRemoteOptions(load)} />;
}

/** An active administrator — who may hold an Opportunity. */
export function AssigneeLookup(props: LookupPickerProps): ReactNode {
  const load = useCallback(
    async (query: string): Promise<ComboboxOption<string>[]> =>
      (await crmApi.lookupAssignees(query)).map((admin) => ({ value: admin.id, label: admin.name })),
    [],
  );
  return <RemotePicker {...props} remote={useRemoteOptions(load)} />;
}

/** A member of one Organization; nothing to choose from until the Organization is. */
export function ContactLookup(props: LookupPickerProps & { organizationId?: string }): ReactNode {
  const { organizationId, ...rest } = props;
  const load = useCallback(
    async (query: string): Promise<ComboboxOption<string>[]> =>
      organizationId
        ? (await crmApi.lookupContacts(organizationId, query)).map((contact) => ({
            value: contact.id,
            label: contact.name,
            description: contact.email,
          }))
        : [],
    [organizationId],
  );
  return <RemotePicker {...rest} remote={useRemoteOptions(load, Boolean(organizationId))} />;
}

/** The name of a Sales Channel in the language on screen, falling back to its code. */
export function salesChannelLabel(
  channel: Pick<OpportunitySalesChannelOption, 'name' | 'code'>,
  language: string,
): string {
  return (
    channel.name[language] ??
    Object.entries(channel.name).find(([key]) => key.split('-')[0] === language.split('-')[0])?.[1] ??
    channel.name['en-US'] ??
    Object.values(channel.name)[0] ??
    channel.code
  );
}

/**
 * The Sales Channels, read once — there are a handful, so the combobox filters
 * what it holds. Both the hook and the picker are exported: the create form
 * also derives the currencies it offers from the same read.
 */
export function useSalesChannelOptions(): {
  channels: OpportunitySalesChannelOption[];
  loading: boolean;
  failed: boolean;
} {
  const [channels, setChannels] = useState<OpportunitySalesChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    crmApi
      .lookupSalesChannels()
      .then((found) => {
        if (alive) setChannels(found);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, []);
  return { channels, loading, failed };
}

export interface SalesChannelLookupProps extends Omit<LookupPickerProps, 'selectedLabel'> {
  /** Offer only channels that are switched on — a form's choice; a filter offers them all. */
  activeOnly?: boolean;
}

export function SalesChannelLookup(props: SalesChannelLookupProps): ReactNode {
  return <SalesChannelSelect {...props} source={useSalesChannelOptions()} />;
}

/** The picker over a read the caller already made ({@link useSalesChannelOptions}). */
export function SalesChannelSelect(
  props: SalesChannelLookupProps & { source: ReturnType<typeof useSalesChannelOptions> },
): ReactNode {
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const { channels, loading, failed } = props.source;
  const options = useMemo(
    () =>
      channels
        // A value already stored stays selectable, active or not.
        .filter((channel) => !props.activeOnly || channel.active || channel.id === props.value)
        .map((channel) => ({
          value: channel.id,
          label: salesChannelLabel(channel, language),
          description: channel.code,
        })),
    [channels, language, props.activeOnly, props.value],
  );
  return (
    <>
      <Combobox<string>
        id={props.id ?? ''}
        ariaLabel={props.ariaLabel}
        options={options}
        value={props.value}
        onChange={props.onChange}
        loading={loading}
        loadingMessage={t('opportunity.picker.loading')}
        clearable={props.clearable ?? true}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? ''}
        emptyMessage={props.emptyMessage ?? ''}
      />
      <LoadError shown={failed} />
    </>
  );
}
