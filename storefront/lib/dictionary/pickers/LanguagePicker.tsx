'use client';

import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { ResolvedLanguage } from '@endora-commerce/contracts';
import { useDictionary } from '../DictionaryProvider';
import { tForLocale } from '../../i18n/messages';
import { format } from '../../i18n/format';

export interface LanguagePickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  /** The blank option's caption; the catalogue's "Select …" in the provider's locale when omitted. */
  blankLabel?: string;
}

export function LanguagePicker({
  includeBlank = false,
  blankLabel,
  value,
  defaultValue,
  ...props
}: LanguagePickerProps): React.ReactElement {
  const dictionary = useDictionary();
  const t = tForLocale(dictionary.locale ?? '');
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
      {includeBlank ? <option value="">{blankLabel ?? t('chrome.picker.language.blank')}</option> : null}
      {active.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label}
        </option>
      ))}
      {archived ? (
        <optgroup label={t('chrome.picker.archivedGroup')}>
          <option value={archived.code}>
            {format(t('chrome.picker.language.archived'), { label: archived.label })}
          </option>
        </optgroup>
      ) : null}
    </select>
  );
}

