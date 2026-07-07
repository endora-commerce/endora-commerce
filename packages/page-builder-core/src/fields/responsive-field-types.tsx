'use client';

import { memo, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { FieldProps } from '@measured/puck';
import {
  ScopedFieldHint,
  ScopedResetLink,
  readScopedValue,
  responsiveBaseSeed,
  writeScopedValue,
} from './scoped-field.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { hasResponsiveOverride, isResponsiveField, settingsScopeToTier, type SettingsScope } from '../types/responsive.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';

const inputClassName = '_Input-input_bsxfo_26';

type ResponsiveFieldProps<Value> = FieldProps & {
  children: ReactNode;
  name: string;
  value: Value;
  onChange: (value: Value) => void;
  label?: string;
  labelIcon?: ReactNode;
  Label?: React.ComponentType<{
    label?: string;
    icon?: ReactNode;
    readOnly?: boolean;
    children?: ReactNode;
  }>;
  id?: string;
};

function useFieldFocus(name: string): boolean {
  return usePageBuilderPuck((s) => s.appState?.ui?.field?.focus === name);
}

function useScopedLocalValue<T>(
  name: string,
  value: T | undefined,
  scope: SettingsScope,
  fallback: T,
): [T, (next: T) => void] {
  const isFocused = useFieldFocus(name);
  const scoped = readScopedValue(value, scope, fallback);
  const [local, setLocal] = useState(scoped);

  useEffect(() => {
    if (!isFocused) {
      setLocal(readScopedValue(value, scope, fallback));
    }
  }, [value, scope, fallback, isFocused]);

  return [local, setLocal];
}

function numberFallback(value: unknown, field: { min?: number }): number {
  return responsiveBaseSeed(value, field.min ?? 0);
}

const ResponsiveNumberControl = memo(function ResponsiveNumberControl({
  name,
  field,
  value,
  onChange,
  readOnly,
  label,
  labelIcon,
  Label: LabelComponent,
  id,
}: ResponsiveFieldProps<unknown> & {
  field: { min?: number; max?: number; step?: number };
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;
  const scope = useComponentScope(componentId);

  const fallback = numberFallback(value, field);
  const tier = settingsScopeToTier(scope);
  const inherited = scope !== 'base' && !hasResponsiveOverride(value, tier);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [local, setLocal] = useScopedLocalValue(name, value, scope, fallback);

  const commit = useCallback(
    (next: number) => {
      setLocal(next);
      const activeScope = getStoredScope(componentIdRef.current);
      const activeFallback = numberFallback(valueRef.current, field);
      onChangeRef.current(writeScopedValue(valueRef.current, activeScope, next, activeFallback));
    },
    [field, setLocal],
  );

  const control = (
    <div className="space-y-1">
      <ScopedFieldHint value={value} scope={scope} fallback={fallback} />
      <ScopedResetLink
        value={value}
        scope={scope}
        fallback={fallback}
        onChange={onChange}
        readOnly={readOnly === true ? true : undefined}
      />
      <input
        id={id ?? `pb-${name}`}
        type="number"
        className={inputClassName}
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={Number.isFinite(Number(local)) ? Number(local) : ''}
        min={field.min}
        max={field.max}
        step={field.step}
        readOnly={readOnly}
        onChange={(e): void => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) commit(parsed);
        }}
      />
      {inherited ? (
        <p className="text-xs opacity-60">Inherited value shown — change to override for this scope.</p>
      ) : null}
    </div>
  );

  if (!LabelComponent) return control;

  return (
    <LabelComponent
      label={label || name}
      icon={labelIcon}
      readOnly={readOnly}
    >
      {control}
    </LabelComponent>
  );
});

const ResponsiveSelectControl = memo(function ResponsiveSelectControl({
  name,
  field,
  value,
  onChange,
  readOnly,
  label,
  labelIcon,
  Label: LabelComponent,
  id,
}: ResponsiveFieldProps<unknown> & {
  field: { options?: { label: string; value: string | number | boolean | object | null | undefined }[] };
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;
  const scope = useComponentScope(componentId);

  const fallback = field.options?.[0]?.value ?? '';
  const tier = settingsScopeToTier(scope);
  const inherited = scope !== 'base' && !hasResponsiveOverride(value, tier);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [local, setLocal] = useScopedLocalValue(name, value, scope, fallback);

  const commit = useCallback(
    (next: string | number | boolean | object | null | undefined) => {
      setLocal(next);
      const activeScope = getStoredScope(componentIdRef.current);
      const activeFallback = responsiveBaseSeed(valueRef.current, fallback);
      onChangeRef.current(writeScopedValue(valueRef.current, activeScope, next, activeFallback));
    },
    [fallback, setLocal],
  );

  const control = (
    <div className="space-y-1">
      <ScopedFieldHint value={value} scope={scope} fallback={fallback} />
      <ScopedResetLink
        value={value}
        scope={scope}
        fallback={fallback}
        onChange={onChange}
        readOnly={readOnly === true ? true : undefined}
      />
      <select
        id={id ?? `pb-${name}`}
        className={inputClassName}
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={String(local)}
        disabled={readOnly}
        onChange={(e): void => {
          const option = field.options?.find((o) => String(o.value) === e.target.value);
          commit(option?.value ?? e.target.value);
        }}
      >
        {(field.options ?? []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      {inherited ? (
        <p className="text-xs opacity-60">Inherited value shown — change to override for this scope.</p>
      ) : null}
    </div>
  );

  if (!LabelComponent) return control;

  return (
    <LabelComponent label={label || name} icon={labelIcon} readOnly={readOnly}>
      {control}
    </LabelComponent>
  );
});

export function renderResponsiveNumberField(props: ResponsiveFieldProps<unknown>): ReactElement {
  if (!isResponsiveField(props.field)) {
    return <>{props.children}</>;
  }
  return <ResponsiveNumberControl {...props} field={props.field} />;
}

export function renderResponsiveSelectField(props: ResponsiveFieldProps<unknown>): ReactElement {
  if (!isResponsiveField(props.field)) {
    return <>{props.children}</>;
  }
  return <ResponsiveSelectControl {...props} field={props.field} />;
}
