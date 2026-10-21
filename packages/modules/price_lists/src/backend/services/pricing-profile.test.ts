import { describe, expect, it } from 'vitest';
import {
  PricingProfileResolver,
  buyerBookVector,
  profileKey,
  type ApplicableBookRow,
  type ApplicableBooksQuery,
  type PricingProfile,
  type ProfileMemoKey,
} from './pricing-profile.js';
import { effectiveCustomerGroupId } from './customer-group-rule.js';
import { PricingCache } from './pricing-cache.js';

/**
 * Feature 160 (D-287 §6 point 2, research R6) — the pricing profile: the price
 * depends on the buyer only through which books apply to it and at which chain
 * depth, so buyers with the same vector share cache entries and (later) price
 * surface rows (FR-010).
 */

const CH = 'channel-1';
const header = (
  id: string,
  audienceKind: ApplicableBookRow['audienceKind'],
  member: { organizationId?: string; customerGroupId?: string } = {},
  extra: Partial<ApplicableBookRow> = {},
): ApplicableBookRow => ({
  id,
  name: id,
  type: 'regular',
  audienceKind,
  priority: 0,
  isSystem: false,
  memberOrganizationId: member.organizationId ?? null,
  memberCustomerGroupId: member.customerGroupId ?? null,
  ...extra,
});

const BASE = header('base', 'everyone', {}, { isSystem: true });
const EVERYONE_BOOK = header('everyone-1', 'everyone');

function resolverOver(rows: ApplicableBookRow[], memo?: PricingCache<PricingProfile, ProfileMemoKey>) {
  const calls: ApplicableBooksQuery[] = [];
  const resolver = new PricingProfileResolver(
    async (query) => {
      calls.push(query);
      return rows.filter(
        (r) =>
          r.audienceKind === 'everyone' ||
          (r.memberOrganizationId !== null && query.organizationIds.includes(r.memberOrganizationId)) ||
          (r.memberCustomerGroupId !== null && r.memberCustomerGroupId === query.customerGroupId),
      );
    },
    memo,
  );
  return { resolver, calls };
}

describe('pricing profile — the buyer-book vector', () => {
  it('is sorted by book id whatever order the rows arrive in, with the nearest depth per book', () => {
    const rows = [
      header('b-2', 'organizations', { organizationId: 'parent' }),
      header('b-1', 'customer_groups', { customerGroupId: 'vip' }),
      header('b-2', 'organizations', { organizationId: 'own' }),
    ];
    const vector = buyerBookVector(rows, ['own', 'parent'], 'vip');
    expect(vector).toEqual([
      { bookId: 'b-1', audienceKind: 'customer_groups', depth: null },
      { bookId: 'b-2', audienceKind: 'organizations', depth: 0 },
    ]);
    expect(buyerBookVector([...rows].reverse(), ['own', 'parent'], 'vip')).toEqual(vector);
  });

  it('leaves out everyone and system books — they are the same for every buyer of the channel', () => {
    expect(buyerBookVector([BASE, EVERYONE_BOOK], ['own'], 'vip')).toEqual([]);
  });

  it('ignores a member that is neither in the chain nor the effective group', () => {
    expect(
      buyerBookVector([header('b-9', 'organizations', { organizationId: 'stranger' })], ['own'], null),
    ).toEqual([]);
  });
});

describe('pricing profile — the key', () => {
  const vector = [{ bookId: 'b-1', audienceKind: 'organizations' as const, depth: 0 }];

  it('is a stable sha-256 of channel, currency, precedence version and vector', () => {
    const a = profileKey({ channelId: CH, currencyCode: 'PLN', precedenceVersion: 1, vector });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(profileKey({ channelId: CH, currencyCode: 'PLN', precedenceVersion: 1, vector: [...vector] })).toBe(a);
  });

  it('differs when any coordinate differs', () => {
    const a = profileKey({ channelId: CH, currencyCode: 'PLN', precedenceVersion: 1, vector });
    expect(profileKey({ channelId: 'other', currencyCode: 'PLN', precedenceVersion: 1, vector })).not.toBe(a);
    expect(profileKey({ channelId: CH, currencyCode: 'EUR', precedenceVersion: 1, vector })).not.toBe(a);
    expect(profileKey({ channelId: CH, currencyCode: 'PLN', precedenceVersion: 2, vector })).not.toBe(a);
    expect(
      profileKey({ channelId: CH, currencyCode: 'PLN', precedenceVersion: 1, vector: [{ ...vector[0]!, depth: 1 }] }),
    ).not.toBe(a);
  });
});

