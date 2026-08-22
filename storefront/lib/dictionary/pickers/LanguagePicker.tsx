'use client';

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { ResolvedLanguage } from '@endora-commerce/contracts';
import { useDictionary } from '../DictionaryProvider';

export interface LanguagePickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
}

export function LanguagePicker({
  includeBlank = false,
  blankLabel = 'Select language',
  value,
  defaultValue,
  ...props
}: LanguagePickerProps): React.ReactElement {
  const dictionary = useDictionary();
  const selected = String(value ?? defaultValue ?? '');
  const [archived, setArchived] = useState<ResolvedLanguage & { isActive: boolean } | null>(null);

  const active = useMemo(
    () => [...dictionary.languages].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [dictionary.languages],
  );
  const hasSelected = active.some((language) => language.code === selected);

  useEffect(() => {
    if (!selected || hasSelected) {
      setArchived(null);
      return;
    }
    let cancelled = false;
    void dictionary.resolveByCode('language', selected).then((entry) => {
      if (!cancelled && entry?.entryType === 'language') setArchived(entry.entry);
    });
    return () => {
      cancelled = true;
    };
  }, [dictionary, hasSelected, selected]);

  return (
    <select value={value} defaultValue={defaultValue} {...props}>
      {includeBlank ? <option value="">{blankLabel}</option> : null}
      {active.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label}
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

