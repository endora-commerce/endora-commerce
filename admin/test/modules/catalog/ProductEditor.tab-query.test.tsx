import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PRODUCT_ID, currentSearch, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 163 (review D3), reshaped by issue #1510 (UX audit CAT-10, DEC-09) — the product editor
 * opens on the tab its address names, and the Scope map is a drawer its address opens
 * (`?scopeMap=1`), which is where the bulk scoped-status result links a refused product. The tab
 * ids the merge removed still land: `?tab=scopes` opens the drawer, `?tab=attachments` the
 * "Media & files" tab, each rewritten to the current address. An unknown or hidden tab falls back
 * to Details.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeOverview', () => ({
  ProductScopeOverview: (): string => 'scope overview stub',
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const url = (query: string): string => `/catalog/products/${PRODUCT_ID}?scope=global&${query}`;

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

describe('the product editor opens on the tab its address names', () => {
  it('?scopeMap=1 opens the Scope map drawer over the Details tab', async () => {
    renderEditor(ProductEditor, { url: url('scopeMap=1') });
    const drawer = await screen.findByRole('dialog', { name: en['productEditor.scope.scopeMap']! });
    expect(within(drawer).getByText('scope overview stub')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: en['productEditor.tab.details']! })).toHaveAttribute('aria-selected', 'true');
  });

  it('?tab=scopes (the removed tab) opens the drawer and is rewritten to ?scopeMap=1', async () => {
    const view = renderEditor(ProductEditor, { url: url('tab=scopes') });
    expect(await screen.findByRole('dialog', { name: en['productEditor.scope.scopeMap']! })).toBeInTheDocument();
    await waitFor(() => expect(currentSearch(view).get('scopeMap')).toBe('1'));
    expect(currentSearch(view).get('tab')).toBeNull();
    expect(screen.queryByRole('tab', { name: en['productEditor.scope.scopeMap']! })).toBeNull();
  });

  it('?tab=attachments (the removed tab) opens "Media & files" and is rewritten to ?tab=media', async () => {
    const view = renderEditor(ProductEditor, { url: url('tab=attachments') });
    const media = await screen.findByRole('tab', { name: en['productEditor.tab.media']! });
    await waitFor(() => expect(media).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(currentSearch(view).get('tab')).toBe('media'));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: new RegExp(en['productEditor.gallery.title']!) })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: new RegExp(en['productEditor.attachments.title']!) })).toBeInTheDocument();
  });

  it('the scope bar link opens the drawer, and closing it drops ?scopeMap', async () => {
    const view = renderEditor(ProductEditor, { url: url('tab=pricing') });
    const link = await screen.findByRole('button', { name: en['productEditor.scope.scopeMap']! });
    expect(link).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(link);
    const drawer = await screen.findByRole('dialog', { name: en['productEditor.scope.scopeMap']! });
    await waitFor(() => expect(currentSearch(view).get('scopeMap')).toBe('1'));
    expect(currentSearch(view).get('tab')).toBe('pricing');
    fireEvent.click(within(drawer).getByRole('button', { name: en['productEditor.scopeMap.close']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentSearch(view).get('scopeMap')).toBeNull();
    expect(currentSearch(view).get('tab')).toBe('pricing');
  });

  it('an unknown tab opens Details', async () => {
    renderEditor(ProductEditor, { url: url('tab=nope') });
    expect(await screen.findByRole('tab', { name: en['productEditor.tab.details']! })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('scope overview stub')).toBeNull();
  });
});
