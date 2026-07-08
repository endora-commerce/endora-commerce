import type { CSSProperties } from 'react';
import {
  normalizeResponsive,
  resolveResponsive,
  type BreakpointTier,
  type ResponsiveProp,
} from './responsive.js';

export type SpacingValue =
  | { mode: 'uniform'; value: number }
  | { mode: 'sides'; top: number; right: number; bottom: number; left: number };

export type BorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

export type BorderSide = {
  width: number;
  style: BorderStyle;
  color: string;
};

export type BorderValue =
  | { mode: 'none' }
  | { mode: 'uniform'; width: number; style: BorderStyle; color: string }
  | {
      mode: 'sides';
      top: BorderSide;
      right: BorderSide;
      bottom: BorderSide;
      left: BorderSide;
    };

export const DEFAULT_SPACING: SpacingValue = { mode: 'uniform', value: 0 };
export const DEFAULT_BORDER: BorderValue = { mode: 'none' };

export function normalizeSpacing(value: SpacingValue | undefined): SpacingValue {
  if (!value) return DEFAULT_SPACING;
  if (value.mode === 'uniform') {
    const n = Number.isFinite(value.value) ? Math.max(0, value.value) : 0;
    return { mode: 'uniform', value: n };
  }
  return {
    mode: 'sides',
    top: Math.max(0, value.top ?? 0),
    right: Math.max(0, value.right ?? 0),
    bottom: Math.max(0, value.bottom ?? 0),
    left: Math.max(0, value.left ?? 0),
  };
}

function normalizeBorderSide(side: BorderSide | undefined): BorderSide {
  const style = side?.style ?? 'solid';
  return {
    width: Math.max(0, side?.width ?? 0),
    style: style === 'none' ? 'solid' : style,
    color: side?.color?.trim() || '#d9e0e7',
  };
}

export function normalizeBorder(value: BorderValue | undefined): BorderValue {
  if (!value || value.mode === 'none') return { mode: 'none' };
  if (value.mode === 'uniform') {
    if (value.width <= 0 || value.style === 'none') return { mode: 'none' };
    return {
      mode: 'uniform',
      width: Math.max(0, value.width),
      style: value.style,
      color: value.color?.trim() || '#d9e0e7',
    };
  }
  return {
    mode: 'sides',
    top: normalizeBorderSide(value.top),
    right: normalizeBorderSide(value.right),
    bottom: normalizeBorderSide(value.bottom),
    left: normalizeBorderSide(value.left),
  };
}

function sideToCss(side: BorderSide): string {
  if (side.width <= 0 || side.style === 'none') return 'none';
  return `${side.width}px ${side.style} ${side.color}`;
}

export function spacingToCss(value: SpacingValue | undefined): string {
  const spacing = normalizeSpacing(value);
  if (spacing.mode === 'uniform') return `${spacing.value}px`;
  return `${spacing.top}px ${spacing.right}px ${spacing.bottom}px ${spacing.left}px`;
}

export function borderToCss(value: BorderValue | undefined): string | undefined {
  const border = normalizeBorder(value);
  if (border.mode === 'none') return undefined;
  if (border.mode === 'uniform') {
    return sideToCss({ width: border.width, style: border.style, color: border.color });
  }
  return undefined;
}

export function borderSidesToCss(value: BorderValue | undefined): CSSProperties {
  const border = normalizeBorder(value);
  if (border.mode === 'none') return {};
  if (border.mode === 'uniform') {
    const css = sideToCss({ width: border.width, style: border.style, color: border.color });
    return { border: css };
  }
  return {
    borderTop: sideToCss(border.top),
    borderRight: sideToCss(border.right),
    borderBottom: sideToCss(border.bottom),
    borderLeft: sideToCss(border.left),
  };
}

function spacingToParts(value: SpacingValue): { t: number; r: number; b: number; l: number } {
  const spacing = normalizeSpacing(value);
  if (spacing.mode === 'uniform') {
    return { t: spacing.value, r: spacing.value, b: spacing.value, l: spacing.value };
  }
  return { t: spacing.top, r: spacing.right, b: spacing.bottom, l: spacing.left };
}

function serializeSpacingParts(parts: { t: number; r: number; b: number; l: number }): string {
  return `${parts.t}px ${parts.r}px ${parts.b}px ${parts.l}px`;
}

export function buildResponsiveSpacingVars(
  name: string,
  value: SpacingValue | ResponsiveProp<SpacingValue> | undefined,
  fallback: SpacingValue = DEFAULT_SPACING,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const base = spacingToParts(responsive.base);
  const tablet = spacingToParts(responsive.tablet ?? responsive.base);
  const desktop = spacingToParts(responsive.desktop ?? responsive.tablet ?? responsive.base);
  return {
    [`--pb-${name}`]: serializeSpacingParts(base),
    [`--pb-${name}-md`]: serializeSpacingParts(tablet),
    [`--pb-${name}-lg`]: serializeSpacingParts(desktop),
  } as CSSProperties;
}

function borderUniformToParts(value: BorderValue): string {
  const border = normalizeBorder(value);
  if (border.mode === 'none') return '0';
  if (border.mode === 'uniform') {
    return sideToCss({ width: border.width, style: border.style, color: border.color });
  }
  return '0';
}

export function buildResponsiveBorderVars(
  value: BorderValue | ResponsiveProp<BorderValue> | undefined,
  fallback: BorderValue = DEFAULT_BORDER,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const base = borderUniformToParts(responsive.base);
  const tablet = borderUniformToParts(responsive.tablet ?? responsive.base);
  const desktop = borderUniformToParts(responsive.desktop ?? responsive.tablet ?? responsive.base);
  return {
    '--pb-border': base,
    '--pb-border-md': tablet,
    '--pb-border-lg': desktop,
  } as CSSProperties;
}

