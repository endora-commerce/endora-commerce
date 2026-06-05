import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Regression — swapping the Attribute Set prunes attribute values whose keys
 * are not in the newly-selected set, so the save payload no longer carries
 * orphan keys (which the backend used to reject with ATTRIBUTE_VALUE_REJECTED).
 * The virtual `defaultPrice` key is always kept.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('@/modules/catalog/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

const { ProductEditor } = await import('../../../src/modules/catalog/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';
const SET_A = '22222222-2222-4222-8222-222222222202';
const SET_B = '33333333-3333-4333-8333-333333333303';

const BUNDLE = passthroughBundle('catalog', [
  'productEditor.field.sku',
  'productEditor.field.attributeSet',
  'productEditor.attributeSet.loading',
  'productEditor.field.defaultPrice',
]);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'SWAP-SKU',
  slug: 'swap-sku',
  type: 'simple' as const,
  status: 'draft' as const,
  name: { 'en-US': 'Swap product', 'pl-PL': '' },
  description: { 'en-US': 'Desc', 'pl-PL': '' },
  visibility: 'public' as const,
  // `legacy_attr` belongs to SET_A only; it must be dropped after swapping to SET_B.
  attributeValues: { legacy_attr: 'old-value', defaultPrice: 10 },
  attributeSetId: SET_A,
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) {
      return Promise.resolve({ data: [] });
    }
    // Attribute Set DETAIL (has an id segment) — return the set's attributes.
    if (path.includes(`/attribute-sets/${SET_B}`)) {
      return Promise.resolve({
        data: { attributes: [{ id: 'a-color', key: 'color', label: {}, valueType: 'string', position: 0 }] },
      });
    }
    if (path.includes(`/attribute-sets/${SET_A}`)) {
      return Promise.resolve({
        data: { attributes: [{ id: 'a-legacy', key: 'legacy_attr', label: {}, valueType: 'string', position: 0 }] },
      });
    }
    // Attribute Set LIST.
    if (path.includes('/attribute-sets')) {
      return Promise.resolve({
        data: [
          { id: SET_A, code: 'default', name: { 'en-US': 'Default' }, isSystem: true },
          { id: SET_B, code: 'test', name: { 'en-US': 'Test' }, isSystem: false },
        ],
      });
    }
    if (path.includes(`/catalog/products/${PRODUCT_ID}`)) {
      return Promise.resolve({ data: MOCK_PRODUCT });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderEditor(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
      <Routes>
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('ProductEditor — attribute set swap prunes orphan values', () => {
  beforeEach(() => {
    getSpy.mockReset();
    patchSpy.mockReset();
    primeGets();
    patchSpy.mockResolvedValue({ data: MOCK_PRODUCT });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('drops keys absent from the new set but keeps defaultPrice', async () => {
    const user = userEvent.setup();
    renderEditor();

    const setSelect = await screen.findByLabelText('productEditor.field.attributeSet');
    await user.selectOptions(setSelect, SET_B);

    // Wait for the prune fetch to resolve before saving.
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/attribute-sets/${SET_B}`),
      );
    });

    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });

    const [, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    const attrs = body['attributeValues'] as Record<string, unknown>;
    expect(attrs).not.toHaveProperty('legacy_attr');
    expect(attrs['defaultPrice']).toBe(10);
    expect(body['attributeSetId']).toBe(SET_B);
  });
});
