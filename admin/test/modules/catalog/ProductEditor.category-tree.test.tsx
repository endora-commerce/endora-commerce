import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

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
const CAT_PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const CAT_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb02';

const BUNDLE = passthroughBundle('catalog', [
  'productEditor.loading',
  'productEditor.section.categories',
  'productEditor.section.categories.help',
  'productEditor.section.identity',
  'productEditor.field.sku',
  'productEditor.field.status',
  'productEditor.field.type',
  'productEditor.field.visibility',
  'productEditor.field.attributeSet',
  'productEditor.attributeSet.loading',
  'productEditor.field.defaultPrice',
  'categoryTreePicker.filter.placeholder',
  'categoryTreePicker.aria.treeLabel',
  'categoryTreePicker.expand',
  'categoryTreePicker.collapse',
  'categoryTreePicker.empty.noCategories',
  'categoryTreePicker.empty.noMatches',
]);

const MOCK_CATEGORIES = [
  {
    id: CAT_PARENT,
    parentCategoryId: null,
    name: { 'en-US': 'Parent Cat' },
    slug: 'parent-cat',
    sortOrder: 1,
  },
  {
    id: CAT_CHILD,
    parentCategoryId: CAT_PARENT,
    name: { 'en-US': 'Child Cat' },
    slug: 'child-cat',
    sortOrder: 1,
  },
];

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'TREE-SKU',
  slug: 'tree-sku',
  type: 'simple' as const,
  status: 'draft' as const,
  name: { 'en-US': 'Tree product' },
  description: { 'en-US': '' },
  visibility: 'public' as const,
  attributeValues: {},
  attributeSetId: '22222222-2222-4222-8222-222222222202',
  categoryIds: [CAT_CHILD],
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) {
      return Promise.resolve({ data: MOCK_CATEGORIES });
    }
    if (path.includes('/attribute-sets')) {
      return Promise.resolve({
        data: [{ id: MOCK_PRODUCT.attributeSetId, code: 'default', name: { 'en-US': 'Default' }, isSystem: true }],
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

describe('ProductEditor — category tree picker (feature 031)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    patchSpy.mockReset();
    primeGets();
    patchSpy.mockResolvedValue({ data: MOCK_PRODUCT });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders category tree checkboxes and persists categoryIds on save', async () => {
    const user = userEvent.setup();
    renderEditor();

    await waitFor(() => {
      expect(screen.queryByText('productEditor.loading')).toBeNull();
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('tree')).toBeTruthy();

    const parentCheckbox = await screen.findByRole('checkbox', { name: 'Parent Cat' });
    expect(parentCheckbox).not.toBeChecked();

    // The picker auto-expands branches up to each selected category, so the
    // pre-selected child row is already visible without a manual expand click.
    const childCheckbox = await screen.findByRole('checkbox', { name: 'Child Cat' });
    expect(childCheckbox).toBeChecked();

    await user.click(parentCheckbox);
    expect(parentCheckbox).toBeChecked();

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    const body = patchSpy.mock.calls[0]?.[1] as { categoryIds?: string[] };
    expect(body.categoryIds).toEqual(expect.arrayContaining([CAT_PARENT, CAT_CHILD]));
  });
});
