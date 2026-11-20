import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode } from '@endora-commerce/contracts';
import { PricingCache, type ProfilePricingCacheKey } from './pricing-cache.js';
import { BookPricing, type BookPricingViewer, type CachedBookLine, type ViewerModeKey } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';

/**
 * `specs/182-related-payers/` T056b (FR-120, RP-14, research R-4.7) — a viewer priced for one
 * Organization (the payer, Y) and shown in another's display mode (the buyer, X). The price and
 * the profile are Y's; the display-mode tail (and so the withheld arm) is X's. Absent, nothing
 * changes; the profile key does not move.
 */
describe('BookPricing — displayModeOrganizationId', () => {
  const VIP = 'vip';

  function engine() {
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        const base = { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true, member_organization_id: null, member_customer_group_id: null };
        const vip = { id: 'book-vip', name: 'VIP', type: 'regular', audience_kind: 'customer_groups', priority: 0, is_system: false, member_organization_id: null, member_customer_group_id: VIP };
        if (sql.includes('price_list_audience_members')) return params[1] === VIP ? [base, vip] : [base];
        return [
          { id: 'r-base', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
          { id: 'r-vip', price_list_id: 'book-vip', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'percent', amount: null, percent: '-10.00' },
        ];
      },
    } as unknown as EntityManager;
    // The buyer X shows `net_only`; the payer Y would hide prices (`none`).
    const modes = new Map<string, DisplayMode>([
      ['buyer-x', 'net_only'],
      ['payer-y', 'none'],
    ]);
    const tailReads: Array<string | null> = [];
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({ listVariantsByProductIds: async () => [] }),
      productDisplayModes: async () => new Map(),
      viewerDisplayMode: async ({ organizationId }) => {
        tailReads.push(organizationId);
        return (organizationId ? modes.get(organizationId) : undefined) ?? 'both';
      },
      cache: new PricingCache<CachedBookLine, ProfilePricingCacheKey>({ ttlMs: 60_000 }),
      viewerModeMemo: new PricingCache<DisplayMode, ViewerModeKey>({ ttlMs: 60_000 }),
      profileMemo: new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 }),
    });
    const viewer = (extra: Partial<BookPricingViewer> = {}): BookPricingViewer => ({
      organizationId: 'payer-y',
      customerGroupId: VIP,
      signedIn: true,
      salesChannelId: 'ch',
      currencyCode: 'PLN',
      ...extra,
    });
    const ask = async (v: BookPricingViewer) =>
      (await books.resolve([{ key: 'k', product: { id: 'p1', attributeValues: {} }, quantity: 1 }], v)).get('k');
    return { books, viewer, ask, tailReads };
  }

  it('prices for the priced organisation and shows the display organisation\'s mode', async () => {
    const { ask, viewer, tailReads } = engine();
    const answer = await ask(viewer({ displayModeOrganizationId: 'buyer-x' }));
    expect(answer?.resolution.price?.amount).toBe('90.0000');
    expect(answer?.displayMode).toBe('net_only');
    expect(tailReads).toEqual(['buyer-x']);
  });

  it('absent, the priced organisation\'s own mode applies, as before', async () => {
    const { ask, viewer } = engine();
    expect((await ask(viewer()))?.displayMode).toBe('none');
  });

  it('keeps the profile key: no new cache key for a payer\'s-terms viewer', async () => {
    const { books, viewer } = engine();
    const plain = await books.profilesFor(viewer());
    const shown = await books.profilesFor(viewer({ displayModeOrganizationId: 'buyer-x' }));
    expect(shown!.buyer.key).toBe(plain!.buyer.key);
  });
});
