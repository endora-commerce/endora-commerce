import { resolveResponsive, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import type { ImageWidthMode } from '../schema/component-types.js';

export function imageUsesCustomWidth(
  widthMode: ImageWidthMode | ResponsiveProp<ImageWidthMode> | undefined,
): boolean {
  return (
    resolveResponsive(widthMode, 'mobile', 'auto') === 'custom' ||
    resolveResponsive(widthMode, 'tablet', 'auto') === 'custom' ||
    resolveResponsive(widthMode, 'desktop', 'auto') === 'custom'
  );
}

/** Show Custom width (px) when any breakpoint uses custom mode (same pattern as Row customMaxWidthPx). */
export function shouldShowImageCustomWidthField(
  widthMode: ImageWidthMode | ResponsiveProp<ImageWidthMode> | undefined,
): boolean {
  return imageUsesCustomWidth(widthMode);
}
