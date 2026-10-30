import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 (review D3) — the product editor opens on the tab its address names
 * (`?tab=scopes`), which is where the bulk scoped-status result links a refused product.
 * An unknown or hidden tab falls back to Details.
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

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeOverview', () => ({
  ProductScopeOverview: (): string => 'scope overview stub',
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const PRODUCT_ID = '11111111-1111-4111-8111-1111111111d3';
const PRODUCT = {
  id: PRODUCT_ID,
  sku: 'TAB-SKU',
  slug: 'tab-sku',
  type: 'simple',
  status: 'inactive',
  name: { 'en-US': 'Drill' },
  description: {},
  visibility: 'public',
  attributeValues: {},
  attributeSetId: '22222222-2222-4222-8222-2222222222d3',
  archivedAt: null,
};

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) =>
    path === `/api/v1/admin/catalog/products/${PRODUCT_ID}` ? Promise.resolve({ data: PRODUCT }) : Promise.resolve({ data: [] }),
  );
});
afterEach(() => cleanup());

function renderAt(url: string): void {
  render(
    <StrictMode>
      <TranslationProvider language="en" initialBundle={{ catalog: catalogEn as Record<string, string>, core: {} }}>
        {withSession(
          <MemoryRouter initialEntries={[url]}>
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

describe('the product editor opens on the tab its address names', () => {
  it('?tab=scopes opens the scopes tab', async () => {
    renderAt(`/catalog/products/${PRODUCT_ID}?tab=scopes`);
    expect(await screen.findByText('scope overview stub')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: catalogEn['productEditor.tab.scopes'] })).toHaveAttribute('aria-selected', 'true');
  });

  it('an unknown tab opens Details', async () => {
    renderAt(`/catalog/products/${PRODUCT_ID}?tab=nope`);
    expect(await screen.findByRole('tab', { name: /details/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('scope overview stub')).toBeNull();
  });
});
