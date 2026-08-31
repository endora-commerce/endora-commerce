import { useMemo, useState } from 'react';
import type { OrganizationStatus } from '@endora-commerce/contracts';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';
import {
  useOrganizationsQuery,
  type UseOrganizationsQueryOptions,
} from './useOrganizationsQuery.js';
import { OrganizationStatusBadge } from './OrganizationStatusBadge.js';

export interface OrganizationPickerProps {
  value: string | null;
  onChange: (organizationId: string | null) => void;
  /** When provided, the initially-selected item's name is shown in the input even before the first fetch lands. */
  selectedLabel?: string;
  statusFilter?: OrganizationStatus[];
  salesRepAdminUserId?: string;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

/**
 * Single-select Organization picker — Combobox wrapper with server-side
 * paged search, diacritic-insensitive matching, and a status pill on each
 * result.
 *
 * Used wherever the admin app needs to pick one Organization
 * (Sales Rep assignment, single-org filters, etc.). For multi-select
 * audiences (price-list audience, promotion targets) use
 * `<OrganizationPickerMulti>`.
 */
export function OrganizationPicker(props: OrganizationPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');

  const queryOptions = useMemo<UseOrganizationsQueryOptions>(
    () => ({
      query,
      ...(props.statusFilter ? { statusFilter: props.statusFilter } : {}),
      ...(props.salesRepAdminUserId ? { salesRepAdminUserId: props.salesRepAdminUserId } : {}),
    }),
    [query, props.statusFilter, props.salesRepAdminUserId],
  );

  const { items, loading } = useOrganizationsQuery(queryOptions);

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      items.map((it) => ({
        value: it.id,
        label: it.name,
        description: it.legalName ?? undefined,
      })),
    [items],
  );

  const renderOption = (
    option: ComboboxOption<string>,
    _state: { selected: boolean; active: boolean },
  ): React.ReactNode => {
    const item = items.find((it) => it.id === option.value);
    return (
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="truncate">{option.label}</span>
          {option.description ? (
            <span className="text-xs text-muted-foreground truncate">{option.description}</span>
          ) : null}
        </div>
        {item ? <OrganizationStatusBadge status={item.status} compact /> : null}
      </div>
    );
  };

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      onSearchChange={setQuery}
      manualFilter
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? 'Search organizations…'}
      emptyMessage={props.emptyMessage ?? 'No organizations found'}
      ariaLabel={props.ariaLabel ?? 'Select organization'}
      id={props.id ?? ''}
      className={props.className ?? ''}
      selectedLabel={props.selectedLabel ?? ''}
      renderOption={renderOption}
    />
  );
}
