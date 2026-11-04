import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { ErrorCode, ScopeRef } from '@endora-commerce/contracts';
import { BASE, PRODUCT_ID, VALID_SCOPES, api, en, renderEditor, scopedValuesResponse, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 172 (S1 block 4; `contracts/scoped-values-api.md` §3 step 3a) — the Save's Global-only
 * refusals land beside their field: a taken SKU (`409 SKU_ALREADY_EXISTS`), an attribute set or a
 * category that no longer exists (`422 SCOPED_VALUE_INVALID`, `product.*` paths), a required
 * attribute left empty; the download rules, which the editor has no field for, as one message;
 * and a Save naming SEO cells while seo is off (`503 MODULE_DISABLED`).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const URL_G = `/catalog/products/${PRODUCT_ID}?scope=global`;
const read = (scope: ScopeRef) => scopedValuesResponse({ scope, version: '4', validScopes: VALID_SCOPES });

function refuse(status: number, code: ErrorCode, details: Record<string, unknown>): void {
  api.put.mockImplementation(async (path: string) => {
    if (path.endsWith('/scoped-values')) throw new ApiError(status, { error: { code, message: 'refused', details } });
    return { data: null };
  });
}

async function saveAChange(): Promise<void> {
  const sku = await screen.findByLabelText(en['productEditor.field.sku']!);
  fireEvent.change(sku, { target: { value: 'SKU-TAKEN' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything()));
}

beforeEach(() => setUpEditorApi({ read }));
afterEach(() => cleanup());

describe('Global-only save refusals beside their field (feature 172)', () => {
  it('a taken SKU marks the SKU field and focuses it', async () => {
    refuse(409, 'SKU_ALREADY_EXISTS', { field: 'product.sku' });
    renderEditor(ProductEditor, { url: URL_G });
    await saveAChange();
    const sku = screen.getByLabelText(en['productEditor.field.sku']!);
    await waitFor(() => expect(sku).toHaveAttribute('aria-invalid', 'true'));
    expect(sku).toHaveAccessibleDescription(expect.stringContaining(en['errors.SKU_ALREADY_EXISTS']!));
    await waitFor(() => expect(sku).toHaveFocus());
  });

  it('an attribute set that no longer exists marks the attribute set, and the change is kept', async () => {
    refuse(422, 'SCOPED_VALUE_INVALID', { fields: [{ field: 'product.attributeSetId', scope: { level: 'global' }, reason: 'subject_not_found' }] });
    renderEditor(ProductEditor, { url: URL_G });
    await saveAChange();
    const set = screen.getByLabelText(en['productEditor.field.attributeSet']!);
    await waitFor(() => expect(set).toHaveAttribute('aria-invalid', 'true'));
    expect(set).toHaveAccessibleDescription(expect.stringContaining(en['productEditor.save.reason.product.attributeSetId']!));
    // Not dropped as a removed subject: the staged SKU is still there.
    expect(screen.getByLabelText(en['productEditor.field.sku']!)).toHaveValue('SKU-TAKEN');
    expect(screen.queryByText(en['productEditor.save.error.subjectGone']!)).toBeNull();
  });

  it('a category that no longer exists is named beside the categories', async () => {
    refuse(422, 'SCOPED_VALUE_INVALID', { fields: [{ field: 'product.categoryIds', scope: { level: 'global' }, reason: 'subject_not_found' }] });
    renderEditor(ProductEditor, { url: URL_G });
    await saveAChange();
    expect(await screen.findByText(en['productEditor.save.reason.product.categoryIds']!)).toBeInTheDocument();
  });

  it('the download rules, which have no field here, are one message', async () => {
    refuse(422, 'SCOPED_VALUE_INVALID', { fields: [{ field: 'product.downloadAssetId', scope: { level: 'global' }, reason: 'invalid' }] });
    renderEditor(ProductEditor, { url: URL_G });
    await saveAChange();
    expect(await screen.findByText(en['productEditor.save.error.download']!)).toBeInTheDocument();
  });

  it('a Save naming SEO cells while seo is off says so and offers to drop them', async () => {
    refuse(503, 'MODULE_DISABLED', {});
    renderEditor(ProductEditor, { url: URL_G });
    await saveAChange();
    expect(await screen.findByText(en['productEditor.save.error.seoOff']!)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['productEditor.save.removeSeoChanges']! })).toBeInTheDocument();
  });
});
