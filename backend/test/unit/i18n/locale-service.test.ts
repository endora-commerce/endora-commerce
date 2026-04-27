import { describe, expect, it, vi } from 'vitest';
import { LocaleService } from '../../../src/modules/languages/services/locale-service.js';
import type { LanguageService } from '../../../src/modules/languages/services/language-service.js';

/**
 * Unit tests for the translation-fallback helper (FR-105). Locale chain:
 *   requested → admin-configured default → first present → empty string.
 */

function fakeLanguageService(defaultCode: string | null): LanguageService {
  return {
    getDefault: vi.fn(async () => (defaultCode ? ({ code: defaultCode } as unknown) : null)),
  } as unknown as LanguageService;
}

describe('LocaleService.pickLocalizedValue', () => {
  it('returns the requested locale when present', () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    expect(
      svc.pickLocalizedValue({ 'en-US': 'English', 'pl-PL': 'Polski' }, 'pl-PL'),
    ).toBe('Polski');
  });

  it('falls back to the default locale when the requested one is missing', () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    expect(
      svc.pickLocalizedValue({ 'en-US': 'English' }, 'de-DE', 'en-US'),
    ).toBe('English');
  });

  it('falls back to the first present value when neither requested nor default exists', () => {
    const svc = new LocaleService(fakeLanguageService(null));
    expect(svc.pickLocalizedValue({ 'fr-FR': 'Français' }, 'de-DE', 'en-US')).toBe('Français');
  });

  it('returns empty string for null/undefined records', () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    expect(svc.pickLocalizedValue(null, 'en-US')).toBe('');
    expect(svc.pickLocalizedValue(undefined, 'en-US')).toBe('');
  });
});

describe('LocaleService.resolveRequestLocale', () => {
  const active = ['en-US', 'pl-PL', 'de-DE'];

  it('returns the highest-q tag that exactly matches an active locale', async () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    const result = await svc.resolveRequestLocale('pl-PL,en-US;q=0.8', active);
    expect(result).toBe('pl-PL');
  });

  it('falls back to the language-only match when no exact tag is active', async () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    const result = await svc.resolveRequestLocale('en-GB,en-CA', active);
    expect(result).toBe('en-US');
  });

  it('returns the configured default when nothing matches', async () => {
    const svc = new LocaleService(fakeLanguageService('en-US'));
    const result = await svc.resolveRequestLocale('ja-JP,zh-CN', active);
    expect(result).toBe('en-US');
  });

  it('returns the configured default when the header is missing', async () => {
    const svc = new LocaleService(fakeLanguageService('pl-PL'));
    const result = await svc.resolveRequestLocale(undefined, active);
    expect(result).toBe('pl-PL');
  });
});
