import { describe, expect, it } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE, type ProductAudience } from './catalog.js';
import {
  effectiveAudience,
  effectiveOrderRules,
  effectiveStatus,
  effectiveWindow,
  isInsideWindow,
  isOn,
  isProductEffectivelyAvailable,
  pairsTurningOn,
  withChannelOrderRules,
  PRODUCT_SCOPE_STATUSES,
  resolveScopeLanguage,
  sameLanguage,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductGlobalScopeFields,
  type ScopeChannel,
  type ScopeSnapshot,
} from './product-scopes.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — the one definition of effective
 * availability (FR-001, FR-002), every row of `data-model.md` §4, the scope language
 * (R7) and the completeness gate's pair computation (R18, M3 → A).
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const ORG_A = '00000000-0000-4000-8000-0000000000e1';
const ORG_B = '00000000-0000-4000-8000-0000000000e2';

const NOW = new Date('2026-12-01T12:00:00.000Z');

const b2b: ScopeChannel = { id: B2B, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
const b2c: ScopeChannel = { id: B2C, languages: ['pl-PL', 'en-GB'], defaultLanguage: 'pl-PL' };

function global(over: Partial<ProductGlobalScopeFields> = {}): ProductGlobalScopeFields {
  return {
    status: 'active',
    deletedAt: null,
    archivedAt: null,
    window: { from: null, until: null },
    visibility: 'public',
    allowedOrganizationIds: [],
    minOrderQuantity: null,
    returnable: true,
    ...over,
  };
}

function channelRow(over: Partial<ProductChannelScopeRecord> = {}): ProductChannelScopeRecord {
  return {
    productId: P,
    channelId: B2B,
    status: null,
    window: null,
    audience: null,
    minOrderQuantityOverridden: false,
    minOrderQuantity: null,
    returnable: null,
    ...over,
  };
}

function clRow(over: Partial<ProductChannelLanguageScopeRecord> = {}): ProductChannelLanguageScopeRecord {
  return { productId: P, channelId: B2B, languageCode: 'de-DE', status: 'inactive', ...over };
}

const SIGNED_IN_A: ProductAudience = { organizationId: ORG_A, authenticated: true };
const SIGNED_IN_B: ProductAudience = { organizationId: ORG_B, authenticated: true };

function available(
  input: Partial<Parameters<typeof isProductEffectivelyAvailable>[0]> = {},
): boolean {
  return isProductEffectivelyAvailable({
    global: global(),
    isMember: true,
    channel: b2b,
    languageCode: 'pl-PL',
    audience: ANONYMOUS_PRODUCT_AUDIENCE,
    now: NOW,
    ...input,
  });
}

describe('PRODUCT_SCOPE_STATUSES', () => {
  it('is the value set active / inactive (FR-010, FR-112, R3)', () => {
    expect([...PRODUCT_SCOPE_STATUSES]).toEqual(['active', 'inactive']);
  });

  it('isOn is true for active alone', () => {
    expect(PRODUCT_SCOPE_STATUSES.filter(isOn)).toEqual(['active']);
  });
});

describe('effectiveStatus — cl ?? c ?? global', () => {
  it('falls back to the global value with no override', () => {
    expect(effectiveStatus(global({ status: 'inactive' }), undefined, undefined)).toBe('inactive');
  });

  it('a channel row with status null inherits the global value', () => {
    expect(effectiveStatus(global({ status: 'active' }), channelRow({ status: null }), undefined)).toBe('active');
  });

  it('a channel status beats the global one', () => {
    expect(effectiveStatus(global({ status: 'active' }), channelRow({ status: 'inactive' }), undefined)).toBe('inactive');
  });

  it('a channel × language status beats the channel and the global one', () => {
    expect(
      effectiveStatus(global({ status: 'inactive' }), channelRow({ status: 'inactive' }), clRow({ status: 'active' })),
    ).toBe('active');
  });
});

describe('isProductEffectivelyAvailable — data-model §4', () => {
  it('a member, active, inside an open window, public product is available', () => {
    expect(available()).toBe(true);
  });

  it('deleted → unavailable', () => {
    expect(available({ global: global({ deletedAt: NOW }) })).toBe(false);
  });

  it('archived → unavailable, whatever the overrides say', () => {
    expect(
      available({
        global: global({ status: 'inactive', archivedAt: NOW }),
        channelRow: channelRow({ status: 'active' }),
      }),
    ).toBe(false);
  });

  it('not a member of the channel → unavailable, even with an active override (orphan ignored)', () => {
    expect(available({ isMember: false, channelRow: channelRow({ status: 'active' }) })).toBe(false);
  });

  it('a language the channel does not offer → unavailable, even with an active C×L row (orphan ignored)', () => {
    expect(
      available({
        languageCode: 'fr-FR',
        clRow: clRow({ languageCode: 'fr-FR', status: 'active' }),
      }),
    ).toBe(false);
  });

  it.each(['inactive'] as const)('global %s with no override → unavailable', (status) => {
    expect(available({ global: global({ status }) })).toBe(false);
  });

  it.each(['inactive'] as const)(
    'channel %s is plain off in that channel and never "gone" (FR-010)',
    (status) => {
      const g = global();
      expect(available({ global: g, channelRow: channelRow({ status }) })).toBe(false);
      // The global record is untouched: an override never archives.
      expect(g.archivedAt).toBeNull();
    },
  );

  it.each(['inactive'] as const)('C×L %s is off at that language only', (status) => {
    const row = clRow({ languageCode: 'de-DE', status });
    expect(available({ languageCode: 'de-DE', clRow: row })).toBe(false);
    expect(available({ languageCode: 'pl-PL', clRow: undefined })).toBe(true);
  });

  it('a C×L active override turns a globally inactive product on at that pair', () => {
    expect(
      available({
        global: global({ status: 'inactive' }),
        languageCode: 'de-DE',
        clRow: clRow({ status: 'active' }),
      }),
    ).toBe(true);
  });

  it('rows of another channel or another language are ignored', () => {
    expect(
      available({
        channelRow: channelRow({ channelId: B2C, status: 'inactive' }),
        clRow: clRow({ languageCode: 'de-DE', status: 'inactive' }),
        languageCode: 'pl-PL',
      }),
    ).toBe(true);
  });

  describe('publication window (K4 — inclusive both ends, to the millisecond)', () => {
    const from = new Date('2026-12-01T00:00:00.000Z');
    const until = new Date('2026-12-31T23:59:59.999Z');
    const g = global({ window: { from, until } });

    it('one millisecond before the start → unavailable', () => {
      expect(available({ global: g, now: new Date(from.getTime() - 1) })).toBe(false);
    });

    it('at the start → available', () => {
      expect(available({ global: g, now: from })).toBe(true);
    });

    it('at the end → available', () => {
      expect(available({ global: g, now: until })).toBe(true);
    });

    it('one millisecond after the end → unavailable', () => {
      expect(available({ global: g, now: new Date(until.getTime() + 1) })).toBe(false);
    });

    it('an overridden open window beats a bounded global one (R4)', () => {
      const after = new Date(until.getTime() + 1);
      expect(
        available({
          global: g,
          now: after,
          channelRow: channelRow({ window: { from: null, until: null } }),
        }),
      ).toBe(true);
    });

    it('an overridden window replaces the pair; it does not inherit the global end', () => {
      const w = effectiveWindow(g, channelRow({ window: { from: new Date('2027-01-01T00:00:00.000Z'), until: null } }));
      expect(w).toEqual({ from: new Date('2027-01-01T00:00:00.000Z'), until: null });
    });

    it('isInsideWindow treats null bounds as open', () => {
      expect(isInsideWindow({ from: null, until: null }, NOW)).toBe(true);
      expect(isInsideWindow({ from: null, until: NOW }, NOW)).toBe(true);
      expect(isInsideWindow({ from: NOW, until: null }, NOW)).toBe(true);
    });
  });

  describe('audience (C4 — the channel override replaces the whole rule)', () => {
    const restricted = global({ visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A] });

    it('the global rule applies without an override', () => {
      expect(available({ global: restricted, audience: SIGNED_IN_A })).toBe(true);
      expect(available({ global: restricted, audience: SIGNED_IN_B })).toBe(false);
      expect(available({ global: restricted })).toBe(false);
    });

    it('the override replaces the organization list instead of merging it (US3 #3)', () => {
      const row = channelRow({
        audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_B] },
      });
      expect(available({ global: restricted, channelRow: row, audience: SIGNED_IN_B })).toBe(true);
      expect(available({ global: restricted, channelRow: row, audience: SIGNED_IN_A })).toBe(false);
      expect(effectiveAudience(restricted, row)).toEqual({
        visibility: 'organization_restricted',
        allowedOrganizationIds: [ORG_B],
      });
    });

    it('a public channel override opens a restricted product in that channel', () => {
      const row = channelRow({ audience: { visibility: 'public', allowedOrganizationIds: [] } });
      expect(available({ global: restricted, channelRow: row })).toBe(true);
    });

    it('logged_in_only override admits any signed-in caller and refuses the public', () => {
      const row = channelRow({ audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] } });
      expect(available({ channelRow: row, audience: SIGNED_IN_B })).toBe(true);
      expect(available({ channelRow: row })).toBe(false);
    });
  });
});

