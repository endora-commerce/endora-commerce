import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/api-client';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

const getSpy = vi.fn();
const deleteSpy = vi.fn();
const navigateSpy = vi.fn();

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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('@/modules/catalog/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

const { ProductEditor } = await import('../../../src/modules/catalog/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';

const BUNDLE_KEYS = [
  'productEditor.loading',
  'productEditor.action.delete',
  'productEditor.deleteConfirm',
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

/**
 * Feature 091 / P4a — the product editor now mounts three admin zones, so it
 * consults `useAdminZone`, which consults the presence predicate. That takes
 * the whole provider stack, exactly as the real screen has: rendering a host
 * screen bare used to work only because it consulted none of them.
 *
 * `renderWithSession` is the seam and the contributions are a **prop**, so a
 * later batch asserts a real contribution here rather than a stub of the
 * enumeration — the same repair P3 made when a permission gate stopped being
 * mockable.
 */
function renderProductEditor(ui: Parameters<typeof renderWithSession>[0]) {
  return renderWithSession(ui, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: everyDeclaredModule() }),
    bundle: BUNDLE,
  });
}

const BUNDLE = passthroughBundle('catalog', BUNDLE_KEYS);

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'DEL-SKU',
  slug: 'del-sku',
  type: 'simple' as const,
  status: 'active' as const,
  name: { 'en-US': 'Delete me', 'pl-PL': '' },
  description: { 'en-US': 'Desc', 'pl-PL': '' },
  visibility: 'public' as const,
  attributeValues: { defaultPrice: 10 },
  attributeSetId: '22222222-2222-4222-8222-222222222202',
};

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) return Promise.resolve({ data: [] });
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

describe('ProductEditor — delete product (feature 032)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    deleteSpy.mockReset();
    navigateSpy.mockReset();
    primeGets();
    deleteSpy.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls DELETE and navigates to products list on confirm', async () => {
    const user = userEvent.setup();
    renderProductEditor(
      <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
        <Routes>
          <Route path="/catalog/products/:id" element={<ProductEditor />} />
        </Routes>
      </MemoryRouter>,
    );

    const deleteBtn = await screen.findByRole('button', { name: /productEditor\.action\.delete/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${PRODUCT_ID}`);
    });
    expect(navigateSpy).toHaveBeenCalledWith('/catalog/products');
  });

  it('shows API error when delete is blocked', async () => {
    deleteSpy.mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'PRODUCT_DELETE_BLOCKED',
          message: 'blocked by orders',
        },
      }),
    );

    const user = userEvent.setup();
    renderProductEditor(
      <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
        <Routes>
          <Route path="/catalog/products/:id" element={<ProductEditor />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /productEditor\.action\.delete/i }));

    expect(await screen.findByText(/blocked by orders/)).toBeInTheDocument();
  });
});
