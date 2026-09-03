import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@/lib/api-client';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Feature 025 / T011 — ProductEditor sends sku + status on PATCH save.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

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

function renderEditor(): ReturnType<typeof renderWithSession> {
  return renderProductEditor(
    <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}`]}>
      <Routes>
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
      </Routes>
    </MemoryRouter>,
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
