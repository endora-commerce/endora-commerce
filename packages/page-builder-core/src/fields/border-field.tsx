'use client';

import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import {
  DEFAULT_BORDER,
  normalizeBorder,
  type BorderSide,
  type BorderStyle,
  type BorderValue,
} from '../types/box-styles.js';
import { PB_RESPONSIVE_METADATA, hasResponsiveOverride, settingsScopeToTier, type ResponsiveProp } from '../types/responsive.js';
import {
  ScopedFieldHint,
  ScopedResetLink,
  readScopedValue,
  responsiveBaseSeed,
  writeScopedValue,
} from './scoped-field.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { PuckFieldLabel } from './puck-field-label.js';
import { NativeColorInput } from './native-color-input.js';

const inputClassName = '_Input-input_bsxfo_26';

const BORDER_STYLES: { label: string; value: BorderStyle }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

function SideEditor({
  side,
  onChange,
  readOnly,
}: {
  side: BorderSide;
  onChange: (next: BorderSide) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-2">
      <input
        type="number"
        className={inputClassName}
        min={0}
        max={20}
        step={1}
        readOnly={readOnly}
        value={side.width}
        onChange={(e): void => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) onChange({ ...side, width: Math.max(0, parsed) });
        }}
      />
      <select
        className={inputClassName}
        disabled={readOnly}
        value={side.style}
        onChange={(e): void => onChange({ ...side, style: e.target.value as BorderStyle })}
      >
        {BORDER_STYLES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <NativeColorInput
        className="h-9 w-full cursor-pointer rounded border border-border p-0.5"
        readOnly={readOnly}
        value={side.color.startsWith('#') ? side.color : '#d9e0e7'}
        onCommit={(hex): void => onChange({ ...side, color: hex })}
      />
    </div>
  );
}

function BorderEditor({
  value,
  onChange,
  readOnly,
}: {
  value: BorderValue;
  onChange: (next: BorderValue) => void;
  readOnly?: boolean;
}): ReactElement {
  const border = normalizeBorder(value);
  const showBorder = border.mode !== 'none';

  const uniform =
    border.mode === 'uniform'
      ? border
      : { mode: 'uniform' as const, width: 1, style: 'solid' as BorderStyle, color: '#d9e0e7' };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showBorder}
          disabled={readOnly}
          onChange={(e): void => {
            if (!e.target.checked) {
              onChange({ mode: 'none' });
              return;
            }
            onChange(uniform);
          }}
        />
        Show border
      </label>
      {showBorder ? (
        <>
          <div className="flex gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={border.mode === 'uniform'}
                disabled={readOnly}
                onChange={(): void => onChange(uniform)}
              />
              All sides
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={border.mode === 'sides'}
                disabled={readOnly}
                onChange={(): void => {
                  const side: BorderSide = {
                    width: uniform.width,
                    style: uniform.style,
                    color: uniform.color,
                  };
                  onChange({ mode: 'sides', top: side, right: side, bottom: side, left: side });
                }}
              />
              Each side
            </label>
          </div>
          {border.mode === 'uniform' ? (
            <SideEditor
              side={{ width: border.width, style: border.style, color: border.color }}
              onChange={(side): void => {
                if (side.width <= 0) {
                  onChange({ mode: 'none' });
                  return;
                }
                onChange({ mode: 'uniform', width: side.width, style: side.style, color: side.color });
              }}
              {...(readOnly === true ? { readOnly: true } : {})}
            />
          ) : (
            <div className="space-y-2">
              {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs capitalize">{key}</p>
                  <SideEditor
                    side={border[key]}
                    onChange={(side): void => onChange({ ...border, [key]: side })}
                    {...(readOnly === true ? { readOnly: true } : {})}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

const ResponsiveBorderControl = memo(function ResponsiveBorderControl({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;
  const scope = useComponentScope(componentId);
  const fallback = responsiveBaseSeed(value, DEFAULT_BORDER) as BorderValue;
  const tier = settingsScopeToTier(scope);
  const inherited = scope !== 'base' && !hasResponsiveOverride(value, tier);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const scoped = readScopedValue(value, scope, fallback);
  const [local, setLocal] = useState<BorderValue>(normalizeBorder(scoped as BorderValue));

  useEffect(() => {
    setLocal(normalizeBorder(readScopedValue(value, scope, fallback) as BorderValue));
  }, [value, scope, fallback]);

  const commit = useCallback(
    (next: BorderValue) => {
      setLocal(next);
      const activeScope = getStoredScope(componentIdRef.current);
      const activeFallback = responsiveBaseSeed(valueRef.current, DEFAULT_BORDER) as BorderValue;
      onChangeRef.current(writeScopedValue(valueRef.current, activeScope, next, activeFallback));
    },
    [setLocal],
  );

  return (
    <div className="space-y-1">
      <ScopedFieldHint value={value} scope={scope} fallback={fallback} />
      <ScopedResetLink
        value={value}
        scope={scope}
        fallback={fallback}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
      <BorderEditor
        value={local}
        onChange={commit}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
      {inherited ? (
        <p className="text-xs opacity-60">Inherited value shown — change to override for this scope.</p>
      ) : null}
    </div>
  );
});

export function createBorderField(): Field<
  BorderValue | ResponsiveProp<BorderValue> | undefined,
  Record<string, unknown>
> {
  return {
    type: 'custom',
    label: 'Border',
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <PuckFieldLabel label={field.label ?? 'Border'} {...(readOnly === true ? { readOnly: true } : {})}>
        <ResponsiveBorderControl
          value={value ?? DEFAULT_BORDER}
          onChange={(next) => onChange(next as BorderValue | ResponsiveProp<BorderValue>)}
          {...(readOnly === true ? { readOnly: true } : {})}
        />
      </PuckFieldLabel>
    ),
  };
}
