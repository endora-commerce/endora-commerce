import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef, ScopedValuesResponse } from '@endora-commerce/contracts';
import { PRODUCT_ID, VALID_SCOPES, api, en, renderEditor, scopedField, scopedValuesResponse, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 170 (design review of block 1, WCAG 2.4.3) — focus after a gallery move or removal.
 * A move keeps focus on the moved image's button for the same direction, or on its other one
 * when the image reached an end; a removal moves focus to the gallery heading. While a move is
 * in flight the buttons are `aria-disabled`, not `disabled`, so focus is not dropped.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const IMG = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
const FILE: Record<string, string> = { [IMG[0]!]: 'front.jpg', [IMG[1]!]: 'side.jpg', [IMG[2]!]: 'back.jpg' };
let images: string[] = [];

function read(scope: ScopeRef): ScopedValuesResponse {
  return scopedValuesResponse({
    scope,
    version: '3',
    validScopes: VALID_SCOPES,
    gallery: {
      items: images.map((id, position) => ({
        id,
        assetId: id,
        url: `https://cdn.example.com/${FILE[id]}`,
        position,
        altText: scopedField<string>(null),
        hidden: scopedField(false),
        assetAltText: null,
      })),
      roles: { baseImage: scopedField<string>(null), smallImage: scopedField<string>(null), thumbnail: scopedField<string>(null) },
    },
  });
}

let releaseMove: () => void = () => undefined;

beforeEach(() => {
  images = [...IMG];
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string, body: { orderedGalleryItemIds?: string[] }) => {
    if (path.endsWith('/gallery/order') && body.orderedGalleryItemIds) {
      await new Promise<void>((resolve) => (releaseMove = resolve));
      images = body.orderedGalleryItemIds;
    }
    return { data: null };
  });
  api.delete.mockImplementation(async (path: string) => {
    images = images.filter((id) => id !== path.split('/').pop());
    return undefined;
  });
});
afterEach(() => cleanup());

const MEDIA = `/catalog/products/${PRODUCT_ID}?scope=global&tab=media`;
const row = (id: string): HTMLElement => document.querySelector(`[data-gallery-item="${id}"]`) as HTMLElement;
const moveButton = (id: string, dir: 'up' | 'down'): HTMLElement =>
  within(row(id)).getByRole('button', { name: new RegExp(`^Move Image \\d .* ${dir}$`) });

describe('focus after a gallery move or removal', () => {
  it('a move keeps focus on the moved image, and the buttons stay focusable while it runs', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    await screen.findByRole('button', { name: /^Move Image 1 .* down$/ });
    const down = moveButton(IMG[0]!, 'down');
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(moveButton(IMG[0]!, 'down')).toHaveAttribute('aria-disabled', 'true'));
    expect(moveButton(IMG[0]!, 'down')).not.toBeDisabled();
    expect(moveButton(IMG[0]!, 'down')).toHaveFocus();
    releaseMove();
    // Image 1 is now the second image; focus follows it.
    await waitFor(() => expect(within(row(IMG[0]!)).getByText(/^Image 2/)).toBeInTheDocument());
    await waitFor(() => expect(moveButton(IMG[0]!, 'down')).toHaveFocus());
  });

  it('a move to the end puts focus on the image\'s other button', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    await screen.findByRole('button', { name: /^Move Image 2 .* down$/ });
    const down = moveButton(IMG[1]!, 'down');
    down.focus();
    fireEvent.click(down);
    releaseMove();
    await waitFor(() => expect(within(row(IMG[1]!)).getByText(/^Image 3/)).toBeInTheDocument());
    await waitFor(() => expect(moveButton(IMG[1]!, 'up')).toHaveFocus());
    expect(moveButton(IMG[1]!, 'down')).toHaveAttribute('aria-disabled', 'true');
  });

  it('the first image\'s Move up is aria-disabled and does nothing', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    await screen.findByRole('button', { name: /^Move Image 1 .* up$/ });
    const up = moveButton(IMG[0]!, 'up');
    expect(up).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(up);
    expect(api.put).not.toHaveBeenCalledWith(expect.stringContaining('/gallery/order'), expect.anything());
  });

  it('a removal moves focus to the gallery heading', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    fireEvent.click(await screen.findByRole('button', { name: /Remove Image 2/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en['productEditor.gallery.removeConfirm']! }));
    await waitFor(() => expect(row(IMG[1]!)).toBeNull());
    await waitFor(() => expect(document.getElementById('product-gallery-heading')).toHaveFocus());
  });
});
