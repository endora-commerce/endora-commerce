import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef, ScopedValuesResponse } from '@endora-commerce/contracts';
import {
  BASE,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 172 (T146; FR-070, US7 #7, spec *Edge Cases*, R7) — structural operations apply at
 * once: each such section says "Applies immediately", an immediate action neither stages nor
 * saves, staged scoped edits survive it, a staged edit of the subject it removed is dropped and
 * announced, and the next Save sends the version read before the immediate action.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

// The stock panel's own reads are not this test's subject; its heading is the host's.
vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductInventoryTab', () => ({
  ProductInventoryTab: (): string => 'stock panel stub',
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const IMG_A = '00000000-0000-4000-8000-0000000000a1';
const IMG_B = '00000000-0000-4000-8000-0000000000a2';
const ATT = '00000000-0000-4000-8000-0000000000b1';

let images = [IMG_A, IMG_B];
let attachments = [ATT];

function item(id: string, position: number) {
  return {
    id,
    assetId: id,
    url: `https://cdn.example.com/${id === IMG_A ? 'front' : 'side'}.jpg`,
    position,
    altText: scopedField<string>(id === IMG_A ? 'Front' : 'Side'),
    hidden: scopedField(false),
    assetAltText: null,
  };
}

function read(scope: ScopeRef): ScopedValuesResponse {
  return scopedValuesResponse({
    scope,
    version: '3',
    validScopes: VALID_SCOPES,
    gallery: {
      items: images.map((id, i) => item(id, i)),
      roles: { baseImage: scopedField<string>(IMG_A), smallImage: scopedField<string>(null), thumbnail: scopedField<string>(null) },
    },
    attachments: attachments.map((id, i) => ({
      id,
      assetId: id,
      typeId: id,
      position: i,
      fileName: 'manual.pdf',
      name: scopedField('Manual'),
      description: scopedField<string>(null),
      hidden: scopedField(false),
    })),
  });
}

beforeEach(() => {
  images = [IMG_A, IMG_B];
  attachments = [ATT];
  setUpEditorApi({ read });
  api.delete.mockImplementation(async (path: string) => {
    const id = path.split('/').pop()!;
    images = images.filter((i) => i !== id);
    attachments = attachments.filter((a) => a !== id);
    return undefined;
  });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'global' }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

const MEDIA = `/catalog/products/${PRODUCT_ID}?scope=global&tab=media`;

function removeImage(name: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en['productEditor.gallery.removeConfirm']! }));
}

describe('immediate actions beside staged changes (feature 172, US7 #7)', () => {
  it('labels each structural section "Applies immediately"', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    const heading = await screen.findByRole('heading', { name: new RegExp(en['productEditor.gallery.title']!) });
    expect(heading).toHaveTextContent(en['productEditor.immediate.badge']!);
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.attachments']! }));
    expect(await screen.findByRole('heading', { name: new RegExp(en['productEditor.attachments.title']!) })).toHaveTextContent(
      en['productEditor.immediate.badge']!,
    );
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.inventory']! }));
    expect(await screen.findByRole('heading', { name: new RegExp(en['productEditor.stock.title']!) })).toHaveTextContent(
      en['productEditor.immediate.badge']!,
    );
  });

  it('removing an image keeps the staged edits, stages nothing, and the next Save sends the version read first', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    const alt = await screen.findByLabelText(/Alt text of Image 1/);
    fireEvent.change(alt, { target: { value: 'Front view' } });
    removeImage(/Remove Image 2/);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/gallery/${IMG_B}`));
    await waitFor(() => expect(screen.queryByLabelText(/Alt text of Image 2/)).toBeNull());
    expect(screen.getByLabelText(/Alt text of Image 1/)).toHaveValue('Front view');
    expect(api.put).not.toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything()));
    const [, body] = api.put.mock.calls.find(([path]) => path === `${BASE}/scoped-values`)!;
    expect(body).toEqual({ scope: {}, version: '3', changes: { gallery: { items: { [IMG_A]: { altText: 'Front view' } } } } });
  });

  it('drops and announces the staged edit of the image it removed', async () => {
    renderEditor(ProductEditor, { url: MEDIA });
    fireEvent.change(await screen.findByLabelText(/Alt text of Image 2/), { target: { value: 'Side view' } });
    expect(screen.getByRole('button', { name: /^Save 1 change/ })).toBeEnabled();
    removeImage(/Remove Image 2/);
    await waitFor(() => expect(screen.getByTestId('editor-announcer')).toHaveTextContent(en['productEditor.immediate.droppedImage']!));
    expect(screen.getByRole('button', { name: new RegExp(`^${en['productEditor.save.action']}`) })).toHaveAttribute('aria-disabled', 'true');
  });

  it('offers the structural controls at Global only', async () => {
    renderEditor(ProductEditor, {
      url: `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${VALID_SCOPES.channels[0]!.channelId}&tab=media`,
    });
    await screen.findByRole('textbox', { name: /^Alt text of Image 1/ });
    expect(screen.queryByRole('button', { name: /Remove Image/ })).toBeNull();
    expect(screen.getByText(en['productEditor.gallery.setGlobalOnly']!)).toBeInTheDocument();
  });
});
