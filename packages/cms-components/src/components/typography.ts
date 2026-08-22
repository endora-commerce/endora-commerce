import type { CSSProperties } from 'react';
import {
  buildResponsiveCSSValueVars,
  buildResponsiveNumberVars,
  resolveResponsiveNumber,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import type { HeadingLevel, TextFontFamily, TextFontStyle, TypographyProps } from '../schema/component-types.js';

export const FONT_FAMILY_CSS: Record<TextFontFamily, string> = {
  sans: 'Inter, system-ui, -apple-system, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const FONT_WEIGHT_OPTIONS = [
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'Semibold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'Extra bold (800)', value: 800 },
];

export const HEADING_DEFAULT_SIZE_PX: Record<HeadingLevel, number> = {
  h1: 48,
  h2: 40,
  h3: 32,
  h4: 26,
  h5: 22,
  h6: 18,
};

export function typographyStyle(props: {
  fontFamily?: TextFontFamily;
  fontStyle?: TextFontStyle;
  color?: string | undefined;
}): CSSProperties {
  return {
    fontFamily: FONT_FAMILY_CSS[props.fontFamily ?? 'sans'],
    fontStyle: props.fontStyle === 'italic' ? 'italic' : 'normal',
    ...(props.color && props.color !== 'transparent' ? { color: props.color } : {}),
  };
}

export function responsiveTypographyVars(
  props: Pick<TypographyProps, 'fontSize' | 'fontWeight' | 'lineHeight'>,
  defaults: { fontSize: number; fontWeight: number; lineHeight: number },
): CSSProperties {
  return {
    ...buildResponsiveNumberVars('text-size', props.fontSize, defaults.fontSize),
    ...buildResponsiveCSSValueVars('text-weight', props.fontWeight, defaults.fontWeight),
    ...buildResponsiveCSSValueVars('text-leading', props.lineHeight, defaults.lineHeight),
  };
}

export function editingTypographyStyle(
  props: TypographyProps,
  tier: BreakpointTier,
  defaults: { fontSize: number; fontWeight: number; lineHeight: number },
): CSSProperties {
  return {
    ...typographyStyle({
      ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
      ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
      color: props.color,
    }),
    fontSize: `${resolveResponsiveNumber(props.fontSize, tier, defaults.fontSize)}px`,
    fontWeight: resolveResponsiveNumber(props.fontWeight, tier, defaults.fontWeight),
    lineHeight: resolveResponsiveNumber(props.lineHeight, tier, defaults.lineHeight),
  };
}

export function hasCustomFontSize(fontSize: TypographyProps['fontSize']): boolean {
  return fontSize !== undefined && fontSize !== null;
}
