import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';
import {
  assetsLibraryClient,
  type AssetSummary,
  type AssetDetail,
} from '@/modules/assets_library/api/assets-library-client';

/**
 * Field-style asset picker.
 *
 * Replaces "paste an asset UUID" inputs: shows the chosen asset's label /
 * filename in a read-only field with a button that toggles the existing
 * Assets-Library grid picker (search + optional inline upload). The
 * committed value is the asset UUID; for a pre-existing value the asset's
 * filename is resolved once so editors see a friendly name instead of a
 * bare UUID.
 */

export interface AssetFieldPickerProps {
  value: string;
  onChange: (assetId: string) => void;
  acceptMimePrefix?: 'image/' | 'video/';
  allowUpload?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export function AssetFieldPicker(props: AssetFieldPickerProps): ReactNode {
  const { value, onChange } = props;
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  // Resolve a friendly name for a value the user didn't pick this session
  // (e.g. when editing an existing record).
  useEffect(() => {
    if (!value) {
      setLabel(null);
      return;
    }
    let alive = true;
    void assetsLibraryClient
      .getAsset(value)
      .then((a) => {
        if (alive) setLabel(a.label ?? a.filename);
      })
      .catch(() => {
        /* unknown / deleted asset — fall back to showing the raw id */
      });
    return (): void => {
      alive = false;
    };
  }, [value]);

  const onPick = (asset: AssetSummary | AssetDetail): void => {
    onChange(asset.id);
    setLabel(asset.label ?? asset.filename);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      {open ? (
        <AssetPicker
          {...(props.acceptMimePrefix ? { acceptMimePrefix: props.acceptMimePrefix } : {})}
          allowUpload={props.allowUpload ?? false}
          onSelect={onPick}
          onClose={(): void => setOpen(false)}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          {...(props.id ? { id: props.id } : {})}
          value={label ?? value}
          readOnly
          placeholder={props.placeholder ?? 'No asset selected'}
          aria-label={props.ariaLabel ?? 'Selected asset'}
          className={label ? '' : 'font-mono'}
        />
        {value && !props.disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => {
              onChange('');
              setLabel(null);
            }}
            aria-label="Clear asset"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled ?? false}
          onClick={(): void => setOpen((v) => !v)}
        >
          {value ? 'Change' : 'Choose'}
        </Button>
      </div>
    </div>
  );
}
