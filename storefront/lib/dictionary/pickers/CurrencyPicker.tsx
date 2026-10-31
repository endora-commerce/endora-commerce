'use client';

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { ResolvedCurrency } from '@endora-commerce/contracts';
import { useDictionary } from '../DictionaryProvider';
import { tForLocale } from '../../i18n/messages';
import { format } from '../../i18n/format';

export interface CurrencyPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  /** The blank option's caption; the catalogue's "Select …" in the provider's locale when omitted. */
  blankLabel?: string;
}

export function CurrencyPicker({
  includeBlank = false,
  blankLabel,
  value,
  defaultValue,
  ...props
}: CurrencyPickerProps): React.ReactElement {
  const dictionary = useDictionary();
  const t = tForLocale(dictionary.locale ?? '');
  const selected = String(value ?? defaultValue ?? '');
  const [archived, setArchived] = useState<ResolvedCurrency & { isActive: boolean } | null>(null);

  const active = useMemo(
    () => [...dictionary.currencies].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [dictionary.currencies],
  );
  const hasSelected = active.some((currency) => currency.code === selected);

  useEffect(() => {
    if (!selected || hasSelected) {
      setArchived(null);
      return;
    }
    let cancelled = false;
    void dictionary.resolveByCode('currency', selected).then((entry) => {
      if (!cancelled && entry?.entryType === 'currency') setArchived(entry.entry);
    });
    return () => {
      cancelled = true;
    };
  }, [dictionary, hasSelected, selected]);

  return (
    <select value={value} defaultValue={defaultValue} {...props}>
      {includeBlank ? <option value="">{blankLabel ?? t('chrome.picker.currency.blank')}</option> : null}
      {active.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.label} ({currency.code})
        </option>
      ))}
      {archived ? (
        <optgroup label={t('chrome.picker.archivedGroup')}>
          <option value={archived.code}>
            {format(t('chrome.picker.currency.archived'), { label: archived.label, code: archived.code })}
          </option>
        </optgroup>
      ) : null}
    </select>
  );
}