describe('effectiveOrderRules — c ?? global (FR-100; 168 data-model §4)', () => {
  it('168: an overridden channel minimum of null is "no minimum in this channel"', () => {
    expect(
      effectiveOrderRules(
        global({ minOrderQuantity: 5, returnable: false }),
        channelRow({ minOrderQuantityOverridden: true, minOrderQuantity: null }),
      ),
    ).toEqual({ minOrderQuantity: null, returnable: false });
  });

  it('168: a channel value without the flag does not override', () => {
    expect(
      effectiveOrderRules(global({ minOrderQuantity: 5, returnable: false }), channelRow({ minOrderQuantity: 9 })),
    ).toEqual({ minOrderQuantity: 5, returnable: false });
  });

  it('inherits both values without a row', () => {
    expect(effectiveOrderRules(global({ minOrderQuantity: 5, returnable: false }), undefined)).toEqual({
      minOrderQuantity: 5,
      returnable: false,
    });
  });

  it('a channel row overrides each value independently', () => {
    expect(
      effectiveOrderRules(
        global({ minOrderQuantity: 5, returnable: false }),
        channelRow({ minOrderQuantityOverridden: true, minOrderQuantity: 2 }),
      ),
    ).toEqual({ minOrderQuantity: 2, returnable: false });
    expect(
      effectiveOrderRules(global({ minOrderQuantity: 5, returnable: false }), channelRow({ returnable: true })),
    ).toEqual({ minOrderQuantity: 5, returnable: true });
  });
});

