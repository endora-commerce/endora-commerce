'use client';

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { ResolvedCountry } from '@b2b/contracts';
import { useDictionary } from '../DictionaryProvider';

export interface CountryPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
}

export function CountryPicker({
  includeBlank = false,
  blankLabel = 'Select country',
  value,
  defaultValue,
  ...props
}: CountryPickerProps): React.ReactElement {
  const dictionary = useDictionary();
  const selected = String(value ?? defaultValue ?? '');
  const [archived, setArchived] = useState<ResolvedCountry & { isActive: boolean } | null>(null);

  const active = useMemo(
    () => [...dictionary.countries].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [dictionary.countries],
  );
  const hasSelected = active.some((country) => country.code === selected);

  useEffect(() => {
    if (!selected || hasSelected) {
      setArchived(null);
      return;
    }
    let cancelled = false;
    void dictionary.resolveByCode('country', selected).then((entry) => {
      if (!cancelled && entry?.entryType === 'country') setArchived(entry.entry);
    });
    return () => {
      cancelled = true;
    };
  }, [dictionary, hasSelected, selected]);

  return (
    <select value={value} defaultValue={defaultValue} {...props}>
      {includeBlank ? <option value="">{blankLabel}</option> : null}
      {active.map((country) => (
        <option key={country.code} value={country.code}>
          {country.label}
        </option>
      ))}
      {archived ? (
        <optgroup label="Archived">
          <option value={archived.code}>{archived.label} (archived)</option>
        </optgroup>
      ) : null}
    </select>
  );
}

