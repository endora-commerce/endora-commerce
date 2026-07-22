'use client';

/**
 * Publishes Puck's selected preview viewport width for editing-tier resolution.
 * Components on the storefront leave this unset and fall back to `window.innerWidth`.
 */

let previewViewportWidth: number | null = null;
const listeners = new Set<() => void>();

export function setPreviewViewportWidth(width: number | null): void {
  if (previewViewportWidth === width) return;
  previewViewportWidth = width;
  for (const listener of listeners) listener();
}

export function getPreviewViewportWidth(): number | null {
  return previewViewportWidth;
}

export function subscribePreviewViewportWidth(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return (): void => {
    listeners.delete(onStoreChange);
  };
}
