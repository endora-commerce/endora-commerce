import { describe, expect, it } from 'vitest';
import type { CatalogCategoryRecord, CatalogProductRecord } from '@endora-commerce/contracts';
import { buildRuleMeta } from './meta-tag-resolver.service.js';

/**
 * Unit-level coverage of the rule builder. The override + locale-fallback
 * paths require a DB row and are exercised by the contract test in
 * test/contract/seo/meta-override.test.ts.
 */

describe('buildRuleMeta', () => {
  it('uses the requested locale when available', () => {
    const product = {
      name: { 'en-US': 'English name', 'pl-PL': 'Polska nazwa' },
      description: { 'en-US': 'English desc', 'pl-PL': 'Polski opis' },
    } as unknown as CatalogProductRecord;
    const meta = buildRuleMeta('product', { product }, 'pl-PL');
    expect(meta.title).toBe('Polska nazwa');
    expect(meta.description).toBe('Polski opis');
    expect(meta.openGraph.title).toBe('Polska nazwa');
  });

  it('falls back to en-US when the requested locale is missing', () => {
    const product = {
      name: { 'en-US': 'Fallback name' },
      description: { 'en-US': 'Fallback desc' },
    } as unknown as CatalogProductRecord;
    const meta = buildRuleMeta('product', { product }, 'de-DE');
    expect(meta.title).toBe('Fallback name');
  });

  it('truncates an over-long title with an ellipsis', () => {
    const long = 'a'.repeat(120);
    const product = {
      name: { 'en-US': long },
      description: { 'en-US': 'short' },
    } as unknown as CatalogProductRecord;
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
