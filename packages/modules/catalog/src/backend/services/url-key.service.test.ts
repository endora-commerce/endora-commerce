import { describe, expect, it } from 'vitest';
import { effectiveKeyAt, keysInChannel } from './url-key.service.js';

/**
 * Feature 170 (T039; `contracts/url-keys.md` §1) — the two definitions every key check reads.
 * Replaces the 163 planner's unit test: the planner is gone, the checks run under the locks in
 * `UrlKeyService.lockAndCheck` and are held by `backend/test/integration/catalog/url-keys-three-levels.test.ts`.
 */
const C = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const channel = { id: C, languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' };

describe('effectiveKeyAt — C×L → C → slug', () => {
  const rows = [
    { salesChannelId: C, languageCode: 'pl-PL', key: 'wiertarka' },
    { salesChannelId: C, languageCode: null, key: 'drill-c' },
    { salesChannelId: D, languageCode: 'en-US', key: 'drill-d' },
  ];
  it('takes the C×L row, case-insensitively', () => {
    expect(effectiveKeyAt(rows, 'drill', C, 'PL-pl')).toBe('wiertarka');
  });
  it('else the channel row', () => {
    expect(effectiveKeyAt(rows, 'drill', C, 'en-US')).toBe('drill-c');
  });
  it('else the slug', () => {
    expect(effectiveKeyAt(rows, 'drill', D, 'pl-PL')).toBe('drill');
  });
});

describe('keysInChannel — every row of C, plus the slug where C uses it', () => {
  it('includes the slug while some language falls back to it', () => {
    const rows = [{ salesChannelId: C, languageCode: 'pl-PL', key: 'wiertarka' }];
    expect([...keysInChannel(rows, 'drill', channel, C)].sort()).toEqual(['drill', 'wiertarka']);
  });
  it('excludes the slug once every language has its own key, and keeps orphan rows', () => {
    const rows = [
      { salesChannelId: C, languageCode: null, key: 'drill-c' },
      { salesChannelId: C, languageCode: 'fr-FR', key: 'perceuse' },
    ];
    expect([...keysInChannel(rows, 'drill', channel, C)].sort()).toEqual(['drill-c', 'perceuse']);
  });
  it('without the channel record (an orphan channel) is the rows alone', () => {
    expect([...keysInChannel([{ salesChannelId: D, languageCode: null, key: 'x' }], 'drill', undefined, D)]).toEqual(['x']);
  });
});
