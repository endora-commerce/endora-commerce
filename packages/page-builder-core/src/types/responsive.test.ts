import { describe, expect, it } from 'vitest';
import {
  hideOnDataAttrs,
  isHiddenOnTier,
  normalizeResponsive,
  resolveResponsive,
  tierFromViewportWidth,
} from './responsive.js';

describe('resolveResponsive', () => {
  it('returns base for mobile', () => {
    expect(resolveResponsive({ base: 'a', tablet: 'b', desktop: 'c' }, 'mobile', 'x')).toBe('a');
  });

  it('inherits tablet from base', () => {
    expect(resolveResponsive({ base: 'a', desktop: 'c' }, 'tablet', 'x')).toBe('a');
  });

  it('inherits desktop from tablet then base', () => {
    expect(resolveResponsive({ base: 'a', tablet: 'b' }, 'desktop', 'x')).toBe('b');
    expect(resolveResponsive({ base: 'a' }, 'desktop', 'x')).toBe('a');
  });

  it('coerces plain values', () => {
    expect(resolveResponsive('plain', 'desktop', 'x')).toBe('plain');
    expect(normalizeResponsive(undefined, 'fb').base).toBe('fb');
  });
});

describe('tierFromViewportWidth', () => {
  it('maps widths to tiers', () => {
    expect(tierFromViewportWidth(360)).toBe('mobile');
    expect(tierFromViewportWidth(768)).toBe('tablet');
    expect(tierFromViewportWidth(1024)).toBe('desktop');
  });
});

describe('hideOn', () => {
  it('maps hide flags per tier', () => {
    expect(isHiddenOnTier({ mobile: true }, 'mobile')).toBe(true);
    expect(isHiddenOnTier({ mobile: true }, 'tablet')).toBe(false);
    expect(hideOnDataAttrs({ tablet: true })).toEqual({
      'data-hide-mobile': '0',
      'data-hide-tablet': '1',
      'data-hide-desktop': '0',
    });
  });
});
