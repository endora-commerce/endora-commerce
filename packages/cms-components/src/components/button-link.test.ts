import { describe, expect, it } from 'vitest';
import { resolveButtonHref } from './button-link.js';

describe('resolveButtonHref', () => {
  it('resolves product slug', () => {
    expect(resolveButtonHref({ linkType: 'product', linkSlug: 'widget-a' })).toBe('/p/widget-a');
  });

  it('resolves category slug', () => {
    expect(resolveButtonHref({ linkType: 'category', linkSlug: 'parts' })).toBe('/c/parts');
  });

  it('resolves cms page slug', () => {
    expect(resolveButtonHref({ linkType: 'page', linkSlug: 'about-us' })).toBe('/about-us');
  });

  it('uses static href for url type', () => {
    expect(resolveButtonHref({ linkType: 'url', href: '/catalog' })).toBe('/catalog');
  });

  it('falls back to hash when target missing', () => {
    expect(resolveButtonHref({ linkType: 'product', linkSlug: '' })).toBe('#');
  });
});
