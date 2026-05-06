import { useEffect, useMemo, useState, type SelectHTMLAttributes } from 'react';
import type { Country } from '@b2b/contracts';
import { Select } from '@/components/ui/select';
import { dictionaryClient } from '../client';

export interface CountryPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  includeBlank?: boolean;
  blankLabel?: string;
  activeOnly?: boolean;
}

export function CountryPicker({
  includeBlank = false,
  blankLabel = 'Select country',
  activeOnly = true,
  ...props
}: CountryPickerProps): React.ReactElement {
  const [rows, setRows] = useState<Country[]>([]);

  useEffect(() => {
    let cancelled = false;
    void dictionaryClient
      .listCountries({ pageSize: 250, sort: 'sortOrder' })
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
      {includeBlank ? <option value="">{blankLabel}</option> : null}
      {visible.map((row) => (
        <option key={row.code} value={row.code}>
          {row.label}
        </option>
      ))}
      {inactive.length > 0 ? (
        <optgroup label="Inactive">
          {inactive.map((row) => (
            <option key={row.code} value={row.code}>
              {row.label} (inactive)
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
