import { describe, expect, it } from 'vitest';
import { acceptLanguageTags } from '../../lib/i18n/locale-path';

/**
 * Issue #1011 — the middleware's unprefixed-URL redirect (feature 167, url-shape §3) reads
 * `Accept-Language` through the shared parse in `@endora-commerce/contracts` rather than a
 * private one, so it carries the same bounds and the same reading of `q`. What stays the
 * storefront's own: a tag at `q=0` (RFC 9110 "not acceptable") and `*` are never a redirect
 * target.
 */
describe('acceptLanguageTags', () => {
  it('orders by descending q, keeping the written order among equals', () => {
    expect(acceptLanguageTags('en;q=0.2, pl;q=0.9')).toEqual(['pl', 'en']);
    expect(acceptLanguageTags('de, en-GB;q=0.8, fr')).toEqual(['de', 'fr', 'en-GB']);
  });

  it('excludes a tag at q=0 (and below), however q is spelled', () => {
    expect(acceptLanguageTags('pl;q=0, en')).toEqual(['en']);
    expect(acceptLanguageTags('pl;q=0.000, en;q=-1')).toEqual([]);
  });

  it('excludes *', () => {
    expect(acceptLanguageTags('*, pl;q=0.5')).toEqual(['pl']);
    expect(acceptLanguageTags('*')).toEqual([]);
  });

  it('drops a tag with a malformed q instead of reading it as q=1', () => {
    expect(acceptLanguageTags('de;q=abc, pl;q=0.5')).toEqual(['pl']);
    expect(acceptLanguageTags('de;q=, pl;q=0.5')).toEqual(['pl']);
  });

  it('reads q case-insensitively and with spaces around =', () => {
    expect(acceptLanguageTags('en;Q=0.1, pl;q = 0.5')).toEqual(['pl', 'en']);
  });

  it('reads no further than 512 characters of the header', () => {
    expect(acceptLanguageTags(`en;q=0.1,${'x'.repeat(520)},pl`)).not.toContain('pl');
  });

  it('keeps the ten heaviest tags, capped after weighting', () => {
    const filler = Array.from({ length: 15 }, (_unused, i) => `t${i};q=0.1`).join(',');
    const tags = acceptLanguageTags(`${filler},pl;q=0.9`);
    expect(tags).toHaveLength(10);
    expect(tags[0]).toBe('pl');
  });

  it('answers an absent or empty header with no tags', () => {
    expect(acceptLanguageTags(null)).toEqual([]);
    expect(acceptLanguageTags(undefined)).toEqual([]);
    expect(acceptLanguageTags('')).toEqual([]);
  });
});
