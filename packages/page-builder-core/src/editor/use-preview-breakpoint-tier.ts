'use client';

import { tierFromViewportWidth, type BreakpointTier } from '../types/responsive.js';
import { usePageBuilderPuck } from './use-page-builder-puck.js';

/** Subscribes to Puck preview viewport width — re-renders when Mobile / Tablet / Desktop changes. */
export function usePreviewBreakpointTier(): BreakpointTier {
  const width = usePageBuilderPuck((s) => s.appState?.ui?.viewports?.current?.width);
  if (typeof width !== 'number') return 'desktop';
  return tierFromViewportWidth(width);
}
