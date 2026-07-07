import type { ReactElement } from 'react';
import {
  hasResponsiveOverride,
  isResponsiveProp,
  normalizeResponsive,
  resolveResponsive,
  settingsScopeToTier,
  type ResponsiveProp,
  type SettingsScope,
} from '../types/responsive.js';

function scopeKey(scope: SettingsScope): keyof ResponsiveProp<unknown> {
  if (scope === 'tablet') return 'tablet';
  if (scope === 'desktop') return 'desktop';
  return 'base';
}

function inheritedFromLabel(scope: SettingsScope): string {
  if (scope === 'tablet') return 'Base';
  return 'Base / Tablet';
}

export function responsiveBaseSeed<T>(value: T | ResponsiveProp<T> | undefined, fallback: T): T {
  if (isResponsiveProp(value)) return value.base;
  if (value !== undefined) return value as T;
  return fallback;
}

export function readScopedValue<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  fallback: T,
): T {
  const tier = settingsScopeToTier(scope);
  return resolveResponsive(value, tier, responsiveBaseSeed(value, fallback));
}

export function writeScopedValue<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  next: T,
  fallback: T,
): T | ResponsiveProp<T> {
  const key = scopeKey(scope);
  if (key === 'base') {
    if (isResponsiveProp(value)) {
      return { ...value, base: next };
    }
    return next;
  }

  const base = responsiveBaseSeed(value, fallback);
  const responsive: ResponsiveProp<T> = isResponsiveProp(value) ? { ...value } : { base };
  return { ...responsive, [key]: next };
}

export function clearScopedOverride<T>(
  value: T | ResponsiveProp<T> | undefined,
  scope: SettingsScope,
  fallback: T,
): T | ResponsiveProp<T> {
  if (scope === 'base') return normalizeResponsive(value, fallback);
  const responsive = normalizeResponsive(value, fallback);
  if (scope === 'tablet') {
    const { tablet: _removed, ...rest } = responsive;
    return rest;
  }
  const { desktop: _removed, ...rest } = responsive;
  return rest;
}

export function ScopedFieldHint<T>({
  value,
  scope,
  fallback,
}: {
  value: T | ResponsiveProp<T> | undefined;
  scope: SettingsScope;
  fallback: T;
}): ReactElement | null {
  if (scope === 'base') return null;
  const tier = settingsScopeToTier(scope);
  const responsive = normalizeResponsive(value, responsiveBaseSeed(value, fallback));
  if (hasResponsiveOverride(responsive, tier)) return null;
  const inherited = resolveResponsive(responsive, tier, responsiveBaseSeed(value, fallback));
  return (
    <p className="mb-1 text-xs opacity-70">
      Applies: <span className="opacity-60">{String(inherited)}</span> (from {inheritedFromLabel(scope)})
    </p>
  );
}

export function ScopedResetLink({
  value,
  scope,
  fallback,
  onChange,
  readOnly,
}: {
  value: unknown;
  scope: SettingsScope;
  fallback: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}): ReactElement | null {
  if (scope === 'base') return null;
  const tier = settingsScopeToTier(scope);
  if (!hasResponsiveOverride(value, tier)) return null;
  return (
    <button
      type="button"
      className="mb-1 text-xs opacity-70 underline"
      disabled={readOnly}
      onClick={(): void => onChange(clearScopedOverride(value, scope, fallback))}
    >
      Reset to inherited
    </button>
  );
}
