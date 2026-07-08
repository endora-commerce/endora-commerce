'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  CORNER_RADIUS_PX,
  SHADOW_CSS,
  borderStyleForTier,
  buildResponsiveBorderVars,
  buildResponsiveSpacingVars,
  spacingStyleForTier,
  type BorderValue,
  type BreakpointTier,
  type CornerRadius,
  type ResponsiveProp,
  type Shadow,
  type SpacingValue,
} from '@b2b/page-builder-core';

export interface BoxStyledProps {
  margin?: SpacingValue | ResponsiveProp<SpacingValue>;
  padding?: SpacingValue | ResponsiveProp<SpacingValue>;
  border?: BorderValue | ResponsiveProp<BorderValue>;
  background?: string;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  previewTier?: BreakpointTier;
}

function appearanceStyle(props: {
  background?: string;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
}): CSSProperties {
  const style: CSSProperties = {};
  if (props.background && props.background !== 'transparent') {
    style.background = props.background;
  }
  if (props.cornerRadius) {
    style.borderRadius = `${CORNER_RADIUS_PX[props.cornerRadius]}px`;
  }
  if (props.shadow) {
    style.boxShadow = SHADOW_CSS[props.shadow];
  }
  return style;
}

function publishedBoxStyle(props: Omit<BoxStyledProps, 'children' | 'className' | 'previewTier'>): CSSProperties {
  return {
    ...appearanceStyle(props),
    ...buildResponsiveSpacingVars('margin', props.margin),
    ...buildResponsiveSpacingVars('padding', props.padding),
    ...buildResponsiveBorderVars(props.border),
    ...props.style,
  };
}

function editingBoxStyle(
  props: Omit<BoxStyledProps, 'children' | 'className' | 'previewTier'>,
  tier: BreakpointTier,
): CSSProperties {
  return {
    ...appearanceStyle(props),
    ...spacingStyleForTier(props.margin, tier, 'margin'),
    ...spacingStyleForTier(props.padding, tier, 'padding'),
    ...borderStyleForTier(props.border, tier),
    ...props.style,
  };
}

export function BoxStyled({
  children,
  className,
  style,
  previewTier,
  margin,
  padding,
  border,
  background,
  cornerRadius,
  shadow,
}: BoxStyledProps): React.ReactElement {
  const boxClasses = [
    className,
    previewTier === undefined ? 'cmsc-pb-margin cmsc-pb-padding cmsc-pb-border' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const boxProps = {
    ...(margin !== undefined ? { margin } : {}),
    ...(padding !== undefined ? { padding } : {}),
    ...(border !== undefined ? { border } : {}),
    ...(background !== undefined ? { background } : {}),
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
    ...(style !== undefined ? { style } : {}),
  };

  const computedStyle =
    previewTier !== undefined
      ? editingBoxStyle(boxProps, previewTier)
      : publishedBoxStyle(boxProps);

  return (
    <div className={boxClasses || undefined} style={computedStyle}>
      {children}
    </div>
  );
}

export type { SpacingValue, BorderValue, ResponsiveProp };
