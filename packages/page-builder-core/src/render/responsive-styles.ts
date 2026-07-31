import type { CSSProperties } from 'react';
import {
  DEFAULT_BREAKPOINTS,
  type PageBuilderBreakpoints,
  type ResponsiveProp,
  normalizeResponsive,
  resolveResponsive,
  hideOnDataAttrs,
  type BreakpointTier,
} from '../types/responsive.js';

export type ResponsiveVisibility = ResponsiveProp<boolean>;

export const DEFAULT_VISIBILITY: ResponsiveVisibility = { base: true };

export function resolveVisibility(
  visibility: ResponsiveVisibility | boolean | undefined,
  tier: BreakpointTier,
): boolean {
  if (visibility === undefined) return true;
  if (typeof visibility === 'boolean') return visibility;
  return resolveResponsive(visibility, tier, true);
}

export function breakpointCssVars(breakpoints: PageBuilderBreakpoints = DEFAULT_BREAKPOINTS): CSSProperties {
  return {
    '--cmsc-bp-tablet': `${breakpoints.tabletMin}px`,
    '--cmsc-bp-desktop': `${breakpoints.desktopMin}px`,
  } as CSSProperties;
}

export const RESPONSIVE_HIDE_ON_CLASS = 'cmsc-pb-hide-on';

export { hideOnDataAttrs };

export function buildResponsiveNumberVars(
  name: string,
  value: number | ResponsiveProp<number> | undefined,
  fallback: number,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  return {
    [`--pb-${name}`]: `${responsive.base}px`,
    [`--pb-${name}-md`]: `${tablet}px`,
    [`--pb-${name}-lg`]: `${desktop}px`,
  } as CSSProperties;
}

/** Unitless responsive CSS custom properties (font-weight, line-height multipliers). */
export function buildResponsiveCSSValueVars(
  name: string,
  value: number | ResponsiveProp<number> | undefined,
  fallback: number,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  return {
    [`--pb-${name}`]: String(responsive.base),
    [`--pb-${name}-md`]: String(tablet),
    [`--pb-${name}-lg`]: String(desktop),
  } as CSSProperties;
}

const ROW_ALIGN_CLASS: Record<string, string> = {
  stretch: 'cmsc:items-stretch',
  start: 'cmsc:items-start',
  center: 'cmsc:items-center',
  end: 'cmsc:items-end',
};

const TEXT_ALIGN_CLASS: Record<string, string> = {
  left: 'cmsc:text-left',
  center: 'cmsc:text-center',
  right: 'cmsc:text-right',
};

export function responsiveRowAlignClass(
  value: ResponsiveProp<string> | string | undefined,
  fallback: string,
): string {
  const mobile = resolveResponsive(value, 'mobile', fallback);
  const tablet = resolveResponsive(value, 'tablet', fallback);
  const desktop = resolveResponsive(value, 'desktop', fallback);
  const classes = [ROW_ALIGN_CLASS[mobile] ?? ROW_ALIGN_CLASS.stretch, 'cmsc-pb-row-align'];
  if (tablet !== mobile) classes.push(`cmsc-pb-row-align-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-row-align-lg-${desktop}`);
  return classes.join(' ');
}

export function resolveRowAlignClassForTier(
  value: ResponsiveProp<string> | string | undefined,
  tier: BreakpointTier,
  fallback: string,
): string {
  const resolved = resolveResponsive(value, tier, fallback);
  return ROW_ALIGN_CLASS[resolved] ?? 'cmsc:items-stretch';
}

export function textAlignDataAttrs(
  value: ResponsiveProp<string> | string | undefined,
  fallback: string,
): Record<string, string> {
  const normalized = normalizeResponsive(value, fallback);
  const tablet = normalized.tablet ?? normalized.base;
  const desktop = normalized.desktop ?? normalized.tablet ?? normalized.base;
  return {
    'data-align': normalized.base,
    'data-align-md': tablet,
    'data-align-lg': desktop,
  };
}

export function resolveTextAlignForTier(
  value: ResponsiveProp<string> | string | undefined,
  tier: BreakpointTier,
  fallback: string,
): 'left' | 'center' | 'right' {
  const resolved = resolveResponsive(value, tier, fallback);
  if (resolved === 'center' || resolved === 'right') return resolved;
  return 'left';
}

export function responsiveTextAlignClass(
  _value: ResponsiveProp<string> | string | undefined,
  _fallback: string,
): string {
  return 'cmsc-pb-text-align';
}

export function resolveTextAlignClassForTier(
  value: ResponsiveProp<string> | string | undefined,
  tier: BreakpointTier,
  fallback: string,
): string {
  const resolved = resolveResponsive(value, tier, fallback);
  return TEXT_ALIGN_CLASS[resolved] ?? 'cmsc:text-left';
}

export function resolveResponsiveNumber(
  value: number | ResponsiveProp<number> | undefined,
  tier: BreakpointTier,
  fallback: number,
): number {
  return resolveResponsive(value, tier, fallback);
}
