import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import en from '../../../../packages/modules/product_feeds/i18n/en.json';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-044, research
 * R-15): a feed's criteria picker never lists a Page Builder content
 * attribute — its value is a document, which no selection rule can compare.
 */

const ATTRIBUTES = [
  { key: 'color', label: { 'en-US': 'Colour' }, labelDefault: 'Colour', type: 'select' },
  { key: 'buying_guide', label: { 'en-US': 'Buying guide' }, labelDefault: 'Buying guide', type: 'page_builder' },
];

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (path: string) =>
        path.startsWith('/api/v1/admin/catalog/attributes') ? { data: ATTRIBUTES } : { data: [] },
      ),
    },
  };
});

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', () => ({
  productFeedsClient: {
    previewSelection: async () => ({ data: { matchedCount: 1, sample: [] } }),
  },
}));

const { FeedCriteriaPanel } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedCriteriaPanel'
);

const RULE = {
  kind: 'condition',
  field: { kind: 'builtin', key: 'status' },
  op: 'eq',
  values: ['active'],
} as unknown as ProductSelectionRule;

describe('FeedCriteriaPanel — no Page Builder content attribute (feature 172, FR-044)', () => {
  it('lists ordinary attributes and never a page_builder one', async () => {
    renderWithI18n(
      <FeedCriteriaPanel salesChannelId="00000000-0000-4000-8000-000000000001" value={RULE} onChange={vi.fn()} />,
      { product_feeds: en as Record<string, string> },
    );
    await waitFor(() => expect(screen.getByRole('option', { name: 'Colour' })).toBeTruthy());
    const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(values).toContain('attribute:color');
    expect(values).not.toContain('attribute:buying_guide');
    expect(screen.queryByRole('option', { name: 'Buying guide' })).toBeNull();
  });
});
