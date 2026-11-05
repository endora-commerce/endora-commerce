import { describe, expect, it } from 'vitest';
import { nearestValidScope, scopeFromSearch, scopeInWords, searchWithScope } from './editor-scope.js';

/** Feature 174 (T092, `contracts/editor-ui.md` §1) — the editor scope in the address. */

const CH = '00000000-0000-4000-8000-0000000000d1';
const VALID = { channels: [{ channelId: CH, name: 'B2B PL', languages: [{ code: 'pl-PL', name: 'Polish' }] }] };
const t = (key: string, params?: Record<string, string>): string => `${key}${params ? JSON.stringify(params) : ''}`;

describe('editor scope in the URL', () => {
  it('reads the three levels and nothing else', () => {
    expect(scopeFromSearch(new URLSearchParams('scope=global'))).toEqual({ level: 'global' });
    expect(scopeFromSearch(new URLSearchParams(`scope=channel&channel=${CH}`))).toEqual({ level: 'channel', channelId: CH });
    expect(scopeFromSearch(new URLSearchParams(`scope=cl&channel=${CH}&language=pl-PL`))).toEqual({
      level: 'channel_language',
      channelId: CH,
      languageCode: 'pl-PL',
    });
    expect(scopeFromSearch(new URLSearchParams('tab=media'))).toBeNull();
    expect(scopeFromSearch(new URLSearchParams('scope=cl'))).toBeNull();
  });

  it('writes a scope and keeps the tab', () => {
    const next = searchWithScope(new URLSearchParams(`tab=media&scope=cl&channel=${CH}&language=pl-PL`), { level: 'global' });
    expect(next.get('tab')).toBe('media');
    expect(next.get('scope')).toBe('global');
    expect(next.has('channel')).toBe(false);
    expect(next.has('language')).toBe(false);
  });

  it('falls back along C×L → C → G', () => {
    expect(nearestValidScope({ level: 'channel_language', channelId: CH, languageCode: 'de-DE' }, VALID)).toEqual({
      level: 'channel',
      channelId: CH,
    });
    expect(nearestValidScope({ level: 'channel', channelId: '00000000-0000-4000-8000-0000000000ff' }, VALID)).toEqual({
      level: 'global',
    });
  });

  it('says the scope by channel and language name, not code', () => {
    expect(scopeInWords({ level: 'channel_language', channelId: CH, languageCode: 'pl-PL' }, VALID, t, 'en')).toBe(
      'productEditor.scope.channelLanguage{"channel":"B2B PL","language":"Polish"}',
    );
  });
});
