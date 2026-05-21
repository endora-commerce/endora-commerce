import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  useOrganizationsQuery,
  type UseOrganizationsQueryOptions,
} from './useOrganizationsQuery';
import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
import { OrganizationStatusBadge } from './OrganizationStatusBadge';
import { cn } from '@/lib/utils';

export interface OrganizationPickerMultiProps {
  /** Currently selected organization IDs. */
  value: string[];
  onChange: (organizationIds: string[]) => void;
  /**
   * Labels keyed by id for organizations that may not appear in the
   * current page of search results. Lets the chip render correctly even
   * after the dropdown has scrolled past the original selection.
   */
  selectedLabels?: Record<string, { name: string; status: OrganizationStatusPickerFilter }>;
  statusFilter?: OrganizationStatusPickerFilter[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** Max chips allowed before further additions are refused. Defaults to 200. */
  maxSelection?: number;
}

/**
 * Multi-select OrganizationPicker. Wraps the single-select Combobox and
 * renders chips for already-picked items below the input. Selecting a new
 * option appends it; clicking the × on a chip removes it. The same
 * server-side search hook powers both variants.
 */
export function OrganizationPickerMulti(
  props: OrganizationPickerMultiProps,
): React.ReactElement {
  const [query, setQuery] = useState('');

  const queryOptions = useMemo<UseOrganizationsQueryOptions>(
    () => ({
      query,
      ...(props.statusFilter ? { statusFilter: props.statusFilter } : {}),
    }),
    [query, props.statusFilter],
  );

  const { items, loading } = useOrganizationsQuery(queryOptions);

  const selectedSet = useMemo(() => new Set(props.value), [props.value]);
  const maxSelection = props.maxSelection ?? 200;

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      items.map((it) => ({
        value: it.id,
        label: it.name,
        description: it.legalName ?? undefined,
        disabled: selectedSet.has(it.id),
      })),
    [items, selectedSet],
  );

  const handleSelect = (id: string | null): void => {
    if (!id) return;
    if (selectedSet.has(id)) return;
    if (props.value.length >= maxSelection) return;
    props.onChange([...props.value, id]);
    setQuery('');
  };

  const handleRemove = (id: string): void => {
    props.onChange(props.value.filter((v) => v !== id));
  };

  const chipFor = (id: string): React.ReactElement => {
    const fromCurrent = items.find((it) => it.id === id);
    const fromHint = props.selectedLabels?.[id];
    const label = fromCurrent?.name ?? fromHint?.name ?? id;
    const status = fromCurrent?.status ?? fromHint?.status ?? null;
    return (
      <span
        key={id}
        className="inline-flex items-center gap-2 rounded-full border bg-slate-50 px-2 py-1 text-xs"
      >
        <span className="truncate max-w-[12rem]">{label}</span>
        {status ? <OrganizationStatusBadge status={status} compact /> : null}
        <button
          type="button"
          className="text-slate-500 hover:text-slate-900"
          aria-label={`Remove ${label}`}
          onClick={(): void => handleRemove(id)}
          disabled={props.disabled ?? false}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  };

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
    <div className={cn('flex flex-col gap-2', props.className)}>
      <Combobox<string>
        options={options}
        value={null}
        onChange={handleSelect}
        onSearchChange={setQuery}
        manualFilter
        loading={loading}
        clearable={false}
        disabled={props.disabled ?? false}
        placeholder={props.placeholder ?? 'Add organization…'}
        emptyMessage={props.emptyMessage ?? 'No organizations found'}
        ariaLabel={props.ariaLabel ?? 'Add organizations'}
        id={props.id ?? ''}
        renderOption={renderOption}
      />
      {props.value.length > 0 ? (
        <div className="flex flex-wrap gap-2">{props.value.map((id) => chipFor(id))}</div>
      ) : null}
    </div>
  );
}
