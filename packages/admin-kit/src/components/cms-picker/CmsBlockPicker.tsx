import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CmsBlockSummary } from '@endora-commerce/contracts';
// `apiClient` comes through the kit's published `lib` **barrel** rather than
// through `../../lib/api-client.js` — see the note in
// `../sales-channel-picker/SalesChannelPicker.tsx`: the barrel is the only
// spelling `vi.mock` can name from outside the package.
import { ApiError, apiClient } from '../../lib/index.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';

/**
 * Single-select CMS-block picker.
 *
 * The blocks endpoint returns the full block set (blocks are few and unpaged in
 * practice), so the list is fetched once on mount and the <Combobox> filters
 * client-side. The committed value is the block UUID.
 *
 * **The request is built here** (feature 091, P2). Until this component moved
 * into the kit it called `cms`' own admin API client, which is a reach out of
 * the platform's frontend into a module's admin code. `CmsBlockSummary` is
 * `@endora-commerce/contracts`', so only the one `GET` is rebuilt; the shape is
 * the module's published one and is not duplicated.
 */

interface CmsBlockListResponse {
  data: CmsBlockSummary[];
  nextCursor: string | null;
}

export interface CmsBlockPickerProps {
  value: string | null;
  onChange: (blockId: string | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export function CmsBlockPicker(props: CmsBlockPickerProps): ReactNode {
  const [blocks, setBlocks] = useState<CmsBlockSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient
      .get<CmsBlockListResponse>('/api/v1/admin/cms/blocks')
      .then((res) => {
        if (!alive) return;
        setBlocks(res.data);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load blocks.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const options = useMemo<ComboboxOption<string>[]>(
    () => blocks.map((b) => ({ value: b.id, label: b.name, description: b.code })),
    [blocks],
  );

  const emptyMessage = props.emptyMessage ?? error ?? 'No CMS blocks.';

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? 'Select a CMS block…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select CMS block'}
      id={props.id ?? ''}
      className={props.className ?? ''}
    />
  );
}
