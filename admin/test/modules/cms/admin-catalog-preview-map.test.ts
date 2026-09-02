import { describe, expect, it } from 'vitest';
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

describe('mapAdminProductToCmsSummary', () => {
  it('maps admin product fields for CMS preview cards', () => {
    const summary = mapAdminProductToCmsSummary({
      id: '1',
      slug: 'sku-1',
      name: { 'pl-PL': 'Produkt' },
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
    });
  });
});
