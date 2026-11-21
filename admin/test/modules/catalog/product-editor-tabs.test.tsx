import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { PRODUCT_ID, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 174 (T096; FR-105, FR-107) — the editor's tab labels come from the catalog bundle and
 * the tab list follows the WAI-ARIA tabs pattern: one tab in the tab order, arrow keys / Home /
 * End move between tabs, `aria-selected` and `aria-controls` on each.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

// The scope map is US12's (T131, T132); its own read is not this test's subject.
vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeOverview', () => ({
  ProductScopeOverview: (): string => 'scope overview stub',
}));

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

describe('the product editor tabs (feature 174, FR-105, FR-107)', () => {
  it('labels every tab from the catalog bundle and links it to the panel', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    const details = await screen.findByRole('tab', { name: en['productEditor.tab.details']! });
    // Issue #1510 (CAT-10): Media and Attachments are one "Media & files" tab, and the Scope map
    // is a drawer, not a tab — a simple product without Channels and SEO contributions has six.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(
      ['details', 'attributes', 'pricing', 'media', 'inventory', 'links'].map((key) => en[`productEditor.tab.${key}`]),
    );
    expect(details).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveAttribute('aria-controls', 'product-tabpanel');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', details.id);
  });

  it('keeps one tab in the tab order and moves with the arrow keys, Home and End', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    const details = await screen.findByRole('tab', { name: en['productEditor.tab.details']! });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([details]);
    fireEvent.keyDown(details, { key: 'ArrowRight' });
    const attributes = screen.getByRole('tab', { name: en['productEditor.tab.attributes']! });
    await waitFor(() => expect(attributes).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(attributes).toHaveFocus());
    fireEvent.keyDown(attributes, { key: 'End' });
    const last = screen.getAllByRole('tab').at(-1)!;
    await waitFor(() => expect(last).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(last, { key: 'Home' });
    await waitFor(() => expect(details).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(details, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getAllByRole('tab').at(-1)).toHaveAttribute('aria-selected', 'true'));
  });
});