describe('pairsTurningOn — the completeness gate pairs (R18, N3, M3 → A)', () => {
  function snap(over: Partial<ScopeSnapshot> = {}): ScopeSnapshot {
    return { global: global({ status: 'inactive' }), channelRows: [], languageRows: [], ...over };
  }
  const sortPairs = (pairs: Array<{ channelId: string; languageCode: string }>) =>
    [...pairs].sort((a, b) => `${a.channelId}/${a.languageCode}`.localeCompare(`${b.channelId}/${b.languageCode}`));

  it('a global switch inactive → active turns every member channel language on', () => {
    const pairs = pairsTurningOn(snap(), snap({ global: global({ status: 'active' }) }), [b2b, b2c]);
    expect(sortPairs(pairs)).toEqual(
      sortPairs([
        { channelId: B2B, languageCode: 'pl-PL' },
        { channelId: B2B, languageCode: 'de-DE' },
        { channelId: B2C, languageCode: 'pl-PL' },
        { channelId: B2C, languageCode: 'en-GB' },
      ]),
    );
  });

  it('a global switch skips the pairs an override keeps off', () => {
    const rows = { channelRows: [channelRow({ channelId: B2C, status: 'inactive' })] };
    const pairs = pairsTurningOn(snap(rows), snap({ ...rows, global: global({ status: 'active' }) }), [b2b, b2c]);
    expect(sortPairs(pairs)).toEqual(
      sortPairs([
        { channelId: B2B, languageCode: 'pl-PL' },
        { channelId: B2B, languageCode: 'de-DE' },
      ]),
    );
  });

  it('a channel row covers every language of that channel', () => {
    const pairs = pairsTurningOn(snap(), snap({ channelRows: [channelRow({ status: 'active' })] }), [b2b, b2c]);
    expect(sortPairs(pairs)).toEqual(
      sortPairs([
        { channelId: B2B, languageCode: 'pl-PL' },
        { channelId: B2B, languageCode: 'de-DE' },
      ]),
    );
  });

  it('a C×L row turns on exactly one pair', () => {
    const pairs = pairsTurningOn(snap(), snap({ languageRows: [clRow({ status: 'active' })] }), [b2b, b2c]);
    expect(pairs).toEqual([{ channelId: B2B, languageCode: 'de-DE' }]);
  });

  it('a pair already on is not returned', () => {
    const before = snap({ global: global({ status: 'active' }) });
    const after = snap({ global: global({ status: 'active' }), languageRows: [clRow({ status: 'active' })] });
    expect(pairsTurningOn(before, after, [b2b])).toEqual([]);
  });

  it('turning off returns nothing', () => {
    expect(pairsTurningOn(snap({ global: global({ status: 'active' }) }), snap(), [b2b])).toEqual([]);
  });

  it('non-member channels are ignored', () => {
    const after = snap({ channelRows: [channelRow({ channelId: B2C, status: 'active' })] });
    expect(pairsTurningOn(snap(), after, [b2b])).toEqual([]);
  });

  it('a C×L row for a language the channel does not offer is ignored', () => {
    const after = snap({ languageRows: [clRow({ languageCode: 'fr-FR', status: 'active' })] });
    expect(pairsTurningOn(snap(), after, [b2b])).toEqual([]);
  });

  it('status only: an archived product whose global status goes inactive → active returns its pairs (FR-060)', () => {
    const before = snap({ global: global({ status: 'inactive', archivedAt: NOW }) });
    const after = snap({ global: global({ status: 'active', archivedAt: NOW }) });
    expect(sortPairs(pairsTurningOn(before, after, [b2b]))).toEqual(
      sortPairs([
        { channelId: B2B, languageCode: 'pl-PL' },
        { channelId: B2B, languageCode: 'de-DE' },
      ]),
    );
  });

  it('status only: a Restore (only archivedAt differs) turns nothing on (FR-019, FR-060)', () => {
    const rows = { channelRows: [channelRow({ status: 'active' })] };
    const before = snap({ ...rows, global: global({ status: 'active', archivedAt: NOW }) });
    const after = snap({ ...rows, global: global({ status: 'active', archivedAt: null }) });
    expect(pairsTurningOn(before, after, [b2b])).toEqual([]);
  });

  it('a deleted product never turns on, whatever its overrides say', () => {
    const after = snap({ channelRows: [channelRow({ status: 'active' })], global: global({ deletedAt: NOW }) });
    expect(pairsTurningOn(snap(), after, [b2b])).toEqual([]);
  });

  describe('M3 → A: only a status change produces a pair', () => {
    const activeEverywhere = global({ status: 'active' });

    it('snapshots differing only in the global window → []', () => {
      const before = snap({ global: global({ status: 'active', window: { from: new Date('2027-01-01'), until: null } }) });
      const after = snap({ global: activeEverywhere });
      expect(pairsTurningOn(before, after, [b2b, b2c])).toEqual([]);
    });

    it('snapshots differing only in a channel window that opens now → []', () => {
      const before = snap({
        global: activeEverywhere,
        channelRows: [channelRow({ window: { from: new Date('2027-01-01'), until: null } })],
      });
      const after = snap({ global: activeEverywhere, channelRows: [channelRow({ window: { from: NOW, until: null } })] });
      expect(pairsTurningOn(before, after, [b2b])).toEqual([]);
    });

    it('snapshots differing only in audience → []', () => {
      const before = snap({
        global: global({ status: 'active', visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A] }),
      });
      const after = snap({
        global: activeEverywhere,
        channelRows: [channelRow({ audience: { visibility: 'public', allowedOrganizationIds: [] } })],
      });
      expect(pairsTurningOn(before, after, [b2b])).toEqual([]);
    });
  });
});

