import { describe, expect, it } from 'vitest';
import { tierFromViewportWidth } from '../types/responsive.js';
import {
  getPreviewViewportWidth,
  setPreviewViewportWidth,
  subscribePreviewViewportWidth,
} from './preview-viewport-store.js';

describe('preview-viewport-store', () => {
  it('notifies subscribers when the Puck frame width changes', () => {
    setPreviewViewportWidth(null);
    const seen: Array<number | null> = [];
    const unsub = subscribePreviewViewportWidth(() => {
      seen.push(getPreviewViewportWidth());
    });
    setPreviewViewportWidth(360);
    setPreviewViewportWidth(768);
    setPreviewViewportWidth(768); // no-op
    unsub();
    expect(seen).toEqual([360, 768]);
  });

  it('maps Puck mobile / tablet / desktop widths to the expected tiers', () => {
    expect(tierFromViewportWidth(360)).toBe('mobile');
    expect(tierFromViewportWidth(768)).toBe('tablet');
    expect(tierFromViewportWidth(1280)).toBe('desktop');
  });
});
