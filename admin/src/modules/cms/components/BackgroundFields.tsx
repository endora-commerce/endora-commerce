'use client';

import { useMemo, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { FieldLabel } from '@measured/puck';
import { createColorField } from '@endora-commerce/page-builder-core';
import type { BackgroundKind, BackgroundValue, MediaSourceKind } from '@endora-commerce/page-builder-core';
import { createImageAssetField, createImageUrlField, createVideoAssetField, inputClassName } from './AssetPickers';

const KIND_OPTIONS: { label: string; value: BackgroundKind }[] = [
  { label: 'None', value: 'none' },
  { label: 'Solid color', value: 'solid' },
  { label: 'Gradient', value: 'gradient' },
  { label: 'Image', value: 'image' },
  { label: 'Video', value: 'video' },
];

const SOURCE_OPTIONS: { label: string; value: MediaSourceKind }[] = [
  { label: 'URL', value: 'url' },
  { label: 'Asset library', value: 'library' },
];

const SOLID_COLOR_FIELD = createColorField({ label: 'Color' });
const GRADIENT_FROM_FIELD = createColorField({ label: 'Gradient from' });
const GRADIENT_TO_FIELD = createColorField({ label: 'Gradient to' });
const IMAGE_URL_FIELD = createImageUrlField('Image URL');
const IMAGE_ASSET_FIELD = createImageAssetField('Image');
const VIDEO_URL_FIELD = createImageUrlField('Video URL');
const VIDEO_ASSET_FIELD = createVideoAssetField('Video');

function mergeBackground(value: BackgroundValue | undefined, patch: Partial<BackgroundValue>): BackgroundValue {
  return { kind: 'none', ...value, ...patch };
}

function AdminBackgroundFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: BackgroundValue | undefined;
  onChange: (value: BackgroundValue) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const current = useMemo(() => ({ kind: 'none' as const, ...value }), [value]);
  const set = (patch: Partial<BackgroundValue>): void => onChange(mergeBackground(current, patch));

  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <div className="flex flex-col gap-2">
        <select
          className={inputClassName}
          disabled={readOnly === true}
          value={current.kind}
          onChange={(e): void => set({ kind: e.target.value as BackgroundKind })}
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {current.kind === 'solid' ? (
          <SOLID_COLOR_FIELD.render
            field={SOLID_COLOR_FIELD}
            id="pb-bg-solid"
            name="background.color"
            value={current.color ?? 'transparent'}
            onChange={(color): void => set({ color: color ?? 'transparent' })}
            {...(readOnly === true ? { readOnly: true } : {})}
          />
        ) : null}

        {current.kind === 'gradient' ? (
          <div className="flex flex-col gap-2">
            <GRADIENT_FROM_FIELD.render
              field={GRADIENT_FROM_FIELD}
              id="pb-bg-gradient-from"
              name="background.gradientFrom"
              value={current.gradientFrom ?? '#ffffff'}
              onChange={(color): void => set({ gradientFrom: color ?? '#ffffff' })}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
            <GRADIENT_TO_FIELD.render
              field={GRADIENT_TO_FIELD}
              id="pb-bg-gradient-to"
              name="background.gradientTo"
              value={current.gradientTo ?? '#334155'}
              onChange={(color): void => set({ gradientTo: color ?? '#334155' })}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
            <FieldLabel label="Angle (deg)" {...(readOnly === true ? { readOnly: true } : {})}>
              <input
                type="number"
                className={inputClassName}
                readOnly={readOnly === true}
                min={0}
                max={360}
                value={current.gradientAngle ?? 135}
                onChange={(e): void => set({ gradientAngle: Number(e.target.value) })}
              />
            </FieldLabel>
          </div>
        ) : null}

        {current.kind === 'image' ? (
          <div className="flex flex-col gap-2">
            <FieldLabel label="Image source" {...(readOnly === true ? { readOnly: true } : {})}>
              <select
                className={inputClassName}
                disabled={readOnly === true}
                value={current.imageSource ?? 'url'}
                onChange={(e): void => set({ imageSource: e.target.value as MediaSourceKind })}
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FieldLabel>
            {current.imageSource === 'library' ? (
              <IMAGE_ASSET_FIELD.render
                field={IMAGE_ASSET_FIELD}
                id="pb-bg-image-asset"
                name="background.imageAssetId"
                value={current.imageAssetId ?? ''}
                onChange={(assetId): void => set({ imageAssetId: assetId })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            ) : (
              <IMAGE_URL_FIELD.render
                field={IMAGE_URL_FIELD}
                id="pb-bg-image-url"
                name="background.imageUrl"
                value={current.imageUrl ?? ''}
                onChange={(url): void => set({ imageUrl: url })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            )}
          </div>
        ) : null}

        {current.kind === 'video' ? (
          <div className="flex flex-col gap-2">
            <FieldLabel label="Video source" {...(readOnly === true ? { readOnly: true } : {})}>
              <select
                className={inputClassName}
                disabled={readOnly === true}
                value={current.videoSource ?? 'url'}
                onChange={(e): void => set({ videoSource: e.target.value as MediaSourceKind })}
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FieldLabel>
            {current.videoSource === 'library' ? (
              <VIDEO_ASSET_FIELD.render
                field={VIDEO_ASSET_FIELD}
                id="pb-bg-video-asset"
                name="background.videoAssetId"
                value={current.videoAssetId ?? ''}
                onChange={(assetId): void => set({ videoAssetId: assetId })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            ) : (
              <VIDEO_URL_FIELD.render
                field={VIDEO_URL_FIELD}
                id="pb-bg-video-url"
                name="background.videoUrl"
                value={current.videoUrl ?? ''}
                onChange={(url): void => set({ videoUrl: url })}
                {...(readOnly === true ? { readOnly: true } : {})}
              />
            )}
          </div>
        ) : null}
      </div>
    </FieldLabel>
  );
}

export function createAdminBackgroundField(): Field<BackgroundValue, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Background',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <AdminBackgroundFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Background'}
      />
    ),
  };
}
