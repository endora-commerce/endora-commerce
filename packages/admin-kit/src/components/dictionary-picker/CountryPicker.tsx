import { useEffect, useMemo, useState, type ReactElement, type SelectHTMLAttributes } from 'react';
import type { Country } from '@endora-commerce/contracts';

import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { listDictionaryCountries } from './dictionary-api.js';

/**
 * A `<select>` over the admin dictionary's countries (feature 091, batch 8).
 *
 * The admin one, not {@link CountrySelect}, and the two are not duplicates: this
 * reads `GET /api/v1/admin/dictionary/countries`, which serves inactive rows and
 * groups them under their own `<optgroup>`, so an operator editing a tax rule
 * can see that a country exists and is switched off. `CountrySelect` reads the
 * **public** facade, which serves active rows only and cannot answer that
 * question.
 *
 * **Its copy is `core`'s, not `dictionaries`'** (R-1). A translation namespace
 * is module knowledge on R6's own test: the bundle behind it is shipped by a
 * module package the kit does not and may not depend on, it is resolved at
 * runtime by string, and a key that did not travel renders `core.<key>` into
 * the operator's screen instead of failing to compile. The three keys moved
 * from `dictionaries`' bundle to `_i18n`'s under the same spelling, so the
 * rendered output is unchanged in both shipped languages.
 */
export interface CountryPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
  activeOnly?: boolean;
}

export function CountryPicker({
  includeBlank = false,
  blankLabel,
  activeOnly = true,
  ...props
}: CountryPickerProps): ReactElement {
  const t = useTranslation('core');
  const resolvedBlankLabel = blankLabel ?? t('countryPicker.selectCountry');
  const [rows, setRows] = useState<Country[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listDictionaryCountries()
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
        <optgroup label={t('countryPicker.inactiveGroup')}>
          {inactive.map((row) => (
            <option key={row.code} value={row.code}>
              {t('countryPicker.inactiveLabel', { label: row.label })}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
