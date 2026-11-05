import { describe, expect, it } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE, type ProductAudience } from './catalog.js';
import {
  type AudienceRule,
  effectiveStatus,
  isProductEffectivelyAvailable,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductGlobalScopeFields,
  type ProductScopeStatus,
  type ScopeChannel,
} from './product-scopes.js';

/**
 * Feature 163 — QA checkpoint B. Cross-axis cases the per-axis tests in
 * `product-scopes.test.ts` leave to their intersection: the full status
 * precedence grid, the window at its two instants around a DST change, the four
 * buyers against a channel-replaced audience, and a product that leaves a
 * channel (or a language that leaves it) with overrides still stored.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const CH = '00000000-0000-4000-8000-0000000000c1';
const ORG_X = '00000000-0000-4000-8000-0000000000e1';
const ORG_Y = '00000000-0000-4000-8000-0000000000e2';
const NOW = new Date('2026-12-01T12:00:00.000Z');
const channel: ScopeChannel = { id: CH, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };

const global = (over: Partial<ProductGlobalScopeFields> = {}): ProductGlobalScopeFields => ({
  status: 'active',
  deletedAt: null,
  archivedAt: null,
  window: { from: null, until: null },
  visibility: 'public',
  allowedOrganizationIds: [],
  minOrderQuantity: null,
  returnable: true,
  ...over,
});
const cRow = (over: Partial<ProductChannelScopeRecord> = {}): ProductChannelScopeRecord => ({
  productId: P,
  channelId: CH,
  status: null,
  window: null,
  audience: null,
  minOrderQuantityOverridden: false,
  minOrderQuantity: null,
  returnable: null,
  ...over,
});
const clRow = (over: Partial<ProductChannelLanguageScopeRecord> = {}): ProductChannelLanguageScopeRecord => ({
  productId: P,
  channelId: CH,
  languageCode: 'de-DE',
  status: 'inactive',
  ...over,
});
const available = (input: Partial<Parameters<typeof isProductEffectivelyAvailable>[0]> = {}): boolean =>
  isProductEffectivelyAvailable({
    global: global(),
    isMember: true,
    channel,
    languageCode: 'de-DE',
    audience: ANONYMOUS_PRODUCT_AUDIENCE,
    now: NOW,
    ...input,
  });

const STATUSES: readonly ProductScopeStatus[] = ['active', 'inactive'];

describe('163 QA — status precedence cl ?? c ?? global, every combination (US1)', () => {
  const grid: Array<[ProductScopeStatus, ProductScopeStatus | null, ProductScopeStatus | null]> = [];
  for (const g of STATUSES) for (const c of [null, ...STATUSES]) for (const l of [null, ...STATUSES]) grid.push([g, c, l]);

  it.each(grid)('global %s, channel %s, channel×language %s', (g, c, l) => {
    const expected = l ?? c ?? g;
    const input = {
      global: global({ status: g }),
      channelRow: c === null ? undefined : cRow({ status: c }),
      clRow: l === null ? undefined : clRow({ status: l }),
    };
    expect(effectiveStatus(input.global, input.channelRow, input.clRow)).toBe(expected);
    expect(available(input)).toBe(expected === 'active');
  });

  it('inactive at channel×language beats active at the channel and at global', () => {
    expect(available({ channelRow: cRow({ status: 'active' }), clRow: clRow({ status: 'inactive' }) })).toBe(false);
    // ...and only for that language
    expect(
      available({
        languageCode: 'pl-PL',
        channelRow: cRow({ status: 'active' }),
        clRow: clRow({ status: 'inactive' }),
      }),
    ).toBe(true);
  });

  it('a channel `inactive` below a globally active product is off, the product is not archived', () => {
    const g = global();
    expect(available({ global: g, channelRow: cRow({ status: 'inactive' }) })).toBe(false);
    expect(g.archivedAt).toBeNull();
  });
});

describe('163 QA — a language the channel does not offer (FR-015)', () => {
  it('stays off with an active channel row and an active stored channel×language row', () => {
    expect(
      available({
        languageCode: 'fr-FR',
        channelRow: cRow({ status: 'active' }),
        clRow: clRow({ languageCode: 'fr-FR', status: 'active' }),
      }),
    ).toBe(false);
  });

  it('comes back unchanged when the channel offers it again (the override was never destroyed)', () => {
    const row = clRow({ languageCode: 'fr-FR', status: 'active' });
    const base = { global: global({ status: 'inactive' }), languageCode: 'fr-FR', clRow: row };
    expect(available({ ...base })).toBe(false);
    expect(available({ ...base, channel: { ...channel, languages: ['pl-PL', 'de-DE', 'fr-FR'] } })).toBe(true);
  });
});

describe('163 QA — a product that leaves a channel keeps its overrides, unseen (FR-015)', () => {
  const rows = {
    channelRow: cRow({ status: 'active', audience: { visibility: 'public', allowedOrganizationIds: [] } }),
    clRow: clRow({ status: 'active' }),
  };
  it('non-member is unavailable whatever the rows say; re-joining restores them', () => {
    const base = { global: global({ status: 'inactive' }), ...rows };
    expect(available({ ...base, isMember: false })).toBe(false);
    expect(available({ ...base, isMember: true })).toBe(true);
  });
});

describe('163 QA — publication window across a DST change is an instant comparison (US2)', () => {
  // Europe/Warsaw springs forward at 2031-03-30T01:00:00Z (02:00 -> 03:00 local).
  const gap = new Date('2031-03-30T01:00:00.000Z');
  const before = new Date(gap.getTime() - 1);
  const after = new Date(gap.getTime() + 1);
  const win = (from: Date | null, until: Date | null) => global({ window: { from, until } });

  it.each([
    ['starts exactly at the transition instant', win(gap, null), [false, true, true]],
    ['ends exactly at the transition instant', win(null, gap), [true, true, false]],
    ['one hour wide, straddling the gap (01:00Z..02:00Z)', win(gap, new Date(gap.getTime() + 3_600_000)), [false, true, true]],
  ] as const)('%s', (_label, g, [atBefore, atGap, atAfter]) => {
    expect(available({ global: g, now: before })).toBe(atBefore);
    expect(available({ global: g, now: gap })).toBe(atGap);
    expect(available({ global: g, now: after })).toBe(atAfter);
  });

  it('a window whose bounds coincide is on for exactly that instant', () => {
    const g = win(gap, gap);
    expect([before, gap, after].map((now) => available({ global: g, now }))).toEqual([false, true, false]);
  });
});

describe('163 QA — audience per channel replaces the whole rule, for each kind of buyer (US3)', () => {
  const buyers: Array<[string, ProductAudience]> = [
    ['anonymous', ANONYMOUS_PRODUCT_AUDIENCE],
    ['signed in, no organisation', { organizationId: null, authenticated: true }],
    ['org X member', { organizationId: ORG_X, authenticated: true }],
    ['org Y (non-member of the list)', { organizationId: ORG_Y, authenticated: true }],
  ];
  const restrictedToX: AudienceRule = { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] };

  it.each(buyers)('channel list [X] over a public product — %s', (label, audience) => {
    expect(available({ channelRow: cRow({ audience: restrictedToX }), audience })).toBe(label === 'org X member');
  });

  it.each(buyers)('channel `public` over a globally restricted-to-X product — %s', (_label, audience) => {
    expect(
      available({
        global: global({ visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] }),
        channelRow: cRow({ audience: { visibility: 'public', allowedOrganizationIds: [] } }),
        audience,
      }),
    ).toBe(true);
  });

  it.each(buyers)('channel `logged_in_only` — %s', (label, audience) => {
    expect(
      available({
        channelRow: cRow({ audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] } }),
        audience,
      }),
    ).toBe(label !== 'anonymous');
  });

  it('an empty restricted list admits nobody, including the global list owner', () => {
    expect(
      available({
        global: global({ visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] }),
        channelRow: cRow({ audience: { visibility: 'organization_restricted', allowedOrganizationIds: [] } }),
        audience: { organizationId: ORG_X, authenticated: true },
      }),
    ).toBe(false);
  });
});