describe('resolveScopeLanguage (A-3, R7)', () => {
  const channel: ScopeChannel = { id: B2B, languages: ['pl-PL', 'de-DE', 'en-GB'], defaultLanguage: 'pl-PL' };

  it('an exact match wins', () => {
    expect(resolveScopeLanguage(channel, 'de-DE')).toBe('de-DE');
  });

  it('matches case-insensitively and answers the channel spelling', () => {
    expect(resolveScopeLanguage(channel, 'de-de')).toBe('de-DE');
    expect(resolveScopeLanguage(channel, 'EN-gb')).toBe('en-GB');
  });

  it('falls back to the first channel language sharing the base language', () => {
    expect(resolveScopeLanguage(channel, 'de')).toBe('de-DE');
    expect(resolveScopeLanguage(channel, 'en-US')).toBe('en-GB');
  });

  it('a regional request matches a bare channel language', () => {
    expect(resolveScopeLanguage({ id: B2C, languages: ['pl', 'en'], defaultLanguage: 'pl' }, 'en-US')).toBe('en');
  });

  it('an unknown tag answers the channel default', () => {
    expect(resolveScopeLanguage(channel, 'fr-FR')).toBe('pl-PL');
  });

  it('ignores a quality parameter carried with the tag (an `Accept-Language` pick)', () => {
    expect(resolveScopeLanguage(channel, 'de;q=0.9')).toBe('de-DE');
    expect(resolveScopeLanguage(channel, 'en-GB;q=0.8')).toBe('en-GB');
  });

  it.each([null, undefined, '', '   '])('%s answers the channel default', (tag) => {
    expect(resolveScopeLanguage(channel, tag)).toBe('pl-PL');
  });
});

