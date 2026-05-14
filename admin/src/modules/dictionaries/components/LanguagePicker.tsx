import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { DictionaryLanguage } from '@b2b/contracts';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import { dictionaryClient } from '../client';

export interface LanguagePickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
  activeOnly?: boolean;
}

export function LanguagePicker({
  includeBlank = false,
  blankLabel,
  activeOnly = true,
  ...props
}: LanguagePickerProps): React.ReactElement {
  const t = useTranslation('dictionaries');
  const resolvedBlankLabel = blankLabel ?? t('languagePicker.selectLanguage');
  const [rows, setRows] = useState<DictionaryLanguage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void dictionaryClient
      .listLanguages({ pageSize: 250, sort: 'sortOrder' })
      .then((page) => {
        if (!cancelled) setRows(page.data);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => rows.filter((row) => !activeOnly || row.isActive),
    [activeOnly, rows],
  );
  const inactive = useMemo(
    () => rows.filter((row) => activeOnly && !row.isActive),
    [activeOnly, rows],
  );

  return (
    <Select {...props}>
      {includeBlank ? <option value="">{resolvedBlankLabel}</option> : null}
      {visible.map((row) => (
        <option key={row.code} value={row.code}>
          {row.label}
        </option>
      ))}
      {inactive.length > 0 ? (
        <optgroup label={t('languagePicker.inactiveGroup')}>
          {inactive.map((row) => (
            <option key={row.code} value={row.code}>
              {t('languagePicker.inactiveLabel', { label: row.label })}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
