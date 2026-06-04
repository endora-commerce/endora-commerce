import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { cmsClient, type CmsBlockSummary } from '@/modules/cms/api/cms-client';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Single-select CMS-block picker.
 *
 * `cmsClient.listBlocks()` returns the full block set (blocks are few and
 * unpaged in practice), so the list is fetched once on mount and the
 * <Combobox> filters client-side. The committed value is the block UUID.
 */

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
    cmsClient
      .listBlocks()
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
