import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { useAppLanguage } from '@/i18n/app-language-context';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Single-select sales-channel picker.
 *
 * Channels are few and unpaged in practice, so the first (large) page is
 * fetched on mount and the <Combobox> filters client-side. The committed
 * value is the channel `id` (UUID) — the identifier persisted on
 * channel-scoped records. Labels are locale-aware; the channel `code` is
 * shown as the secondary line.
 */

export interface SalesChannelPickerProps {
  value: string | null;
  onChange: (salesChannelId: string | null) => void;
  activeOnly?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export function SalesChannelPicker(props: SalesChannelPickerProps): ReactNode {
  const { language } = useAppLanguage();
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeOnly = props.activeOnly ?? false;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    salesChannelsClient
      .list({ pageSize: 200, activeOnly })
      .then((res) => {
        if (!alive) return;
        setOptions(
          res.items.map((ch) => {
            const name =
              ch.name[language] ?? ch.name['en-US'] ?? Object.values(ch.name)[0] ?? ch.code;
            return {
              value: ch.id,
              label: name,
              description: ch.active ? ch.code : `${ch.code} · inactive`,
            };
          }),
        );
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load channels.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [activeOnly, language]);

  const emptyMessage = useMemo(
    () => props.emptyMessage ?? error ?? 'No sales channels.',
    [props.emptyMessage, error],
  );

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? 'Select a sales channel…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select sales channel'}
      id={props.id ?? ''}
      className={props.className ?? ''}
    />
  );
}
