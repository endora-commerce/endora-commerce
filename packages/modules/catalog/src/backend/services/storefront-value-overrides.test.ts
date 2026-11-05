import { describe, expect, it } from 'vitest';
import type { OverrideRow, ScopeLevel } from '@endora-commerce/contracts';

import { effectiveAttributeValues, effectiveSystemText } from './storefront-value-overrides.js';

/**
 * Issue #384, rewritten by feature 174 (T033; research R1) — the storefront's effective value at
 * (channel, language): the C×L row, else the C row, else Global, restricted to the field's scope
 * set; a present row answers whatever it holds and `{ v: null }` is an empty override (FR-013).
 */

const A = 'channel-a';
const B = 'channel-b';

const rows: OverrideRow[] = [
  { attributeKey: 'name', channelId: A, languageCode: 'pl-PL', value: { v: 'Zestaw hurtowy' } },
  { attributeKey: 'name', channelId: A, languageCode: null, value: { v: 'Channel name' } },
  { attributeKey: 'description', channelId: A, languageCode: 'pl-PL', value: { v: null } },
  { attributeKey: 'finish', channelId: A, languageCode: null, value: { v: 'Matte' } },
  { attributeKey: 'finish', channelId: A, languageCode: 'pl-PL', value: { v: 'Mat' } },
  { attributeKey: 'size', channelId: A, languageCode: 'pl-PL', value: { v: 9 } },
];

describe('effectiveSystemText', () => {
  it('takes the (channel, language) row, then the channel row, then Global', () => {
    expect(effectiveSystemText(rows, 'name', { channelId: A, languageCode: 'pl-PL' }, 'Global')).toBe('Zestaw hurtowy');
    expect(effectiveSystemText(rows, 'name', { channelId: A, languageCode: 'en-US' }, 'Global')).toBe('Channel name');
    expect(effectiveSystemText(rows, 'name', { channelId: B, languageCode: 'pl-PL' }, 'Global')).toBe('Global');
    expect(effectiveSystemText(undefined, 'name', { channelId: A, languageCode: 'pl-PL' }, 'Global')).toBe('Global');
  });

  it('an empty override stops the fallback (FR-013)', () => {
    expect(effectiveSystemText(rows, 'description', { channelId: A, languageCode: 'pl-PL' }, 'Global text')).toBeNull();
    expect(effectiveSystemText(rows, 'description', { channelId: A, languageCode: 'en-US' }, 'Global text')).toBe('Global text');
  });

  it('a channel scope (no language) reads the channel row only', () => {
    expect(effectiveSystemText(rows, 'name', { channelId: A, languageCode: null }, 'Global')).toBe('Channel name');
  });
});

describe('effectiveAttributeValues', () => {
  const levels = new Map<string, readonly ScopeLevel[]>([
    ['finish', ['G', 'C', 'CL']],
    ['size', ['G', 'C']],
  ]);

  it('resolves each scopable attribute within its scope set', async () => {
    const values = await effectiveAttributeValues(
      { finish: 'Gloss', size: 3, colour: 'red' },
      rows,
      { channelId: A, languageCode: 'pl-PL' },
      async () => levels,
    );
    // A {G,C} attribute ignores its C×L row.
    expect(values).toEqual({ finish: 'Mat', size: 3, colour: 'red' });
  });

  it('returns the input itself when no user-attribute row exists', async () => {
    const input = { finish: 'Gloss' };
    const nameOnly = rows.filter((row) => row.attributeKey === 'name');
    expect(await effectiveAttributeValues(input, nameOnly, { channelId: A, languageCode: 'pl-PL' }, async () => levels)).toBe(
      input,
    );
  });
});
