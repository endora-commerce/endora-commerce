import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/index.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';

/**
 * Single-select customer-group picker.
 *
 * The group set is small and unpaged (`GET /api/v1/admin/customer-groups`
 * returns every group), so the list is fetched once on mount and the
 * <Combobox> filters client-side. The committed value is the group UUID.
 */

interface CustomerGroupSummary {
  id: string;
  code: string;
  name: string;
}

export interface CustomerGroupPickerProps {
  value: string | null;
  onChange: (customerGroupId: string | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export function CustomerGroupPicker(props: CustomerGroupPickerProps): ReactNode {
  const [groups, setGroups] = useState<CustomerGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // The server's sentence when it sent one, `null` for a failure it did not
  // explain — translated at render, so the load effect does not depend on `t`.
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const t = useTranslation('core');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient
      .get<{ data: CustomerGroupSummary[] }>('/api/v1/admin/customer-groups')
      .then((res) => {
        if (!alive) return;
        setGroups(res.data);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError({ message: err instanceof ApiError ? err.envelope.error.message : null });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const options = useMemo<ComboboxOption<string>[]>(
    () => groups.map((g) => ({ value: g.id, label: g.name, description: g.code })),
    [groups],
  );

  const errorMessage =
    error === null ? null : (error.message ?? t('customerGroupPicker.loadError'));
  const emptyMessage = errorMessage ?? props.emptyMessage ?? t('customerGroupPicker.empty');

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? t('customerGroupPicker.placeholder')}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? t('customerGroupPicker.ariaLabel')}
      id={props.id ?? ''}
      className={props.className ?? ''}
    />
  );
}
