import { createHash } from 'node:crypto';
import type { PricingCache } from './pricing-cache.js';
import type { BookAudience, ResolverBook } from './book-resolver.js';

/**
 * The pricing profile — feature 160, research R6, `contracts/price-surface.md` §1.
 *
 * The price a buyer pays depends on the buyer through **which books apply and
 * at which chain depth**, and on nothing else: resolution reads the buyer's
 * organization chain and effective customer group only to decide that. So the
 * profile — the sorted vector of applicable buyer books `(book, audience kind,
 * depth)`, plus channel, currency and precedence version — is what the pricing
 * cache and the price surface key on. Every organization without a book of its
 * own shares its group's profile; every member of an organization-set book
 * shares it; guests and buyers with no buyer book share the **everyone
 * profile** (an empty vector). This is OroCommerce's combined-price-list
 * sharing (`specs/pricing/peer-platforms.md` §2.4), and it replaces the
 * organization in the old cache key, whose hit rate was 5.3 % at 50
 * organizations.
 *
 * Resolution costs **one** statement (the applicable books of the channel and
 * currency joined to the members the buyer can meet), memoised per
 * organization chain, group, channel and currency under the pricing
 * generation. The statement itself is the caller's — `PricingService` builds it
 * with the channel bridge's sanctioned subquery — so this file stays pure
 * enough to unit-test.
 */

/** One row of the applicable-books statement: a book, and the member that matched (if any). */
export interface ApplicableBookRow {
  id: string;
  name: string;
  /** `base` is the old engine's name for `regular`. */
  type: 'base' | 'regular' | 'sale';
  audienceKind: 'everyone' | 'customer_groups' | 'organizations';
  priority: number;
  isSystem: boolean;
  memberOrganizationId: string | null;
  memberCustomerGroupId: string | null;
}

export interface ApplicableBooksQuery {
  channelId: string;
  currencyCode: string;
  /** The buyer's organization chain, nearest first; empty for a guest. */
  organizationIds: readonly string[];
  customerGroupId: string | null;
}

export type ApplicableBooksLoader = (query: ApplicableBooksQuery) => Promise<ApplicableBookRow[]>;

/** One applicable buyer book in a profile's vector. */
export interface ProfileVectorEntry {
  bookId: string;
  audienceKind: 'organizations' | 'customer_groups';
  /** Chain depth of the nearest matching organization; `null` for a group book. */
  depth: number | null;
}

export interface PricingProfile {
  /** sha-256 of the canonical (channel, currency, precedence version, vector). */
  key: string;
  channelId: string;
  currencyCode: string;
  precedenceVersion: number;
  vector: ProfileVectorEntry[];
  /** Every applicable book — base, everyone and the buyer's — as the resolver reads them. */
  books: ResolverBook[];
}

/** What the profile memo is keyed on. */
export interface ProfileMemoKey {
  organizationChain: string;
  customerGroupId: string | null;
  channelId: string;
  currencyCode: string;
  precedenceVersion: number;
}

/**
 * The applicable **buyer** books of the rows, sorted by book id, each with the
 * depth of the nearest chain member that matched. Everyone and system books
 * are not part of it: they are the same for every buyer of the channel.
 */
export function buyerBookVector(
  rows: readonly ApplicableBookRow[],
  organizationChain: readonly string[],
  customerGroupId: string | null,
): ProfileVectorEntry[] {
  const byBook = new Map<string, ProfileVectorEntry>();
  for (const row of rows) {
    if (row.isSystem || row.audienceKind === 'everyone') continue;
    if (row.audienceKind === 'organizations') {
      const depth = row.memberOrganizationId === null ? -1 : organizationChain.indexOf(row.memberOrganizationId);
      if (depth < 0) continue;
      const held = byBook.get(row.id);
      if (!held || (held.depth ?? Infinity) > depth) {
        byBook.set(row.id, { bookId: row.id, audienceKind: 'organizations', depth });
      }
      continue;
    }
    if (customerGroupId === null || row.memberCustomerGroupId !== customerGroupId) continue;
    byBook.set(row.id, { bookId: row.id, audienceKind: 'customer_groups', depth: null });
  }
  return [...byBook.values()].sort((a, b) => (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0));
}

/** The profile's stable key. */
export function profileKey(input: {
  channelId: string;
  currencyCode: string;
  precedenceVersion: number;
  vector: readonly ProfileVectorEntry[];
}): string {
  const canonical = JSON.stringify([
    input.channelId,
    input.currencyCode.toUpperCase(),
    input.precedenceVersion,
    input.vector.map((v) => [v.bookId, v.audienceKind, v.depth]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export class PricingProfileResolver {
  constructor(
    private readonly load: ApplicableBooksLoader,
    private readonly memo?: PricingCache<PricingProfile, ProfileMemoKey>,
  ) {}

  async profileFor(input: {
    channelId: string;
    currencyCode: string;
    precedenceVersion: number;
    organizationChain: readonly string[];
    /** The buyer's one effective customer group (`effectiveCustomerGroupId`). */
    effectiveGroupId: string | null;
  }): Promise<PricingProfile> {
    const currencyCode = input.currencyCode.toUpperCase();
    const memoKey: ProfileMemoKey = {
      organizationChain: input.organizationChain.join(','),
      customerGroupId: input.effectiveGroupId,
      channelId: input.channelId,
      currencyCode,
      precedenceVersion: input.precedenceVersion,
    };
    const cached = this.memo?.get(memoKey);
    if (cached) return cached;
    const generation = this.memo?.generation;

    const rows = await this.load({
      channelId: input.channelId,
      currencyCode,
      organizationIds: input.organizationChain,
      customerGroupId: input.effectiveGroupId,
    });
    const vector = buyerBookVector(rows, input.organizationChain, input.effectiveGroupId);
    const depths = new Map(vector.map((v) => [v.bookId, v]));
    const books = new Map<string, ResolverBook>();
    for (const row of rows) {
      if (books.has(row.id)) continue;
      let audience: BookAudience;
      if (row.isSystem || row.audienceKind === 'everyone') audience = { kind: 'everyone' };
      else {
        const entry = depths.get(row.id);
        if (!entry) continue;
        audience =
          entry.audienceKind === 'organizations'
            ? { kind: 'organizations', depth: entry.depth ?? 0 }
            : { kind: 'customer_groups' };
      }
      books.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.type === 'sale' ? 'sale' : 'regular',
        isSystem: row.isSystem,
        priority: row.priority,
        audience,
      });
    }
    const profile: PricingProfile = {
      key: profileKey({ channelId: input.channelId, currencyCode, precedenceVersion: input.precedenceVersion, vector }),
      channelId: input.channelId,
      currencyCode,
      precedenceVersion: input.precedenceVersion,
      vector,
      books: [...books.values()],
    };
    this.memo?.set(memoKey, profile, generation);
    return profile;
  }
}
