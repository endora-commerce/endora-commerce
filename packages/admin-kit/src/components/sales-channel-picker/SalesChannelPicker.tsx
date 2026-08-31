import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SalesChannelListResponse } from '@endora-commerce/contracts';
// `apiClient` comes through the kit's published `lib` **barrel** rather than
// through `../../lib/api-client.js`, which is what the kit's five older
// data-fetching components do. `vi.mock` keys on a resolved module id, so the
// barrel is the only spelling an admin test can name: it resolves to the same
// file as `@endora-commerce/admin-kit/lib`, the seam every packaged screen's
// test already mocks. A deep import is unreachable from outside the package —
// the `exports` map declares no such subpath — which is why the five older ones
// have no tests. Nothing else changes: it is the same module record either way,
// which `admin/test/kit/admin-kit-identity.test.ts` asserts by reference.
import { ApiError, apiClient } from '../../lib/index.js';
import { useAppLanguage } from '../../i18n/app-language-context.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';

/**
 * Single-select sales-channel picker.
 *
 * Channels are few and unpaged in practice, so the first (large) page is
 * fetched on mount and the <Combobox> filters client-side. The committed
 * value is the channel `id` (UUID) — the identifier persisted on
 * channel-scoped records. Labels are locale-aware; the channel `code` is
 * shown as the secondary line.
 *
 * **The request is built here** (feature 091, P2). Until this component moved
 * into the kit it called `sales_channels`' own admin API client, which is a
 * reach out of the platform's frontend into a module's admin code — one of the
 * ten keys `backend/scripts/ledgers/cross-module-imports/host.ts` opened with.
 * The exit is the one batches three and five took for a module screen: name the
 * endpoint and the published response type, which both sides already compile,
 * and depend on no module's code. `SalesChannelListResponse` is
 * `@endora-commerce/contracts`', so nothing about the shape is duplicated —
 * only the one `GET` the picker needs out of that client's ten methods.
 */

const PICKER_PAGE_SIZE = 200;

function listSalesChannels(activeOnly: boolean): Promise<SalesChannelListResponse> {
  const qs = new URLSearchParams();
  qs.set('pageSize', String(PICKER_PAGE_SIZE));
  qs.set('activeOnly', String(activeOnly));
  return apiClient.get<SalesChannelListResponse>(`/api/v1/admin/sales-channels?${qs.toString()}`);
}

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
    listSalesChannels(activeOnly)
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
