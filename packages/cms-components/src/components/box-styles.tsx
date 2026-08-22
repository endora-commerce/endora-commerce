'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  CORNER_RADIUS_PX,
  SHADOW_CSS,
  backgroundToStyle,
  borderStyleForTier,
  buildResponsiveBorderVars,
  buildResponsiveSpacingVars,
  spacingStyleForTier,
  type BackgroundProp,
  type BorderValue,
  type BreakpointTier,
  type CornerRadius,
  type ResponsiveProp,
  type Shadow,
  type SpacingValue,
} from '@endora-commerce/page-builder-core';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';

export interface BoxStyledProps {
  margin?: SpacingValue | ResponsiveProp<SpacingValue>;
  padding?: SpacingValue | ResponsiveProp<SpacingValue>;
  border?: BorderValue | ResponsiveProp<BorderValue>;
  background?: BackgroundProp;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  previewTier?: BreakpointTier;
  /** Row section layout — used for nested layout CSS (`data-row-section`). */
  rowSection?: string;
}

function appearanceStyle(
  props: {
    background?: BackgroundProp;
    cornerRadius?: CornerRadius;
    shadow?: Shadow;
  },
  assets: Record<string, { url: string }>,
  mediaBaseUrl?: string,
): { style: CSSProperties; videoUrl?: string } {
  const { style, videoUrl } = backgroundToStyle(props.background, assets, mediaBaseUrl);
  const next: CSSProperties = { ...style };
  if (props.cornerRadius) {
    next.borderRadius = `${CORNER_RADIUS_PX[props.cornerRadius]}px`;
  }
  if (props.shadow) {
    next.boxShadow = SHADOW_CSS[props.shadow];
  }
  return { style: next, ...(videoUrl ? { videoUrl } : {}) };
}

function publishedBoxStyle(
  props: Omit<BoxStyledProps, 'children' | 'className' | 'previewTier'>,
  assets: Record<string, { url: string }>,
  mediaBaseUrl?: string,
): { style: CSSProperties; videoUrl?: string } {
  const { style, videoUrl } = appearanceStyle(props, assets, mediaBaseUrl);
  return {
    style: {
      ...style,
      ...buildResponsiveSpacingVars('margin', props.margin),
      ...buildResponsiveSpacingVars('padding', props.padding),
      ...buildResponsiveBorderVars(props.border),
      ...props.style,
    },
    ...(videoUrl ? { videoUrl } : {}),
  };
}

function editingBoxStyle(
  props: Omit<BoxStyledProps, 'children' | 'className' | 'previewTier'>,
  tier: BreakpointTier,
  assets: Record<string, { url: string }>,
  mediaBaseUrl?: string,
): { style: CSSProperties; videoUrl?: string } {
  const { style, videoUrl } = appearanceStyle(props, assets, mediaBaseUrl);
  return {
    style: {
      ...style,
      ...spacingStyleForTier(props.margin, tier, 'margin'),
      ...spacingStyleForTier(props.padding, tier, 'padding'),
      ...borderStyleForTier(props.border, tier),
      ...props.style,
    },
    ...(videoUrl ? { videoUrl } : {}),
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
  rowSection,
}: BoxStyledProps): React.ReactElement {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
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

  const computed =
    previewTier !== undefined
      ? editingBoxStyle(boxProps, previewTier, assets, mediaBaseUrl)
      : publishedBoxStyle(boxProps, assets, mediaBaseUrl);

  return (
    <div
      className={boxClasses || undefined}
      style={computed.style}
      {...(rowSection ? { 'data-row-section': rowSection } : {})}
    >
      {computed.videoUrl ? (
        <video
          className="cmsc-pb-bg-video"
          src={absolutizeMediaUrl(computed.videoUrl, mediaBaseUrl)}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
        />
      ) : null}
      <div className="cmsc-pb-bg-content">{children}</div>
    </div>
  );
}

export type { SpacingValue, BorderValue, ResponsiveProp };
