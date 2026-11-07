import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../../helpers/render-with-session';
import { scopedValuesResponse } from '../../helpers/scoped-values-fixtures';

/**
 * Issue #410 — the product editor's Variants tab reads the variants through the
 * admin read, `GET /api/v1/admin/catalog/products/:productId/variants`, which
 * answers every variant whatever the product's status or channels. It used the
 * storefront's product read, which answers an inactive product 410 and one
 * outside the request's channel 404, so the operator saw no variants of a
 * product that has them.
 *
 * The storefront read is mocked to answer exactly that refusal, so a section
 * that still reads it shows the load error instead of the variants.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111410';
const PRODUCT = {
  id: PRODUCT_ID,
  sku: 'CONF-410',
  slug: 'conf-410',
  type: 'configurable',
  status: 'inactive',
  name: 'Configurable 410',
  description: {},
  visibility: 'public',
  attributeValues: {},
  attributeSetId: '22222222-2222-4222-8222-222222222410',
  archivedAt: null,
};
const VARIANT = {
  id: '33333333-3333-4333-8333-333333333410',
  parentProductId: PRODUCT_ID,
  sku: 'CONF-410-RED',
  variantAttributeValues: { color: 'red' },
  stockLevel: 4,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function storefrontRefusal(status: 404 | 410): ApiError {
  return new ApiError(status, {
    error: {
      code: status === 410 ? 'PRODUCT_INACTIVE' : 'NOT_FOUND',
      message: status === 410 ? 'Product is inactive.' : 'Product not found.',
      details: [],
    },
  } as never);
}

function mockReads(storefrontStatus: 404 | 410): void {
  getSpy.mockReset();
  getSpy.mockImplementation((raw: unknown) => {
    const path = String(raw);
    if (path.includes('/scoped-values')) {
      return Promise.resolve(
        scopedValuesResponse({ product: { ...scopedValuesResponse().data.product, sku: PRODUCT.sku, type: 'configurable' } }),
      );
    }
    if (path.endsWith('/editor-preference')) return Promise.resolve({ data: null });
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}`) return Promise.resolve({ data: PRODUCT });
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}/variants`) return Promise.resolve({ data: [VARIANT] });
    // The storefront's channel- and status-filtered read refuses this product.
    if (path.startsWith(`/api/v1/catalog/products/${PRODUCT_ID}`)) return Promise.reject(storefrontRefusal(storefrontStatus));
    return Promise.resolve({ data: [] });
  });
}

function renderVariantsTab(): void {
  render(
    <StrictMode>
      <TranslationProvider language="en" initialBundle={{ catalog: catalogEn as Record<string, string>, core: {} }}>
        {withSession(
          <MemoryRouter initialEntries={[`/catalog/products/${PRODUCT_ID}?tab=variants`]}>
            <Routes>
              <Route path="/catalog/products/:id" element={<ProductEditor />} />
            </Routes>
          </MemoryRouter>,
          {
            session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }),
            presence: modulePresence({ present: everyDeclaredModule() }),
          },
        )}
      </TranslationProvider>
    </StrictMode>,
  );
}

afterEach(() => cleanup());

describe('ProductEditor — the Variants tab reads the admin variants endpoint (issue #410)', () => {
  beforeEach(() => getSpy.mockReset());

  it.each([
    ['an inactive product (the storefront read answers 410)', 410 as const],
    ['a product outside the request channel (the storefront read answers 404)', 404 as const],
  ])('shows the variants of %s', async (_label, status) => {
    mockReads(status);
    renderVariantsTab();
    expect(await screen.findByText(VARIANT.sku)).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${PRODUCT_ID}/variants`);
    expect(getSpy.mock.calls.some(([path]) => String(path).startsWith('/api/v1/catalog/products/'))).toBe(false);
  });
});
