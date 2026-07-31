import { describe, expect, it } from 'vitest';
import { productCardLayoutStyle } from './CmsProductCard.js';

describe('productCardLayoutStyle', () => {
  it('applies max width and image height when set', () => {
    const layout = productCardLayoutStyle(
      { maxWidthPx: 320, imageHeightPx: 200, imageObjectFit: 'cover' },
      'desktop',
    );
    expect(layout.card.maxWidth).toBe('320px');
    expect(layout.media.height).toBe('200px');
    expect(layout.img.objectFit).toBe('cover');
  });

  it('skips max width when 0', () => {
    const layout = productCardLayoutStyle({ maxWidthPx: 0 }, 'mobile');
    expect(layout.card.maxWidth).toBeUndefined();
  });
});
