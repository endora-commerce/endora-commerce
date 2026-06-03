import { useMemo, type ReactNode } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppLanguage } from '@/i18n/app-language-context';
import { useCountriesQuery } from './useCountriesQuery';

export interface CountrySelectProps {
  /** Selected ISO 3166-1 alpha-2 country code (e.g. "PL"), or null when empty. */
  value: string | null;
  /** Fires with the new alpha-2 code, or null when cleared. */
  onChange: (code: string | null) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Hide the clear button (e.g. when the field is required). Defaults to false. */
  clearable?: boolean;
  placeholder?: string;
  emptyMessage?: string;
}

/**
 * CountrySelect — a searchable country dropdown for any Admin UI form.
 *
 * Wraps the design-system <Combobox /> over the dictionary's active country
 * list (locale-resolved labels, served by the public dictionary facade and
 * shared across instances via {@link useCountriesQuery}). The committed value
 * is the ISO 3166-1 alpha-2 code, matching what address payloads expect.
 *
 * Drop it in wherever a country needs picking instead of a free-text field:
 *
 *   <CountrySelect value={code} onChange={setCode} ariaLabel="country" />
 */
export function CountrySelect(props: CountrySelectProps): ReactNode {
  const t = useTranslation('core');
  const { language } = useAppLanguage();
  const { countries, loading, error } = useCountriesQuery(language);

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      countries.map((c) => ({
        value: c.code,
        label: `${c.label} (${c.code})`,
      })),
    [countries],
  );

  // Keep the selected code visible even before the list resolves, or if the
  // stored code is no longer an active country (archived dictionary entry).
  const selected = props.value
    ? (countries.find((c) => c.code === props.value)?.label ?? props.value)
    : '';

  const emptyMessage =
    props.emptyMessage ??
    (loading
      ? t('countrySelect.loading')
      : error
        ? t('countrySelect.error')
        : t('countrySelect.empty'));

  return (
    <Combobox<string>
      {...(props.id ? { id: props.id } : {})}
      {...(props.ariaLabel ? { ariaLabel: props.ariaLabel } : {})}
      {...(props.className ? { className: props.className } : {})}
      options={options}
      value={props.value && props.value !== '' ? props.value : null}
      selectedLabel={props.value ? `${selected}${selected === props.value ? '' : ` (${props.value})`}` : ''}
      onChange={(next): void => props.onChange(next)}
      disabled={props.disabled ?? false}
      loading={loading}
      clearable={props.clearable ?? false}
      placeholder={props.placeholder ?? t('countrySelect.placeholder')}
      emptyMessage={emptyMessage}
    />
  );
}
