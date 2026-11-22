import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #1459 (UX audit CAT-14) — the SKU label is "SKU". The editor's
 * read-only control already shows that it cannot change, so the label no
 * longer says "(immutable after creation)"; the create form, where the SKU is
 * still typed, says it once, as the input's one-line hint.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() },
}));

const { ProductCreateForm } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductCreateForm');

describe('ProductCreateForm — SKU', () => {
  it('is labelled SKU and described by the hint that it cannot be changed later', async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={['/catalog/products/new']}>
        <ProductCreateForm />
      </MemoryRouter>,
      passthroughBundle('catalog', ['productEditor.field.sku', 'productEditor.field.sku.createHint']),
    );
    const sku = await screen.findByRole('textbox', { name: 'productEditor.field.sku' });
    expect(sku).toHaveAccessibleDescription('productEditor.field.sku.createHint');
  });
});
