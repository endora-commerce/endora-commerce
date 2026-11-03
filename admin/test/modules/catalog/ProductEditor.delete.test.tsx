import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { scopedValuesResponse } from '../../helpers/scoped-values-fixtures';

const getSpy = vi.fn();
const deleteSpy = vi.fn();
const navigateSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
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

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';

const BUNDLE_KEYS = [
  'productEditor.loading',
  'productEditor.action.delete',
  'productEditor.deleteConfirm',
  'productEditor.deleteTitle',
  'productEditor.deleteAction',
  'productEditor.wholeProduct.menu',
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
    if (path.includes('/scoped-values')) return Promise.resolve(scopedValuesResponse({ product: { ...scopedValuesResponse().data.product, sku: MOCK_PRODUCT.sku, attributeSetId: MOCK_PRODUCT.attributeSetId } }));
    if (path.endsWith('/editor-preference')) return Promise.resolve({ data: null });
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

/** Delete lives in the "Product" menu and asks in a dialog, not `window.confirm` (feature 170, §11). */
async function deleteThroughMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: /productEditor\.wholeProduct\.menu/ }));
  await user.click(await screen.findByRole('menuitem', { name: /productEditor\.action\.delete/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAccessibleDescription(/productEditor\.deleteConfirm/);
  await user.click(within(dialog).getByRole('button', { name: /productEditor\.deleteAction/ }));
}

describe('ProductEditor — delete product (feature 032)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    deleteSpy.mockReset();
    navigateSpy.mockReset();
    primeGets();
    deleteSpy.mockResolvedValue(undefined);
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

    await deleteThroughMenu(user);

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

    await deleteThroughMenu(user);

    expect(await screen.findByText(/blocked by orders/)).toBeInTheDocument();
  });
});