describe('withChannelOrderRules — the channel-effective records a seam judges (FR-100, R26)', () => {
  const records = [
    { id: 'a', type: 'simple', minOrderQuantity: null, returnable: false, name: 'A' },
    { id: 'b', type: 'simple', minOrderQuantity: 5, returnable: true, name: 'B' },
  ];

  it('replaces the minimum and the returnable flag with the channel’s, keeping every other field', () => {
    const out = withChannelOrderRules(records, new Map([['a', { minOrderQuantity: 10, returnable: true }]]));
    expect(out[0]).toEqual({ id: 'a', type: 'simple', minOrderQuantity: 10, returnable: true, name: 'A' });
  });

  it('leaves a record the rules do not name as it is, and never mutates the input', () => {
    const out = withChannelOrderRules(records, new Map([['a', { minOrderQuantity: 10, returnable: true }]]));
    expect(out[1]).toBe(records[1]);
    expect(records[0]!.minOrderQuantity).toBeNull();
  });
});

describe('sameLanguage — one comparison of two language tags (checkpoint C code review, N3)', () => {
  it('compares case-insensitively', () => {
    expect(sameLanguage('de-DE', 'de-de')).toBe(true);
    expect(sameLanguage('de-DE', 'de')).toBe(false);
  });
  it('treats null (no language) as equal only to null', () => {
    expect(sameLanguage(null, null)).toBe(true);
    expect(sameLanguage(null, 'pl-PL')).toBe(false);
    expect(sameLanguage('pl-PL', undefined)).toBe(false);
  });
});
