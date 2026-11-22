import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Issue #1507 (UX audit CAT-05, architect ruling Q3) — the content languages a
 * per-language form offers are the union of the active sales channels'
 * languages, read by one kit hook (lifted out of `newsletter`, constitution I),
 * and a stored translation no channel offers stays visible, read-only and
 * flagged rather than being dropped or edited.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { contentLanguageName, offerContentLanguages, useChannelLanguages } = await import(
  '@endora-commerce/admin-kit/components'
);

function channels(details: Record<string, string[] | Error>, defaults: Record<string, string> = {}): void {
  getSpy.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/admin/sales-channels?')) {
      return Promise.resolve({
        items: Object.keys(details).map((code) => ({ code, defaultLanguage: defaults[code] ?? 'en-US' })),
      });
    }
    const code = decodeURIComponent(url.split('/').pop() ?? '');
    const detail = details[code];
    return detail instanceof Error ? Promise.reject(detail) : Promise.resolve({ code, languages: detail });
  });
}

afterEach(() => {
  getSpy.mockReset();
});

describe('useChannelLanguages', () => {
  it('is the sorted union of every active channel’s languages', async () => {
    channels({ b2b: ['pl-PL', 'en-US'], b2c: ['pl-PL', 'de-DE'] });
    const { result } = renderHook(() => useChannelLanguages());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.languages).toEqual(['de-DE', 'en-US', 'pl-PL']);
    expect(getSpy.mock.calls[0]?.[0]).toContain('activeOnly=true');
  });

  it('offers a channel’s default language when its detail cannot be read', async () => {
    channels({ b2b: ['pl-PL'], outlet: new Error('boom') }, { outlet: 'cs-CZ' });
    const { result } = renderHook(() => useChannelLanguages());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.languages).toEqual(['cs-CZ', 'pl-PL']);
  });

  it('keeps `current` in the list, and offers it alone when the channels cannot be read', async () => {
    getSpy.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useChannelLanguages('fr-FR'));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.languages).toEqual(['fr-FR']);
  });
});

describe('offerContentLanguages', () => {
  const ready = (languages: string[]) => ({ languages, status: 'ready' as const });

  it('makes the channels’ languages editable and flags a stored one no channel offers', () => {
    expect(offerContentLanguages(ready(['en-US', 'pl-PL']), ['pl-PL', 'de-DE'])).toEqual({
      editable: ['en-US', 'pl-PL'],
      outside: ['de-DE'],
      degraded: null,
    });
  });

  it('writes to the stored key when it differs from the channel’s only in case', () => {
    expect(offerContentLanguages(ready(['en-US']), ['en-us'])).toEqual({
      editable: ['en-us'],
      outside: [],
      degraded: null,
    });
  });

  it('falls back to the stored languages plus the fallback, flagging nothing, while the channels are unknown', () => {
    for (const status of ['loading', 'failed'] as const) {
      expect(offerContentLanguages({ languages: [], status }, ['de-DE'], ['pl-PL'])).toEqual({
        editable: ['de-DE', 'pl-PL'],
        outside: [],
        degraded: status,
      });
    }
  });

  it('says so when no channel offers a language at all', () => {
    expect(offerContentLanguages(ready([]), [], ['en-US'])).toEqual({
      editable: ['en-US'],
      outside: [],
      degraded: 'noChannels',
    });
  });
});

describe('contentLanguageName', () => {
  it('names a code in the admin’s language, and returns the code it cannot name', () => {
    expect(contentLanguageName('pl-PL', 'en')).toBe('Polish (Poland)');
    expect(contentLanguageName('en-US', 'pl')).toBe('angielski (Stany Zjednoczone)');
    expect(contentLanguageName('not a code', 'en')).toBe('not a code');
  });
});