export function resolveSpacing(
  value: SpacingValue | ResponsiveProp<SpacingValue> | undefined,
  tier: BreakpointTier,
  fallback: SpacingValue = DEFAULT_SPACING,
): SpacingValue {
  return resolveResponsive(value, tier, fallback);
}

export function resolveBorder(
  value: BorderValue | ResponsiveProp<BorderValue> | undefined,
  tier: BreakpointTier,
  fallback: BorderValue = DEFAULT_BORDER,
): BorderValue {
  return resolveResponsive(value, tier, fallback);
}

export function spacingStyleForTier(
  value: SpacingValue | ResponsiveProp<SpacingValue> | undefined,
  tier: BreakpointTier,
  property: 'margin' | 'padding',
  fallback: SpacingValue = DEFAULT_SPACING,
): CSSProperties {
  return { [property]: spacingToCss(resolveSpacing(value, tier, fallback)) };
}

export function borderStyleForTier(
  value: BorderValue | ResponsiveProp<BorderValue> | undefined,
  tier: BreakpointTier,
  fallback: BorderValue = DEFAULT_BORDER,
): CSSProperties {
  return borderSidesToCss(resolveBorder(value, tier, fallback));
}

export function gridTemplateColumnsFromCount(count: number): string {
  const n = Math.min(12, Math.max(1, Math.round(count)));
  return `repeat(${n}, minmax(0, 1fr))`;
}

export function buildResponsiveColumnCountVars(
  value: number | ResponsiveProp<number> | undefined,
  fallback = 2,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const base = Math.min(12, Math.max(1, Math.round(responsive.base)));
  const tablet = Math.min(12, Math.max(1, Math.round(responsive.tablet ?? responsive.base)));
  const desktop = Math.min(12, Math.max(1, Math.round(responsive.desktop ?? responsive.tablet ?? responsive.base)));
  return {
    '--pb-cols': String(base),
    '--pb-cols-md': String(tablet),
    '--pb-cols-lg': String(desktop),
  } as CSSProperties;
}

export function resolveColumnCount(
  value: number | ResponsiveProp<number> | undefined,
  tier: BreakpointTier,
  fallback = 2,
): number {
  const n = resolveResponsive(value, tier, fallback);
  return Math.min(12, Math.max(1, Math.round(n)));
}

export type ContentWidth = 'full' | 'narrow' | 'wide';
export type RowContentMaxWidth = 'none' | 'narrow' | 'wide' | 'custom';
export type RowSectionLayout = 'in_flow' | 'full_width' | 'full_bleed';
export type ContentPosition = 'top' | 'middle' | 'bottom';
export type CornerRadius = 'none' | 'small' | 'medium' | 'large';
export type Shadow = 'none' | 'soft' | 'medium';
export type VerticalAlign = 'top' | 'middle' | 'bottom' | 'stretch';

export const CONTENT_WIDTH_MAX: Record<ContentWidth, string | undefined> = {
  full: undefined,
  narrow: '720px',
  wide: '960px',
};

export const ROW_CONTENT_MAX_WIDTH: Record<'narrow' | 'wide', string> = {
  narrow: '720px',
  wide: '960px',
};

export function clampColumnSpan(value: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 12;
  return Math.min(12, Math.max(1, Math.round(n)));
}

export function resolveColumnSpan(
  value: number | ResponsiveProp<number> | undefined,
  tier: BreakpointTier,
  fallback = 12,
): number {
  return clampColumnSpan(resolveResponsive(value, tier, fallback));
}

export function buildResponsiveSpanVars(
  value: number | ResponsiveProp<number> | undefined,
  fallback = 12,
): CSSProperties {
  const responsive = normalizeResponsive(value, fallback);
  const base = clampColumnSpan(responsive.base);
  const tablet = clampColumnSpan(responsive.tablet ?? responsive.base);
  const desktop = clampColumnSpan(responsive.desktop ?? responsive.tablet ?? responsive.base);
  return {
    '--pb-col-span': String(base),
    '--pb-col-span-md': String(tablet),
    '--pb-col-span-lg': String(desktop),
  } as CSSProperties;
}

export const CORNER_RADIUS_PX: Record<CornerRadius, number> = {
  none: 0,
  small: 4,
  medium: 8,
  large: 16,
};

export const SHADOW_CSS: Record<Shadow, string> = {
  none: 'none',
  soft: '0 1px 3px rgba(21, 32, 43, 0.12)',
  medium: '0 4px 12px rgba(21, 32, 43, 0.16)',
};

export function resolveContentPosition(position: ContentPosition | ResponsiveProp<ContentPosition> | undefined, tier: BreakpointTier): ContentPosition {
  return resolveResponsive(position, tier, 'top');
}

export function contentPositionToJustify(position: ContentPosition): string {
  if (position === 'middle') return 'center';
  if (position === 'bottom') return 'flex-end';
  return 'flex-start';
}

export function resolveVerticalAlign(
  value: VerticalAlign | ResponsiveProp<VerticalAlign> | undefined,
  tier: BreakpointTier,
): VerticalAlign {
  return resolveResponsive(value, tier, 'stretch');
}

export function verticalAlignToCss(value: VerticalAlign): string {
  if (value === 'top') return 'flex-start';
  if (value === 'middle') return 'center';
  if (value === 'bottom') return 'flex-end';
  return 'stretch';
}
