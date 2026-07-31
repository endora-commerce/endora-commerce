'use client';

import { useLayoutEffect, type ReactElement, type ReactNode } from 'react';
import { usePageBuilderPuck } from './use-page-builder-puck.js';
import { setPreviewViewportWidth } from './preview-viewport-store.js';

/**
 * Syncs Puck's Mobile / Tablet / Desktop frame width into the preview viewport store
 * so `usePreviewBreakpointTier` matches the selected canvas, not the admin window.
 */
export function PreviewViewportBridge({ children }: { children: ReactNode }): ReactElement {
  const viewportWidth = usePageBuilderPuck((s) => s.appState.ui.viewports.current.width);

  useLayoutEffect(() => {
    const width = typeof viewportWidth === 'number' && Number.isFinite(viewportWidth) ? viewportWidth : null;
    setPreviewViewportWidth(width);
    return (): void => setPreviewViewportWidth(null);
  }, [viewportWidth]);

  return <>{children}</>;
}
