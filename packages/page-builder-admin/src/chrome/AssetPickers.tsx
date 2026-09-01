'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CustomField } from '@measured/puck';
import { FieldLabel } from '@measured/puck';
import { X } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import type { AssetDetail, AssetSummary } from '@endora-commerce/contracts';
import { AssetPicker, fetchAssetDetail } from '@endora-commerce/admin-kit/components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';

const inputClassName = '_Input-input_bsxfo_26';
export const pickerButtonClass = 'h-9 shrink-0';

function AssetModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
        onClick={(e): void => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function AssetModalFieldControl({
  value,
  onChange,
  readOnly,
  label,
  acceptMimePrefix,
  modalTitle,
}: {
  value: string | undefined;
  onChange: (assetId: string) => void;
  readOnly?: boolean;
  label: string;
  acceptMimePrefix?: 'image/' | 'video/';
  modalTitle: string;
}): ReactElement {
  const selected = typeof value === 'string' ? value : '';
  const [modalOpen, setModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      setPreviewUrl(null);
      setPreviewLabel(null);
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const asset = await fetchAssetDetail(selected);
        if (!cancelled) {
          setPreviewUrl(toAbsoluteAssetUrl(asset.url));
          setPreviewLabel(asset.label ?? asset.filename);
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewLabel(selected);
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [selected]);

  const onPick = useCallback(
    (asset: AssetSummary | AssetDetail): void => {
      onChange(asset.id);
      setPreviewUrl(toAbsoluteAssetUrl(asset.url));
      setPreviewLabel(asset.label ?? asset.filename);
      setModalOpen(false);
    },
    [onChange],
  );

  const isImage = acceptMimePrefix === 'image/';

  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <div className="space-y-2">
        {selected && previewUrl && isImage ? (
          <div className="overflow-hidden rounded-md border bg-muted/30">
            <img
              src={previewUrl}
              alt={previewLabel ?? 'Selected asset'}
              className="max-h-40 w-full object-contain"
            />
          </div>
        ) : null}
        {selected ? (
          <input
            className={inputClassName}
            readOnly
            value={previewLabel ?? selected}
          />
        ) : null}
        <div className="flex items-stretch gap-2">
          <Button
            type="button"
            variant="outline"
            className={pickerButtonClass}
            disabled={readOnly === true}
            onClick={(): void => setModalOpen(true)}
          >
            {selected ? 'Change' : 'Select'}
          </Button>
          {selected && !readOnly ? (
            <Button
              type="button"
              variant="ghost"
              className={pickerButtonClass}
              aria-label="Clear selection"
              onClick={(): void => {
                onChange('');
                setPreviewUrl(null);
                setPreviewLabel(null);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {modalOpen ? (
        <AssetModalShell title={modalTitle} onClose={(): void => setModalOpen(false)}>
          <AssetPicker
            {...(acceptMimePrefix ? { acceptMimePrefix } : {})}
            allowUpload
            onSelect={onPick}
            onClose={(): void => setModalOpen(false)}
          />
        </AssetModalShell>
      ) : null}
    </FieldLabel>
  );
}

export function createImageSourceField(): CustomField<'url' | 'library'> {
  return {
    type: 'custom',
    label: 'Image source',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? 'Image source'} {...(readOnly === true ? { readOnly: true } : {})}>
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={value ?? 'url'}
          onChange={(e): void => onChange(e.target.value as 'url' | 'library')}
        >
          <option value="url">URL</option>
          <option value="library">Asset library</option>
        </select>
      </FieldLabel>
    ),
  };
}

export function createImageUrlField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? label} {...(readOnly === true ? { readOnly: true } : {})}>
        <input
          className={inputClassName}
          readOnly={readOnly === true}
          value={value ?? ''}
          placeholder="https://…"
          onChange={(e): void => onChange(e.target.value)}
        />
      </FieldLabel>
    ),
  };
}

export function createImageAssetField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <AssetModalFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? label}
        acceptMimePrefix="image/"
        modalTitle="Select image"
      />
    ),
  };
}

export type SlideImageValue = {
  imageSource?: 'url' | 'library';
  src?: string;
  assetId?: string;
};

/** Single control for Image Slider slides — hides URL vs Asset based on source. */
export function createSlideImageField(): CustomField<SlideImageValue> {
  return {
    type: 'custom',
    label: 'Image',
    render: ({ value, onChange, readOnly, field }): ReactElement => {
      const imageSource = value?.imageSource ?? 'url';
      const src = value?.src ?? '';
      const assetId = value?.assetId ?? '';
      return (
        <FieldLabel label={field.label ?? 'Image'} {...(readOnly === true ? { readOnly: true } : {})}>
          <div className="space-y-3">
            <select
              className={inputClassName}
              disabled={readOnly === true}
              value={imageSource}
              onChange={(e): void =>
                onChange({
                  imageSource: e.target.value as 'url' | 'library',
                  src,
                  assetId,
                })
              }
            >
              <option value="url">URL</option>
              <option value="library">Asset library</option>
            </select>
            {imageSource === 'library' ? (
              <AssetModalFieldControl
                value={assetId}
                onChange={(nextId): void =>
                  onChange({ imageSource: 'library', src: '', assetId: nextId })
                }
                {...(readOnly === true ? { readOnly: true } : {})}
                label="Image"
                acceptMimePrefix="image/"
                modalTitle="Select image"
              />
            ) : (
              <input
                className={inputClassName}
                readOnly={readOnly === true}
                value={src}
                placeholder="https://…"
                onChange={(e): void =>
                  onChange({ imageSource: 'url', src: e.target.value, assetId: '' })
                }
              />
            )}
          </div>
        </FieldLabel>
      );
    },
  };
}

export function createVideoAssetField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <AssetModalFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? label}
        acceptMimePrefix="video/"
        modalTitle="Select video"
      />
    ),
  };
}

export { inputClassName };
