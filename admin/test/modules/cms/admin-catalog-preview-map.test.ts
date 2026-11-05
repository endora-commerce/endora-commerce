import { describe, expect, it } from 'vitest';
import { PRODUCT_SUMMARY_MAX_LENGTH, productSummaryText } from '@endora-commerce/contracts';
import {
  mapAdminProductToCmsSummary,
  pickAdminLocalizedName,
} from '../../../../packages/modules/cms/src/admin/components/admin-catalog-preview-map';

describe('pickAdminLocalizedName', () => {
  it('returns string names as-is', () => {
    expect(pickAdminLocalizedName('Widget', 'fallback')).toBe('Widget');
  });

  it('prefers pl-PL then en-US', () => {
    expect(pickAdminLocalizedName({ 'en-US': 'En', 'pl-PL': 'Pl' }, 'x')).toBe('Pl');
    expect(pickAdminLocalizedName({ 'en-US': 'En' }, 'x')).toBe('En');
  });
});

// Feature 174 (FR-031, `contracts/readers.md` §1) — the admin catalogue answers a product's Global
// name and description as strings; the preview card shows them as they are.
describe('mapAdminProductToCmsSummary', () => {
  it('maps admin product fields for CMS preview cards', () => {
    const summary = mapAdminProductToCmsSummary({
      id: '1',
      slug: 'sku-1',
      name: 'Produkt',
      sku: 'SKU-1',
    });
    expect(summary).toEqual({
      id: '1',
      slug: 'sku-1',
      name: 'Produkt',
      sku: 'SKU-1',
      primaryAssetUrl: null,
      price: null,
      stockLevel: null,
      summary: null,
    });
  });

  it('falls back to the slug when the Global name is empty', () => {
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 'sku-1', name: '', sku: 'SKU-1' }).name).toBe('sku-1');
  });

  // Feature 163, T196: the editor's preview cards show the summary the storefront's do —
  // the description's plain text, cut at a word boundary.
  it('derives the card summary from the Global description, as the storefront does', () => {
    const description = '<p>Lity <strong>dąb</strong> &amp; stal.</p>';
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description }).summary).toBe(
      productSummaryText(description),
    );
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description }).summary).toBe('Lity dąb & stal.');
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description: 'x '.repeat(200) }).summary!.length).toBeLessThanOrEqual(
      PRODUCT_SUMMARY_MAX_LENGTH,
    );
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description: null }).summary).toBeNull();
  });
});
