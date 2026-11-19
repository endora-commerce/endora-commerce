'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CustomField } from '@puckeditor/core';
import { FieldLabel } from '@puckeditor/core';
import { X } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import type { AssetDetail, AssetSummary } from '@endora-commerce/contracts';
import { AssetPicker, fetchAssetDetail, ModalDialog } from '@endora-commerce/admin-kit/components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { PB_FIELD_INPUT_CLASS, useFieldText, type PageBuilderImagePickerProps, type PickedImage } from '@endora-commerce/page-builder-core';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * R17 (T201, T214): the image source's two choices, the library first — the
 * order of every image and video source in the page builder — in the admin's
 * language.
 */
export function ImageSourceOptions(): ReactElement {
  const t = useTranslation('core');
  return (
    <>
      <option value="library">{t('pageBuilder.imageField.source.library')}</option>
      <option value="url">{t('pageBuilder.imageField.source.url')}</option>
    </>
  );
}

/** The asset dialog's title by the kind of asset picked (R17, T201). */
const MODAL_TITLE_KEYS = {
  'image/': 'pageBuilder.assetPicker.selectImage',
  'video/': 'pageBuilder.assetPicker.selectVideo',
  file: 'pageBuilder.assetPicker.selectFile',
} as const;

/** The page builder's field input class (feature 163, T116: Puck's own class name went stale in 0.23). */
const inputClassName = PB_FIELD_INPUT_CLASS;
export const pickerButtonClass = 'h-9 shrink-0';

/**
 * The asset library in the kit's `ModalDialog`, on the `overlay` layer above the
 * fullscreen builder: focus trapped, Escape closes it, focus returns to the
 * field's button (issue #1493, UX audit CONTENT-03).
 */
function AssetModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): ReactElement {
  const t = useTranslation('core');
  return (
    <ModalDialog
      layer="overlay"
      title={title}
      onClose={onClose}
      widthClassName="max-w-3xl"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.action.close')}
        </Button>
      }
    >
      {children}
    </ModalDialog>
  );
}

export function AssetModalFieldControl({
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
  /** The dialog's title; by default "Select image", "Select video" or "Select file", translated. */
  modalTitle?: string;
}): ReactElement {
  const t = useTranslation('core');
  const title = modalTitle ?? t(MODAL_TITLE_KEYS[acceptMimePrefix ?? 'file']);
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
              alt={previewLabel ?? t('pageBuilder.assetPicker.selected')}
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
            {selected ? t('pageBuilder.assetPicker.change') : t('pageBuilder.assetPicker.select')}
          </Button>
          {selected && !readOnly ? (
            <Button
              type="button"
              variant="ghost"
              className={pickerButtonClass}
              aria-label={t('pageBuilder.assetPicker.clear')}
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
        <AssetModalShell title={title} onClose={(): void => setModalOpen(false)}>
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
          value={value ?? 'library'}
          onChange={(e): void => onChange(e.target.value as 'url' | 'library')}
        >
          <ImageSourceOptions />
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
      // R17 (T214): unset reads as the URL when there is one (as the logo strip renders it), else the library.
      const imageSource = value?.imageSource ?? (value?.src ? 'url' : 'library');
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
              <ImageSourceOptions />
            </select>
            {imageSource === 'library' ? (
              <AssetModalFieldControl
                value={assetId}
                onChange={(nextId): void =>
                  onChange({ imageSource: 'library', src: '', assetId: nextId })
                }
                {...(readOnly === true ? { readOnly: true } : {})}
                label={field.label ?? 'Image'}
                acceptMimePrefix="image/"
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
      />
    ),
  };
}

/**
 * Any file from the asset library, by id — `cms.DownloadTile`'s `fileAssetId`
 * (feature 163, FR-021): no MIME filter, since a download may be a PDF, an
 * archive or an image.
 */
export function createFileAssetField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <AssetModalFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? label}
      />
    ),
  };
}

export { inputClassName };

/**
 * Feature 163, T195 — the image the rich text's dialog inserts for a library
 * asset: its stable file address (the same across a replace), absolute as the
 * stored content uses it, and its alternative text in the admin's language
 * first, else the first one written; none when it has none.
 */
export function pickedImageFromAsset(
  asset: { url: string; fileUrl?: string | null; altText?: Record<string, string> | null },
  language: string,
): PickedImage {
  const url = toAbsoluteAssetUrl(asset.fileUrl?.trim() ? asset.fileUrl : asset.url);
  const entries = Object.entries(asset.altText ?? {}).filter(([, text]) => typeof text === 'string' && text.trim() !== '');
  const own = entries.find(([code]) => code === language || code.startsWith(`${language}-`));
  const alt = (own ?? entries[0])?.[1]?.trim();
  return alt ? { url, alt } : { url };
}

/**
 * Feature 163, T195 — the asset library as the page builder's image picker
 * (`PageBuilderImagePickerProvider`): the rich text's image dialog shows it
 * and inserts the chosen image. A picked summary carries no alternative text,
 * so its detail is read for it; a failed read inserts the image without one.
 */
export function AdminImagePicker({ onPick, onClose }: PageBuilderImagePickerProps): ReactElement {
  const { language } = useTranslationContext();
  const text = useFieldText();
  const pick = useCallback(
    (asset: AssetSummary | AssetDetail): void => {
      void (async (): Promise<void> => {
        let detail: AssetSummary | AssetDetail = asset;
        if (!('altText' in asset)) {
          try {
            detail = await fetchAssetDetail(asset.id);
          } catch {
            detail = asset;
          }
        }
        onPick(pickedImageFromAsset({ ...detail, altText: 'altText' in detail ? detail.altText : null }, language));
      })();
    },
    [language, onPick],
  );
  return (
    <AssetModalShell title={text('richImage.choose')} onClose={onClose}>
      <AssetPicker acceptMimePrefix="image/" allowUpload onSelect={pick} onClose={onClose} />
    </AssetModalShell>
  );
}
