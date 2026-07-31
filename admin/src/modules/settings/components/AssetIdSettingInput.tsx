import type { ReactNode } from 'react';
import { AssetFieldPicker } from '@/components/asset-picker/AssetFieldPicker';

interface Props {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Settings editor for string values that store an Assets Library UUID
 * (convention: code ends with `_asset_id`).
 */
export function AssetIdSettingInput({ value, onChange }: Props): ReactNode {
  return (
    <AssetFieldPicker
      value={value}
      onChange={onChange}
      acceptMimePrefix="image/"
      allowUpload
      placeholder="Select an image from the Assets Library"
    />
  );
}