describe('pricing profile — resolution', () => {
  const rows = [
    BASE,
    EVERYONE_BOOK,
    header('acme', 'organizations', { organizationId: 'acme' }),
    header('vip', 'customer_groups', { customerGroupId: 'vip' }),
    header('gold', 'customer_groups', { customerGroupId: 'gold' }),
  ];

  it('a guest and a buyer with no book of its own share the everyone profile', async () => {
    const { resolver } = resolverOver(rows);
    const guest = await resolver.profileFor({
      channelId: CH,
      currencyCode: 'PLN',
      precedenceVersion: 1,
      organizationChain: [],
      effectiveGroupId: null,
    });
    const gamma = await resolver.profileFor({
      channelId: CH,
      currencyCode: 'PLN',
      precedenceVersion: 1,
      organizationChain: ['gamma'],
      effectiveGroupId: null,
    });
    expect(guest.vector).toEqual([]);
    expect(gamma.key).toBe(guest.key);
    // The books the resolver prices with are the base and the everyone books.
    expect(guest.books.map((b) => b.id).sort()).toEqual(['base', 'everyone-1']);
  });

  it('two organizations meeting the same books share a profile', async () => {
    const shared = [...rows, header('acme', 'organizations', { organizationId: 'beta' })];
    const { resolver } = resolverOver(shared);
    const ask = (org: string) =>
      resolver.profileFor({
        channelId: CH,
        currencyCode: 'PLN',
        precedenceVersion: 1,
        organizationChain: [org],
        effectiveGroupId: 'vip',
      });
    expect((await ask('acme')).key).toBe((await ask('beta')).key);
  });

  it("the customer's own group, through effectiveCustomerGroupId, decides the group books (A2.2, A2.3)", async () => {
    const { resolver } = resolverOver(rows);
    const organization = { id: 'beta', customerGroupId: 'vip' };
    const own = effectiveCustomerGroupId({ customer: { organizationId: 'beta', customerGroupId: 'gold' }, organization });
    const profile = await resolver.profileFor({
      channelId: CH,
      currencyCode: 'PLN',
      precedenceVersion: 1,
      organizationChain: ['beta'],
      effectiveGroupId: own,
    });
    expect(profile.vector.map((v) => v.bookId)).toEqual(['gold']);
    const books = profile.books.find((b) => b.id === 'gold');
    expect(books?.audience).toEqual({ kind: 'customer_groups' });
  });

  it('an organization book carries the depth of the nearest member of the chain', async () => {
    const { resolver } = resolverOver(rows);
    const profile = await resolver.profileFor({
      channelId: CH,
      currencyCode: 'PLN',
      precedenceVersion: 1,
      organizationChain: ['acmew', 'acme'],
      effectiveGroupId: null,
    });
    expect(profile.books.find((b) => b.id === 'acme')?.audience).toEqual({ kind: 'organizations', depth: 1 });
  });

  it('is memoised per organization, group, channel and currency until the generation moves', async () => {
    const memo = new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 });
    const { resolver, calls } = resolverOver(rows, memo);
    const ask = () =>
      resolver.profileFor({
        channelId: CH,
        currencyCode: 'PLN',
        precedenceVersion: 1,
        organizationChain: ['acme'],
        effectiveGroupId: 'vip',
      });
    const first = await ask();
    expect((await ask()).key).toBe(first.key);
    expect(calls).toHaveLength(1);
    memo.invalidateAll();
    await ask();
    expect(calls).toHaveLength(2);
  });
});
