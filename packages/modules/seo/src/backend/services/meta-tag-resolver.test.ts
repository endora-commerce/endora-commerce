import { describe, expect, it } from 'vitest';
import type { CatalogCategoryRecord, CatalogProductRecord } from '@endora-commerce/contracts';
import { buildRuleMeta, seoMetaAddress, walkSeoScopes } from './meta-tag-resolver.service.js';
import type { SeoMetaOverride } from '../entities/seo-meta-override.entity.js';

/**
 * Unit-level coverage of the rule builder. The override + locale-fallback
 * paths require a DB row and are exercised by the contract test in
 * test/contract/seo/meta-override.test.ts.
 */

describe('buildRuleMeta', () => {
  // Feature 170: a product's name and description are one Global string (170-shim until T121
  // derives them at (C, L) through `effectiveTexts`).
  it('derives the product rule from the Global texts', () => {
    const product = { name: 'Polska nazwa', description: 'Polski opis' } as unknown as CatalogProductRecord;
    const meta = buildRuleMeta('product', { product }, 'pl-PL');
    expect(meta.title).toBe('Polska nazwa');
    expect(meta.description).toBe('Polski opis');
    expect(meta.openGraph.title).toBe('Polska nazwa');
  });

  it('a product without a description derives an empty one', () => {
    const product = { name: 'Name', description: null } as unknown as CatalogProductRecord;
    expect(buildRuleMeta('product', { product }, 'de-DE').description).toBe('');
  });

  it('truncates an over-long title with an ellipsis', () => {
    const long = 'a'.repeat(120);
    const product = { name: long, description: 'short' } as unknown as CatalogProductRecord;
    const meta = buildRuleMeta('product', { product }, 'en-US');
    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.title.endsWith('…')).toBe(true);
  });

  it('builds a category rule with a generated description', () => {
    const category = {
      name: { 'en-US': 'Widgets' },
    } as unknown as CatalogCategoryRecord;
    const meta = buildRuleMeta('category', { category }, 'en-US');
    expect(meta.title).toBe('Widgets');
    expect(meta.description).toBe('Browse Widgets.');
  });
});

/**
 * Feature 163 (T114, T117a) — the per-field walk channel × language → channel →
 * language → derived, and the addressing rule of a request. The `[PG]` cases in
 * `backend/test/integration/seo/meta-channel-scope.test.ts` cover the same through
 * the route and the table.
 */
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

function row(fields: Partial<SeoMetaOverride>): SeoMetaOverride {
  return { salesChannelId: null, locale: null, title: null, description: null, ogTitle: null, ogDescription: null, ogImageUrl: null, ...fields } as SeoMetaOverride;
}

const fallback = { title: 'Derived', description: 'Derived d', ogTitle: 'Derived og', ogDescription: 'Derived ogd', ogImageUrl: null };

// Feature 170 (FR-010) — C×L → C → Global → derived; a locale-only row is never read.
describe('walkSeoScopes', () => {
  const rows = [
    row({ salesChannelId: C1, locale: 'pl-PL', title: 'CxL' }),
    row({ salesChannelId: C1, title: 'C', description: 'C d' }),
    row({ title: 'G', description: 'G d', ogTitle: 'G og' }),
    row({ locale: 'pl-PL', ogDescription: 'language row' }),
    row({ salesChannelId: C2, locale: 'pl-PL', title: 'other channel' }),
  ];

  it('takes each field from the most specific row that sets it', () => {
    const walked = walkSeoScopes(rows, C1, 'pl-PL', fallback);
    expect(walked).toMatchObject({ title: 'CxL', description: 'C d', ogTitle: 'G og', ogDescription: 'Derived ogd' });
    expect(walked.sources).toEqual({
      title: 'set',
      description: 'inherited_channel',
      ogTitle: 'inherited_global',
      ogDescription: 'derived',
      ogImageUrl: 'derived',
    });
  });

  it('matches the language case-insensitively and never crosses languages or channels', () => {
    expect(walkSeoScopes(rows, C1, 'pl-pl', fallback).title).toBe('CxL');
    expect(walkSeoScopes(rows, C1, 'de-DE', fallback)).toMatchObject({ title: 'C', ogTitle: 'G og' });
    expect(walkSeoScopes(rows, null, 'pl-PL', fallback)).toMatchObject({ title: 'G', description: 'G d' });
    expect(walkSeoScopes([], C1, 'pl-PL', fallback)).toMatchObject(fallback);
  });
});

describe('seoMetaAddress', () => {
  it('reads neither half as the en-US language row, as before feature 163', () => {
    expect(seoMetaAddress({ entityType: 'product', entityId: 'p' })).toEqual({
      entityType: 'product',
      entityId: 'p',
      channelId: null,
      locale: 'en-US',
    });
  });

  it('keeps a channel row without a locale', () => {
    expect(seoMetaAddress({ entityType: 'product', entityId: 'p', channelId: C1 })).toMatchObject({ channelId: C1, locale: null });
  });

  it('refuses a channel on anything but a product', () => {
    expect(() => seoMetaAddress({ entityType: 'category', entityId: 'c', channelId: C1 })).toThrow(
      expect.objectContaining({ statusCode: 422 }),
    );
  });
});
