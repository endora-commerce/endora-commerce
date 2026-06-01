import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@b2b/api-client';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 025 / T011 — ProductEditor sends sku + status on PATCH save.
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

const BUNDLE_KEYS = [
  'productEditor.loading',
  'productEditor.section.identity',
  'productEditor.field.sku',
  'productEditor.field.status',
  'productEditor.field.status.help',
  'productEditor.field.type',
  'productEditor.field.visibility',
  'productEditor.field.attributeSet',
  'productEditor.attributeSet.loading',
  'productEditor.field.defaultPrice',
];

const BUNDLE = passthroughBundle('catalog', BUNDLE_KEYS);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'EDIT-SKU-OLD',
  slug: 'edit-sku-old',
  type: 'simple' as const,
  status: 'draft' as const,
  name: { 'en-US': 'Test product', 'pl-PL': '' },
  description: { 'en-US': 'Desc', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: { defaultPrice: 10 },
  attributeSetId: '22222222-2222-4222-8222-222222222202',
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) {
      return Promise.resolve({ data: [] });
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

describe('ProductEditor — SKU and status save (feature 025)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    patchSpy.mockReset();
    primeGets();
    patchSpy.mockResolvedValue({ data: { ...MOCK_PRODUCT, sku: 'EDIT-SKU-NEW', status: 'active' } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('PATCH body includes sku and status when Save is clicked', async () => {
    const user = userEvent.setup();
    renderEditor();

    const skuInput = await screen.findByLabelText('productEditor.field.sku');
    await user.clear(skuInput);
    await user.type(skuInput, 'EDIT-SKU-NEW');

    const statusSelect = screen.getByLabelText('productEditor.field.status');
    await user.selectOptions(statusSelect, 'active');

    const saveBtn = screen.getByRole('button', { name: /Save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(`/api/v1/admin/catalog/products/${PRODUCT_ID}`);
    expect(body['sku']).toBe('EDIT-SKU-NEW');
    expect(body['status']).toBe('active');
  });

  it('status select offers inactive (not archived)', async () => {
    renderEditor();
    const statusSelect = await screen.findByLabelText('productEditor.field.status');
    const options = Array.from(statusSelect.querySelectorAll('option')).map((o) => o.value);
    expect(options).toContain('inactive');
    expect(options).not.toContain('archived');
  });

  it('surfaces sku_in_use error from the API', async () => {
    const user = userEvent.setup();
    patchSpy.mockRejectedValueOnce(
      new ApiError(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'sku_in_use { conflictingSku: TAKEN }',
        },
      }),
    );

    renderEditor();

    const skuInput = await screen.findByLabelText('productEditor.field.sku');
    await user.clear(skuInput);
    await user.type(skuInput, 'TAKEN-SKU');

    await user.click(screen.getByRole('button', { name: /Save/i }));

    expect(await screen.findByText(/sku_in_use/)).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });
});
