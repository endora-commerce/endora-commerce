'use client';

import { useSyncExternalStore } from 'react';
import { tierFromViewportWidth, type BreakpointTier } from '../types/responsive.js';
import {
  getPreviewViewportWidth,
  subscribePreviewViewportWidth,
} from './preview-viewport-store.js';

function subscribeWindow(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getWindowWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1024;
}

function getServerSnapshot(): number {
  // Prefer desktop SSR so published CSS media queries (not JS tier) drive layout after hydrate.
  return 1024;
}

function subscribe(onStoreChange: () => void): () => void {
  const unsubStore = subscribePreviewViewportWidth(onStoreChange);
  const unsubWindow = subscribeWindow(onStoreChange);
  return (): void => {
    unsubStore();
    unsubWindow();
  };
}

function getSnapshot(): number {
  return getPreviewViewportWidth() ?? getWindowWidth();
}

/**
 * Breakpoint tier for responsive editor preview and published renders.
 *
 * Prefer Puck's selected Mobile / Tablet / Desktop frame width when a
 * `PreviewViewportBridge` is mounted; otherwise use `window.innerWidth`
 * (storefront `Render`, SSR).
 */
export function usePreviewBreakpointTier(): BreakpointTier {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return tierFromViewportWidth(width);
}
