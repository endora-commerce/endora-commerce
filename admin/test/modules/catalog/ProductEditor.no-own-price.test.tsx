import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 160 (FR-042, FR-043; `plan.md` *What P1 leaves ready for P2* item 5,
 * verified by T134) — a product has no price of its own. The product editor's
 * *Default unit price* field and the variant *Price override* field went with
 * the old model, so P2's base-price zone (`product.editor.pricing.after`) is
 * the only place a product is priced from this screen.
 *
 * The backend refusal of the old fields is asserted in
 * `backend/test/contract/catalog/price-fields-refused.test.ts`; this file holds
 * the admin half, which nothing asserted before T134.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111160';
const SET_ID = '22222222-2222-4222-8222-222222222160';

// The removed keys are in the bundle on purpose: were the field rendered, its
// label would be the key itself and `queryByLabelText` would find it.
const BUNDLE = passthroughBundle('catalog', [
  'productEditor.loading',
  'productEditor.section.identity',
  'productEditor.field.sku',
  'productEditor.field.status',
  'productEditor.field.type',
  'productEditor.field.visibility',
  'productEditor.field.attributeSet',
  'productEditor.field.defaultPrice',
  'productEditor.field.defaultPrice.help',
]);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'NO-OWN-PRICE',
  slug: 'no-own-price',
  type: 'simple' as const,
  status: 'draft' as const,
  name: { 'en-US': 'Test product', 'pl-PL': '' },
  description: { 'en-US': 'Desc', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: {},
  attributeSetId: SET_ID,
};

const CATALOG_I18N = resolve(process.cwd(), '../packages/modules/catalog/i18n');
const REMOVED_KEYS = [
  'productEditor.field.defaultPrice',
  'productEditor.field.defaultPrice.help',
  'productEditor.variants.column.priceOverride',
  'productEditor.variants.field.priceOverride',
];

describe('ProductEditor — a product has no price of its own (160 FR-042, FR-043)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockImplementation((path: string) => {
      if (path.includes('/attribute-sets')) {
        return Promise.resolve({
          data: [{ id: SET_ID, code: 'default', name: { 'en-US': 'Default' }, isSystem: true }],
        });
      }
      if (path.includes(`/catalog/products/${PRODUCT_ID}`)) {
        return Promise.resolve({ data: MOCK_PRODUCT });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders no Default unit price field on the product', async () => {
    renderWithSession(
      <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
        <Routes>
          <Route path="/catalog/products/:id" element={<ProductEditor />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: everyDeclaredModule() }),
        bundle: BUNDLE,
      },
    );
    // The screen has to have rendered, or the absence proves nothing.
    await waitFor(() =>
      expect(screen.queryAllByLabelText('productEditor.field.status').length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText('productEditor.field.defaultPrice')).toBeNull();
    expect(screen.queryByText('productEditor.field.defaultPrice.help')).toBeNull();
  });

  it.each(['en.json', 'pl.json'])('ships no own-price strings in catalog %s', (file) => {
    const bundle = JSON.parse(readFileSync(resolve(CATALOG_I18N, file), 'utf8')) as Record<string, string>;
    expect(REMOVED_KEYS.filter((key) => key in bundle)).toEqual([]);
  });
});
