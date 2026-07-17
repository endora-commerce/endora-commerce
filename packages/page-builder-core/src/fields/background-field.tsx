'use client';

import { useMemo, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { createColorField } from './color-field.js';
import { normalizeBackground, type BackgroundKind, type BackgroundProp, type BackgroundValue, type MediaSourceKind } from '../types/background.js';

const inputClassName = '_Input-input_bsxfo_26';

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

function mergeBackground(value: BackgroundValue | undefined, patch: Partial<BackgroundValue>): BackgroundValue {
  return { kind: 'none', ...value, ...patch };
}

function BackgroundFieldControl({
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
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium opacity-80">{label}</label>
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
          <label className="text-xs font-medium opacity-80">Angle (deg)</label>
          <input
            type="number"
            className={inputClassName}
            readOnly={readOnly === true}
            min={0}
            max={360}
            value={current.gradientAngle ?? 135}
            onChange={(e): void => set({ gradientAngle: Number(e.target.value) })}
          />
        </div>
      ) : null}

      {current.kind === 'image' ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium opacity-80">Image source</label>
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
          {current.imageSource === 'library' ? (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.imageAssetId ?? ''}
              placeholder="Asset ID"
              onChange={(e): void => set({ imageAssetId: e.target.value })}
            />
          ) : (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.imageUrl ?? ''}
              placeholder="Image URL"
              onChange={(e): void => set({ imageUrl: e.target.value })}
            />
          )}
        </div>
      ) : null}

      {current.kind === 'video' ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium opacity-80">Video source</label>
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
          {current.videoSource === 'library' ? (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.videoAssetId ?? ''}
              placeholder="Asset ID"
              onChange={(e): void => set({ videoAssetId: e.target.value })}
            />
          ) : (
            <input
              className={inputClassName}
              readOnly={readOnly === true}
              value={current.videoUrl ?? ''}
              placeholder="Video URL"
              onChange={(e): void => set({ videoUrl: e.target.value })}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function createBackgroundField(options: { label?: string } = {}): Field<BackgroundProp> {
  const label = options.label ?? 'Background';
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <BackgroundFieldControl
        value={normalizeBackground(value)}
        onChange={(next): void => onChange(next)}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? label}
      />
    ),
  };
}

export { BackgroundFieldControl };
