import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * UX audit slice S15 (#1492, #1502) — the create form moves off the last
 * `.b2b-card` onto the kit `Card` and `FormField`. A missing SKU or name is
 * said beside the field it concerns, linked to it (`aria-invalid`,
 * `aria-describedby`; WCAG 3.3.1), rather than only in a banner above the
 * form, and the first invalid field takes focus.
 */

const post = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: vi.fn(async () => ({ data: [] })), post },
}));

const { ProductCreateForm } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductCreateForm');

const KEYS = [
  'productEditor.field.sku',
  'productEditor.field.name',
  'productEditor.field.sku.createHint',
  'productEditor.error.skuRequired',
  'productEditor.error.nameRequired',
  'productEditor.save.action',
];

function renderForm(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/catalog/products/new']}>
      <ProductCreateForm />
    </MemoryRouter>,
    passthroughBundle('catalog', KEYS),
  );
}

describe('ProductCreateForm — validation', () => {
  it('marks an empty SKU invalid, describes it by the error and focuses it', async () => {
    renderForm();
    const sku = await screen.findByRole('textbox', { name: 'productEditor.field.sku' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'productEditor.save.action' }));
    });
    expect(sku).toHaveAttribute('aria-invalid', 'true');
    expect(sku).toHaveAccessibleDescription(/productEditor\.error\.skuRequired/);
    expect(sku).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });

  it('marks an empty name invalid once the SKU is filled', async () => {
    renderForm();
    const sku = await screen.findByRole('textbox', { name: 'productEditor.field.sku' });
    fireEvent.change(sku, { target: { value: 'SKU-1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'productEditor.save.action' }));
    });
    const name = screen.getByRole('textbox', { name: 'productEditor.field.name' });
    expect(sku).not.toHaveAttribute('aria-invalid');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/productEditor\.error\.nameRequired/);
    expect(name).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });
});
