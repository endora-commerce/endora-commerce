import { describe, expect, it } from 'vitest';
import type {
  SettingsReadResult,
  SettingsService,
} from '../../../src/kernel/settings/settings.service.js';
import { HomepageResolver } from '../../../../packages/modules/settings/src/backend/services/homepage-resolver.js';
import { ProductCardButtonsResolver } from '../../../../packages/modules/settings/src/backend/services/product-card-buttons-resolver.js';
import { ShopInfoResolver } from '../../../../packages/modules/settings/src/backend/services/shop-info-resolver.js';
import { SpeculationRulesResolver } from '../../../../packages/modules/settings/src/backend/services/speculation-rules-resolver.js';

/**
 * Feature 075 / D-87 and feature 053 / FR-011 — the four storefront resolvers
 * take the channel the request already resolved.
 *
 * Each of them used to be handed the resolved channel's **code** by its route
 * and to look the id back up with `select id from sales_channels where code = ?`
 * — four identical copies of one statement, eight of the sweep's `sql` reaches,
 * and a re-resolution of a channel the middleware had already resolved. The
 * copies also carried a `system_default = true` fallback for a `code` that is
 * never absent, and a `null` arm that answered "channel not found" with the
 * module's default configuration: a settings read that failed and a shop with
 * nothing configured came out as the same page.
 *
 * The route holds `CachedChannel.id`, so the repair is to pass it. What these
 * cases pin is that: the id the resolver is given is the id the settings read
 * is scoped to, and no resolver takes an `EntityManager` at all — the fake
 * below has no `getConnection`, so a surviving lookup fails on it.
 */

function recordingSettings(
  values: Map<string, SettingsReadResult<unknown>>,
  scopes: string[],
): SettingsService {
  return {
    async getMany(codes: string[], salesChannelId: string) {
      scopes.push(salesChannelId);
      const out = new Map<string, SettingsReadResult<unknown>>();
      for (const code of codes) {
        out.set(code, values.get(code) ?? { ok: false, error: 'not_registered' });
      }
      return out;
    },
  } as unknown as SettingsService;
}

const CHANNEL_ID = '11111111-2222-3333-4444-555555555555';

describe('the storefront resolvers scope their settings read to the resolved channel', () => {
  it('HomepageResolver reads for the id it is given', async () => {
    const scopes: string[] = [];
    const resolver = new HomepageResolver(
      recordingSettings(
        new Map([['homepage_cms_page_slug', { ok: true, value: 'welcome' }]]),
        scopes,
      ),
    );

    expect(await resolver.resolve(CHANNEL_ID)).toEqual({ cmsPageSlug: 'welcome' });
    expect(scopes).toEqual([CHANNEL_ID]);
  });

  it('ShopInfoResolver reads for the id it is given', async () => {
    const scopes: string[] = [];
    const resolver = new ShopInfoResolver(
      recordingSettings(new Map([['shop.name', { ok: true, value: 'Acme' }]]), scopes),
    );

    expect((await resolver.resolve(CHANNEL_ID)).name).toBe('Acme');
    expect(scopes).toEqual([CHANNEL_ID]);
  });

  it('ProductCardButtonsResolver reads for the id it is given', async () => {
    const scopes: string[] = [];
    const resolver = new ProductCardButtonsResolver(
      recordingSettings(
        new Map([['storefront.product_card.show_add_to_cart', { ok: true, value: false }]]),
        scopes,
      ),
    );

    expect((await resolver.resolve(CHANNEL_ID)).showAddToCart).toBe(false);
    expect(scopes).toEqual([CHANNEL_ID]);
  });

  it('SpeculationRulesResolver reads for the id it is given', async () => {
    const scopes: string[] = [];
    const resolver = new SpeculationRulesResolver(
      recordingSettings(
        new Map([['storefront.speculation_rules.eagerness', { ok: true, value: 'eager' }]]),
        scopes,
      ),
    );

    expect(await resolver.resolve(CHANNEL_ID)).toEqual({ enabled: true, eagerness: 'eager' });
    expect(scopes).toEqual([CHANNEL_ID]);
  });
});
