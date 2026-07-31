import { describe, expect, it } from 'vitest';
import { resolveResponsiveNumber } from '../render/responsive-styles.js';

describe('resolveResponsiveNumber', () => {
  const value = { base: 24, tablet: 40, desktop: 56 };

  it('resolves base value on mobile tier', () => {
    expect(resolveResponsiveNumber(value, 'mobile', 0)).toBe(24);
  });

  it('resolves tablet value on tablet tier', () => {
    expect(resolveResponsiveNumber(value, 'tablet', 0)).toBe(40);
  });

  it('resolves desktop value on desktop tier', () => {
    expect(resolveResponsiveNumber(value, 'desktop', 0)).toBe(56);
  });

  it('inherits base on tablet when tablet override is missing', () => {
    expect(resolveResponsiveNumber({ base: 24 }, 'tablet', 0)).toBe(24);
  });
});
