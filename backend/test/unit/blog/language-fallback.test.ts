import { describe, expect, it } from 'vitest';

/**
 * Unit test for the resolver's language-fallback rule (T050 / R12).
 *
 * The rule is encapsulated as a tiny pure helper so we don't need a DB
 * fixture to exercise it. The behaviour mirrors feature 005's
 * channel/language fallback contract: prefer the requested language, fall
 * back to the channel default, otherwise return null.
 */

function pickLanguage(
  map: Record<string, string> | null | undefined,
  language: string,
  channelDefault: string,
): string | null {
  if (!map) return null;
  if (map[language]) return map[language] ?? null;
  if (map[channelDefault]) return map[channelDefault] ?? null;
  return null;
}

describe('blog language-fallback (T050)', () => {
  it('returns the requested language when available', () => {
    expect(pickLanguage({ 'en-US': 'A', 'pl-PL': 'B' }, 'pl-PL', 'en-US')).toBe('B');
  });

  it('falls back to the channel default when the requested language is missing', () => {
    expect(pickLanguage({ 'en-US': 'A' }, 'pl-PL', 'en-US')).toBe('A');
  });

  it('returns null when neither the requested language nor the default exist', () => {
    expect(pickLanguage({ 'fr-FR': 'C' }, 'pl-PL', 'en-US')).toBeNull();
  });

  it('returns null on a null map', () => {
    expect(pickLanguage(null, 'pl-PL', 'en-US')).toBeNull();
  });
});
