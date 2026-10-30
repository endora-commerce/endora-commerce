import { describe, expect, it } from 'vitest';

import { effectiveScopedValue, effectiveSystemText, type OverrideRow } from '../src/index.js';

// Issue #384, rewritten by feature 168 (R1) — the one chain the storefront's catalog and search
// reads share: C×L → C → Global, an empty override answering "nothing".
describe('effectiveSystemText at (channel, language)', () => {
  const channelId = 'channel-a';
  const rows: OverrideRow[] = [
    { attributeKey: 'name', channelId, languageCode: 'pl-PL', value: { v: 'Zestaw hurtowy' } },
    { attributeKey: 'name', channelId, languageCode: null, value: { v: 'Zestaw kanałowy' } },
    { attributeKey: 'description', channelId, languageCode: 'pl-PL', value: { v: null } },
  ];

  it('the C×L override answers at its language', () => {
    expect(effectiveSystemText(rows, 'name', { channelId, languageCode: 'pl-PL' }, 'Baseline kit')).toBe('Zestaw hurtowy');
  });

  it('another language of the channel takes the channel override, then Global', () => {
    expect(effectiveSystemText(rows, 'name', { channelId, languageCode: 'en-US' }, 'Baseline kit')).toBe('Zestaw kanałowy');
    expect(effectiveSystemText([], 'name', { channelId, languageCode: 'en-US' }, 'Baseline kit')).toBe('Baseline kit');
  });

  it('an empty description override answers null and stops the fallback (FR-013)', () => {
    expect(effectiveSystemText(rows, 'description', { channelId, languageCode: 'pl-PL' }, 'Global text')).toBeNull();
  });

  it('another channel never matches', () => {
    expect(effectiveSystemText(rows, 'name', { channelId: 'channel-b', languageCode: 'pl-PL' }, 'G')).toBe('G');
  });

  it('a {G,C} attribute ignores C×L rows', () => {
    const attr: OverrideRow[] = [{ attributeKey: 'size', channelId, languageCode: 'pl-PL', value: { v: 9 } }];
    expect(effectiveScopedValue(attr, 'size', ['G', 'C'], { channelId, languageCode: 'pl-PL' }, 3)).toBe(3);
  });
});
