'use client';

import { useSyncExternalStore } from 'react';
import { tierFromViewportWidth, type BreakpointTier } from '../types/responsive.js';

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getSnapshot(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1024;
}

function getServerSnapshot(): number {
  // Prefer desktop SSR so published CSS media queries (not JS tier) drive layout after hydrate.
  return 1024;
}

/**
 * Breakpoint tier for responsive editor preview and published renders.
 *
 * Uses `window.innerWidth` so it is safe outside `<Puck>` (storefront `Render`).
 * Inside Puck's preview iframe, the iframe width matches the selected Mobile / Tablet / Desktop viewport.
 */
export function usePreviewBreakpointTier(): BreakpointTier {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tierFromViewportWidth(width);
}
