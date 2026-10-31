import { describe, expect, it } from 'vitest';

import { LANGUAGE_FALLBACK, supportedLanguageOf } from './platform-language.js';

describe('supportedLanguageOf', () => {
  it('reads the primary subtag of a BCP-47 tag', () => {
    expect(supportedLanguageOf('pl-PL')).toBe('pl');
    expect(supportedLanguageOf('PL')).toBe('pl');
    expect(supportedLanguageOf('en-US')).toBe('en');
    expect(supportedLanguageOf('en_GB')).toBe('en');
  });

  it('answers the platform fallback for a language no bundle is shipped for', () => {
    expect(supportedLanguageOf('de-DE')).toBe(LANGUAGE_FALLBACK);
    expect(supportedLanguageOf('')).toBe(LANGUAGE_FALLBACK);
    expect(supportedLanguageOf(null)).toBe(LANGUAGE_FALLBACK);
    expect(supportedLanguageOf(undefined)).toBe(LANGUAGE_FALLBACK);
  });
});
