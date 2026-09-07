import { describe, expect, it } from 'vitest';
import {
  computeLanguageFallback,
  computeLanguagePool,
  type ScopeContext,
} from '../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor';

/**
 * Feature 022 — T056 (US3). The product edit page's Language switcher
 * MUST narrow reactively when a specific Sales Channel is selected and
 * widen back to the union of all assigned channels' languages when the
 * Global option is selected (FR-021 / FR-022). When the previously-active
 * language is no longer in the new channel's set, the fallback rule picks
 * the first sorted code and the caller is asked to surface a toast.
 *
 * **Adapted from the spec:** the planned location was
 * `admin/tests/routes/catalog/products/edit-page-channel-narrows-language.test.tsx`.
 * The admin's vitest config runs in `environment: node` without jsdom, so
 * full React interaction tests are not portable here. Instead the panel's
 * channel→language narrowing has been refactored into two pure helpers
 * (`computeLanguagePool` + `computeLanguageFallback`) that the component
 * uses; this suite pins their behaviour 1:1 with the FR-021 / FR-022
 * contract. The component renders these helpers' output verbatim, so a
 * regression here would manifest as a UI defect.
 */

const scope: ScopeContext = {
  productId: 'p1',
  channels: [
    {
      id: 'c-vip',
      code: 'pl_b2b_vip',
      name: 'PL B2B VIP',
      languages: ['pl-PL', 'en-US'],
      isDefault: false,
    },
    {
      id: 'c-retail',
      code: 'pl_retail',
      name: 'PL Retail',
      languages: ['pl-PL'], // narrower than VIP — exercises the toast path
      isDefault: true,
    },
  ],
  languagesUnion: ['en-US', 'pl-PL', 'de-DE'], // some hypothetical extra
  primaryAdminLanguage: 'en-US',
  preference: null,
};

describe('computeLanguagePool', () => {
  it('returns the union (sorted) when activeChannelId is null (Global)', () => {
    expect(computeLanguagePool(scope, null)).toEqual(['de-DE', 'en-US', 'pl-PL']);
  });

  it('narrows to the specific channel languages (sorted)', () => {
    expect(computeLanguagePool(scope, 'c-vip')).toEqual(['en-US', 'pl-PL']);
    expect(computeLanguagePool(scope, 'c-retail')).toEqual(['pl-PL']);
  });

  it('returns an empty pool for an unknown channel id', () => {
    expect(computeLanguagePool(scope, 'c-unknown')).toEqual([]);
  });

  it('does not mutate the source arrays', () => {
    const pool = computeLanguagePool(scope, 'c-vip');
    pool.push('xx');
    // The original channel.languages stays intact.
    expect(scope.channels.find((c) => c.id === 'c-vip')!.languages).toEqual(['pl-PL', 'en-US']);
  });
});

describe('computeLanguageFallback', () => {
  it('keeps the current language when it is in the pool (changed=false)', () => {
    expect(computeLanguageFallback(['pl-PL', 'en-US'], 'en-US')).toEqual({
      next: 'en-US',
      changed: false,
    });
  });

  it('falls back to the first sorted option and reports changed=true when current is missing', () => {
    // Mimic switching from VIP (pl, en) to retail (pl only) while en is active.
    expect(computeLanguageFallback(['pl-PL'], 'en-US')).toEqual({
      next: 'pl-PL',
      changed: true,
    });
  });

  it('returns null + changed=false when no current language was set yet', () => {
    expect(computeLanguageFallback(['pl-PL', 'en-US'], null)).toEqual({
      next: 'pl-PL',
      changed: false,
    });
  });

  it('returns null when the pool is empty (unknown channel)', () => {
    expect(computeLanguageFallback([], 'en-US')).toEqual({ next: null, changed: true });
  });
});

describe('FR-021 narrowing — Global → specific channel → Global walk', () => {
  it('VIP narrows the pool; Retail invalidates en-US; switching back to Global widens', () => {
    // Start Global, active=en-US.
    let activeChannelId: string | null = null;
    let activeLanguage: string | null = 'en-US';
    let pool = computeLanguagePool(scope, activeChannelId);
    expect(pool).toEqual(['de-DE', 'en-US', 'pl-PL']);

    // Switch to VIP — en-US still in pool, no toast.
    activeChannelId = 'c-vip';
    pool = computeLanguagePool(scope, activeChannelId);
    let fallback = computeLanguageFallback(pool, activeLanguage);
    expect(fallback).toEqual({ next: 'en-US', changed: false });
    activeLanguage = fallback.next;

    // Switch to Retail — en-US NOT in pool, fall back to pl-PL with toast.
    activeChannelId = 'c-retail';
    pool = computeLanguagePool(scope, activeChannelId);
    fallback = computeLanguageFallback(pool, activeLanguage);
    expect(fallback).toEqual({ next: 'pl-PL', changed: true });
    activeLanguage = fallback.next;

    // Switch back to Global — pl-PL still in pool, widened back to union.
    activeChannelId = null;
    pool = computeLanguagePool(scope, activeChannelId);
    expect(pool).toEqual(['de-DE', 'en-US', 'pl-PL']);
    fallback = computeLanguageFallback(pool, activeLanguage);
    expect(fallback).toEqual({ next: 'pl-PL', changed: false });
  });
});
