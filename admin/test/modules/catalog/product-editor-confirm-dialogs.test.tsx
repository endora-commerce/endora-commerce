import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BASE, PRODUCT_ID, VALID_SCOPES, api, en, renderEditor, scopedValuesResponse, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 174, final design review: the editor asks in the kit's `ModalDialog`, never through
 * `window.confirm`. A structural removal (here a related product) opens a dialog that applies on
 * its destructive button and does nothing on Cancel; the Duplicate and Delete dialogs name the
 * product and say what becomes of the unsaved changes. A failed read of the category or attribute
 * set list is an error with a retry, never an empty list.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const LINK_ID = '00000000-0000-4000-8000-0000000001a1';
const TARGET_ID = '00000000-0000-4000-8000-0000000001b1';

const sub = (key: string, params: Record<string, string>): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key]!);

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setUpEditorApi({
    read: (scope) => scopedValuesResponse({ scope, validScopes: VALID_SCOPES }),
    extra: (path) =>
      path === `${BASE}/links`
        ? { data: [{ id: LINK_ID, sourceProductId: PRODUCT_ID, targetProductId: TARGET_ID, kind: 'related', position: 0 }] }
        : undefined,
  });
  api.post.mockImplementation(async (path: string) =>
    path === '/api/v1/admin/catalog/products/batch-by-id'
      ? { data: [{ id: TARGET_ID, sku: 'TARGET-1', name: 'Target', status: 'active' }], pagination: { hasMore: false } }
      : { data: null },
  );
  api.delete.mockResolvedValue(undefined);
  confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

afterEach(() => {
  confirmSpy.mockRestore();
  cleanup();
});

const LINKS = `/catalog/products/${PRODUCT_ID}?scope=global&tab=links`;

async function openLinkRemoval(): Promise<HTMLElement> {
  const remove = await screen.findByRole('button', { name: en['productEditor.links.action.remove']! });
  fireEvent.click(remove);
  return screen.findByRole('dialog', { name: en['productEditor.links.removeConfirm']! });
}

describe('editor confirmations are dialogs (feature 174, final design review)', () => {
  it('removes a related product only from the dialog, and Cancel removes nothing', async () => {
    renderEditor(ProductEditor, { url: LINKS });

    const first = await openLinkRemoval();
    expect(first).toHaveAccessibleDescription(en['productEditor.confirmRemoval.body']!);
    fireEvent.click(within(first).getByRole('button', { name: en['productEditor.archive.cancel']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();

    const second = await openLinkRemoval();
    fireEvent.click(within(second).getByRole('button', { name: en['productEditor.confirmRemoval.confirm']! }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/links/${LINK_ID}`));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('names the product in the Duplicate and Delete dialogs and says what happens to unsaved changes', async () => {
    const user = userEvent.setup();
    renderEditor(ProductEditor);
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    const product = (name as HTMLInputElement).value;

    await user.click(screen.getByRole('button', { name: en['productEditor.wholeProduct.menu']! }));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(en['productEditor.action.duplicate']!) }));
    let dialog = await screen.findByRole('dialog', { name: sub('productEditor.duplicateTitle', { product }) });
    expect(dialog).not.toHaveTextContent(en['productEditor.duplicateUnsaved']!);
    await user.click(within(dialog).getByRole('button', { name: en['productEditor.archive.cancel']! }));

    fireEvent.change(name, { target: { value: `${product} edited` } });
    await user.click(screen.getByRole('button', { name: en['productEditor.wholeProduct.menu']! }));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(en['productEditor.action.duplicate']!) }));
    dialog = await screen.findByRole('dialog', { name: sub('productEditor.duplicateTitle', { product }) });
    expect(dialog).toHaveTextContent(en['productEditor.duplicateUnsaved']!);
    await user.click(within(dialog).getByRole('button', { name: en['productEditor.archive.cancel']! }));

    await user.click(screen.getByRole('button', { name: en['productEditor.wholeProduct.menu']! }));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(en['productEditor.action.delete']!) }));
    dialog = await screen.findByRole('dialog', { name: sub('productEditor.deleteTitle', { product }) });
    expect(dialog).toHaveTextContent(en['productEditor.deleteUnsaved']!);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('shows a failed reference-list read as an error with a retry, not as "No categories"', async () => {
    let failing = true;
    setUpEditorApi({
      extra: (path) => {
        if (path === '/api/v1/admin/catalog/categories') {
          if (failing) throw new Error('network');
          return { data: [{ id: TARGET_ID, parentCategoryId: null, name: { en: 'Drills' }, slug: 'drills', sortOrder: 0 }] };
        }
        return undefined;
      },
    });
    renderEditor(ProductEditor);
    const alert = await screen.findByTestId('product-reference-error');
    expect(alert).toHaveTextContent(en['productEditor.reference.error']!);
    expect(screen.queryByText(/No categories/i)).toBeNull();
    expect(screen.getByText(en['productEditor.reference.categoriesUnavailable']!)).toBeInTheDocument();

    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: en['productEditor.reference.retry']! }));
    await waitFor(() => expect(screen.queryByTestId('product-reference-error')).toBeNull());
    expect(await screen.findByText('Drills')).toBeInTheDocument();
  });
});
