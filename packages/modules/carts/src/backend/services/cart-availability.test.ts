import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductAudience, ProductAvailabilityScope } from '@endora-commerce/contracts';

const channelState: { current: { id: string; languages: string[]; defaultLanguage: string } | null } = {
  current: null,
};
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channelState.current,
}));

const { availableRecords, basketScopeLanguage, firstLanguageTag } = await import('./cart-availability.js');

/**
 * Feature 163 (FR-006, FR-007, QA checkpoint B) — which (channel, language,
 * audience) a basket seam asks `catalogProductAvailabilityPort` about, and what
 * it does with the answer. The rule itself is `catalog`'s.
 */
const B2B = 'channel-b2b';
const AUDIENCE: ProductAudience = { organizationId: 'org-x', authenticated: true };

beforeEach(() => {
  channelState.current = { id: B2B, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
});

describe('basketScopeLanguage', () => {
  it('resolves the request tag against the request channel when the basket is on it', () => {
    expect(basketScopeLanguage(B2B, 'de')).toBe('de-DE');
    expect(basketScopeLanguage(B2B, 'DE-de')).toBe('de-DE');
  });
  it('an unknown tag answers the channel default, never the tag', () => {
    expect(basketScopeLanguage(B2B, 'fr-FR')).toBe('pl-PL');
  });
  it('is null (the channel default at the port) for a basket on another channel', () => {
    expect(basketScopeLanguage('another-channel', 'de')).toBeNull();
  });
  it('is null outside a request', () => {
    channelState.current = null;
    expect(basketScopeLanguage(B2B, 'de')).toBeNull();
  });
});

describe('availableRecords', () => {
  const records = [{ id: 'on' }, { id: 'off' }, { id: 'window-closed' }];
  const port = (live: string[]) => ({
    filterAvailable: vi.fn(async (ids: readonly string[], _scope?: ProductAvailabilityScope) =>
      new Set(ids.filter((id) => live.includes(id))),
    ),
  });

  it('drops every record the port does not return, whatever the reason, and keeps order', async () => {
    const p = port(['on']);
    const out = await availableRecords(p, records, { channelId: B2B, languageCode: 'de-DE', audience: AUDIENCE });
    expect(out).toEqual([{ id: 'on' }]);
    expect(p.filterAvailable).toHaveBeenCalledWith(['on', 'off', 'window-closed'], {
      channelId: B2B,
      languageCode: 'de-DE',
      audience: AUDIENCE,
    });
  });

  it('passes a null language through so the port uses the channel default', async () => {
    const p = port(['on']);
    await availableRecords(p, records, { channelId: B2B, languageCode: null, audience: AUDIENCE });
    expect(p.filterAvailable.mock.calls[0]![1]).toMatchObject({ languageCode: null });
  });

  it('does not ask the port for an empty list', async () => {
    const p = port([]);
    expect(await availableRecords(p, [], { channelId: B2B, languageCode: null, audience: AUDIENCE })).toEqual([]);
    expect(p.filterAvailable).not.toHaveBeenCalled();
  });

  it('a basket without a channel is returned as it is and the port is not asked', async () => {
    const p = port([]);
    const out = await availableRecords(p, records, { channelId: null, languageCode: null, audience: AUDIENCE });
    expect(out).toHaveLength(3);
    expect(p.filterAvailable).not.toHaveBeenCalled();
  });
});

describe('firstLanguageTag', () => {
  it.each([
    ['de-DE,en;q=0.8', 'de-DE'],
    ['de;q=0.9, en', 'de'],
    ['  pl-PL  ', 'pl-PL'],
    ['', undefined],
    [undefined, undefined],
  ])('%j -> %j', (header, expected) => {
    expect(firstLanguageTag(header)).toBe(expected);
  });
  it('reads the first element of a repeated header', () => {
    expect(firstLanguageTag(['en-GB', 'de'])).toBe('en-GB');
  });
});
