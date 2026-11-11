import { describe, expect, it } from 'vitest';
import { firstLanguageTag, requestScopeLanguage, scopeLanguageOf, toScopeChannel } from './product-scopes.js';

/**
 * Feature 163 (code review N1/N2) — the one home of the channel-language
 * normalisation and of the `Accept-Language` pick every buyer seam reads.
 */
describe('toScopeChannel', () => {
  it('always offers the channel default, first when the list omits it', () => {
    expect(toScopeChannel({ id: 'c', languages: ['en-US'], defaultLanguage: 'pl-PL' })).toEqual({
      id: 'c',
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
    });
    expect(toScopeChannel({ id: 'c', defaultLanguage: 'pl-PL' }).languages).toEqual(['pl-PL']);
  });
});

describe('scopeLanguageOf', () => {
  const channel = { id: 'c', languages: ['de-DE'], defaultLanguage: 'pl-PL' };
  it('resolves a tag against the channel languages, the default included', () => {
    expect(scopeLanguageOf(channel, 'de')).toBe('de-DE');
    expect(scopeLanguageOf(channel, 'pl')).toBe('pl-PL');
    expect(scopeLanguageOf(channel, 'fr-FR')).toBe('pl-PL');
    expect(scopeLanguageOf(channel, undefined)).toBe('pl-PL');
  });
});

describe('firstLanguageTag', () => {
  it.each([
    ['de-DE,en;q=0.8', 'de-DE'],
    ['de;q=0.9, en', 'de'],
    ['  pl-PL  ', 'pl-PL'],
    ['', undefined],
    [undefined, undefined],
    [['en-US', 'pl'], 'en-US'],
  ] as const)('%j -> %j', (header, expected) => {
    expect(firstLanguageTag(header)).toBe(expected);
  });
});

/**
 * Issue #397 — the scope language of a request from its whole `Accept-Language`
 * header: q-weighted, each tag matched against the channel (exact, then the base
 * language), the first match winning, else the channel's default.
 */
describe('requestScopeLanguage', () => {
  const channel = { id: 'c', languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' };
  it.each([
    // The heaviest tag wins, not the first one written.
    ['en;q=0.1, pl-PL;q=0.9', 'pl-PL'],
    // A language-only tag reaches the channel's regional language directly.
    ['pl', 'pl-PL'],
    ['PL-pl', 'pl-PL'],
    // A language the channel does not offer is skipped, then the next served tag wins…
    ['de-DE, pl;q=0.5', 'pl-PL'],
    // …and with none served the channel default answers.
    ['de-DE', 'en-US'],
    ['de-DE, fr;q=0.8', 'en-US'],
    ['*', 'en-US'],
    ['', 'en-US'],
    [undefined, 'en-US'],
    // A malformed weight drops its tag.
    ['pl;q=abc, en-US;q=0.2', 'en-US'],
    [['pl', 'en-US'], 'pl-PL'],
  ] as const)('%j -> %j', (header, expected) => {
    expect(requestScopeLanguage(channel, header)).toBe(expected);
  });

  it('offers the channel default even when the language list omits it', () => {
    expect(requestScopeLanguage({ id: 'c', languages: ['de-DE'], defaultLanguage: 'pl-PL' }, 'fr, pl;q=0.3')).toBe(
      'pl-PL',
    );
    expect(requestScopeLanguage({ id: 'c', defaultLanguage: 'pl-PL' }, 'de')).toBe('pl-PL');
  });
});
