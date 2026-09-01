import { useEffect, useMemo, useState, type ReactElement, type SelectHTMLAttributes } from 'react';
import type { DictionaryCurrency } from '@endora-commerce/contracts';

import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { listDictionaryCurrencies } from './dictionary-api.js';

/**
 * A `<select>` over the admin dictionary's currencies (feature 091, batch 8).
 *
 * The sibling of {@link CountryPicker} and identical in shape: the admin read,
 * so an inactive currency is shown under its own `<optgroup>` rather than
 * silently absent from a price list or a credit limit an operator is editing.
 *
 * Its copy is `core`'s for the reason recorded on `CountryPicker` (R-1).
 */
export interface CurrencyPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
  activeOnly?: boolean;
}

export function CurrencyPicker({
  includeBlank = false,
  blankLabel,
  activeOnly = true,
  ...props
}: CurrencyPickerProps): ReactElement {
  const t = useTranslation('core');
  const resolvedBlankLabel = blankLabel ?? t('currencyPicker.selectCurrency');
  const [rows, setRows] = useState<DictionaryCurrency[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listDictionaryCurrencies()
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
          {row.label} ({row.code})
        </option>
      ))}
      {inactive.length > 0 ? (
        <optgroup label={t('currencyPicker.inactiveGroup')}>
          {inactive.map((row) => (
            <option key={row.code} value={row.code}>
              {t('currencyPicker.inactiveLabel', { label: row.label, code: row.code })}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
