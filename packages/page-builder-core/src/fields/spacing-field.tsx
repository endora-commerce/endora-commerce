'use client';

import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import {
  DEFAULT_SPACING,
  normalizeSpacing,
  type SpacingValue,
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

const inputClassName = '_Input-input_bsxfo_26';

function SpacingEditor({
  value,
  onChange,
  readOnly,
}: {
  value: SpacingValue;
  onChange: (next: SpacingValue) => void;
  readOnly?: boolean;
}): ReactElement {
  const spacing = normalizeSpacing(value);
  const mode = spacing.mode;

  const setUniform = (n: number): void => {
    onChange({ mode: 'uniform', value: Math.max(0, n) });
  };

  const setSide = (key: 'top' | 'right' | 'bottom' | 'left', n: number): void => {
    const base =
      spacing.mode === 'sides'
        ? spacing
        : { mode: 'sides' as const, top: spacing.value, right: spacing.value, bottom: spacing.value, left: spacing.value };
    onChange({ ...base, [key]: Math.max(0, n) });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === 'uniform'}
            disabled={readOnly}
            onChange={(): void => onChange({ mode: 'uniform', value: spacing.mode === 'uniform' ? spacing.value : 0 })}
          />
          All sides
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === 'sides'}
            disabled={readOnly}
            onChange={(): void => {
              const v = spacing.mode === 'uniform' ? spacing.value : 0;
              onChange({ mode: 'sides', top: v, right: v, bottom: v, left: v });
            }}
          />
          Each side
        </label>
      </div>
      {mode === 'uniform' ? (
        <input
          type="number"
          className={inputClassName}
          style={{ width: '100%', boxSizing: 'border-box' }}
          min={0}
          max={200}
          step={4}
          readOnly={readOnly}
          value={spacing.value}
          onChange={(e): void => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) setUniform(parsed);
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="space-y-1 text-xs capitalize">
              {side}
              <input
                type="number"
                className={inputClassName}
                style={{ width: '100%', boxSizing: 'border-box' }}
                min={0}
                max={200}
                step={4}
                readOnly={readOnly}
                value={spacing[side]}
                onChange={(e): void => {
                  const parsed = Number(e.target.value);
                  if (!Number.isNaN(parsed)) setSide(side, parsed);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const ResponsiveSpacingControl = memo(function ResponsiveSpacingControl({
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
  const fallback = responsiveBaseSeed(value, DEFAULT_SPACING) as SpacingValue;
  const tier = settingsScopeToTier(scope);
  const inherited = scope !== 'base' && !hasResponsiveOverride(value, tier);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const scoped = readScopedValue(value, scope, fallback);
  const [local, setLocal] = useState<SpacingValue>(normalizeSpacing(scoped as SpacingValue));

  useEffect(() => {
    setLocal(normalizeSpacing(readScopedValue(value, scope, fallback) as SpacingValue));
  }, [value, scope, fallback]);

  const commit = useCallback(
    (next: SpacingValue) => {
      setLocal(next);
      const activeScope = getStoredScope(componentIdRef.current);
      const activeFallback = responsiveBaseSeed(valueRef.current, DEFAULT_SPACING) as SpacingValue;
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
      <SpacingEditor
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

export function createSpacingField(options: {
  label: string;
}): Field<SpacingValue | ResponsiveProp<SpacingValue> | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: options.label,
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <PuckFieldLabel label={field.label ?? options.label} {...(readOnly === true ? { readOnly: true } : {})}>
        <ResponsiveSpacingControl
          value={value ?? DEFAULT_SPACING}
          onChange={(next) => onChange(next as SpacingValue | ResponsiveProp<SpacingValue>)}
          {...(readOnly === true ? { readOnly: true } : {})}
        />
      </PuckFieldLabel>
    ),
  };
}

export { SpacingEditor };
