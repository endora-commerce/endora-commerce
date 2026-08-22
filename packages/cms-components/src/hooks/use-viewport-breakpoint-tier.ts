'use client';

import { useSyncExternalStore } from 'react';
import { tierFromViewportWidth, type BreakpointTier } from '@endora-commerce/page-builder-core';

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getSnapshot(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 360;
}

function getServerSnapshot(): number {
  return 360;
}

/** Breakpoint tier from the browser viewport — safe outside Puck `<Puck>` (storefront Render). */
export function useViewportBreakpointTier(): BreakpointTier {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tierFromViewportWidth(width);
}
