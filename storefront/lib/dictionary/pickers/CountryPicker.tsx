'use client';

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { ResolvedCountry } from '@endora-commerce/contracts';
import { useDictionary } from '../DictionaryProvider';
import { tForLocale } from '../../i18n/messages';
import { format } from '../../i18n/format';

export interface CountryPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  /** The blank option's caption; the catalogue's "Select …" in the provider's locale when omitted. */
  blankLabel?: string;
}

export function CountryPicker({
  includeBlank = false,
  blankLabel,
  value,
  defaultValue,
  ...props
}: CountryPickerProps): React.ReactElement {
  const dictionary = useDictionary();
  const t = tForLocale(dictionary.locale ?? '');
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
      {includeBlank ? <option value="">{blankLabel ?? t('chrome.picker.country.blank')}</option> : null}
      {active.map((country) => (
        <option key={country.code} value={country.code}>
          {country.label}
        </option>
      ))}
      {archived ? (
        <optgroup label={t('chrome.picker.archivedGroup')}>
          <option value={archived.code}>
            {format(t('chrome.picker.country.archived'), { label: archived.label })}
          </option>
        </optgroup>
      ) : null}
    </select>
  );
}

