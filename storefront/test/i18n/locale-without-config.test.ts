import { describe, expect, it } from 'vitest';
import { resolveLocaleWithoutConfig } from '../../lib/i18n/locale';

/**
 * Issue #1011 — the outage notice reads `Accept-Language` through the shared parser
 * (`parseAcceptLanguage` from `@endora-commerce/contracts`), not a private one: the same
 * q-ordering, the same bounds on an attacker-controlled header, the same handling of a
 * malformed weight. The matching against the catalogue's locales (exact, then
 * language-only) stays this function's own.
 */
describe('resolveLocaleWithoutConfig reads Accept-Language through the shared parser (#1011)', () => {
  const pick = (acceptLanguage: string): string =>
    resolveLocaleWithoutConfig({ acceptLanguage, available: ['en-US', 'pl-PL'], fallback: 'en-US' });

  it('orders the tags by q and matches language-only tags', () => {
    expect(pick('en;q=0.2, pl;q=0.9')).toBe('pl-PL');
    expect(pick('de-DE, pl;q=0.5')).toBe('pl-PL');
  });

  it('drops a tag whose q is malformed rather than reading it as q=1', () => {
    expect(pick('pl;q=, en;q=0.5')).toBe('en-US');
    expect(pick('pl;q=abc, en;q=0.5')).toBe('en-US');
  });

  it('reads the q parameter case-insensitively and with spaces around it', () => {
    expect(pick('pl;Q=0.1, en;q=0.5')).toBe('en-US');
    expect(pick('pl; q = 0.1, en;q=0.5')).toBe('en-US');
  });

  it('considers at most ten tags', () => {
    expect(pick('de,fr,es,it,nl,cs,sk,hu,ro,bg,pl')).toBe('en-US');
    expect(pick('de,fr,es,it,nl,cs,sk,hu,ro,pl')).toBe('pl-PL');
  });
});
