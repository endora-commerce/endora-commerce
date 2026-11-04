import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { PRODUCT_ID, api, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 172 (T124; US10 #3, FR-093) — with no `product.editor.seo` contributor (`seo` off or
 * absent) the editor shows no SEO tab, sends no SEO request and shows no error; `?tab=seo`
 * falls back to Details, and the URL key and redirects stay on Details.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

describe('the product editor with seo off (feature 172, US10 #3)', () => {
  it('has no SEO tab, reads nothing from seo and keeps the URL key on Details', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global&tab=seo`, contributions: [] });
    expect(await screen.findByLabelText(en['productEditor.field.urlKey']!)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: en['productEditor.tab.seo']! })).toBeNull();
    expect(screen.getByRole('tab', { name: en['productEditor.tab.details']! })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/seo/'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
