import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  CH_RETAIL,
  CH_VIP,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  currentSearch,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 174 final QA, spec "Edge Cases":
 * - *Permission lost mid-session* — a 403 refuses the whole save; nothing is claimed saved;
 * - *Archived product* — the archived notice wins; the switcher still works.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

let archivedAt: string | null = null;

function read(scope: ScopeRef) {
  const base = scopedValuesResponse();
  return scopedValuesResponse({
    scope,
    version: '9',
    validScopes: VALID_SCOPES,
    product: { ...base.data.product, archivedAt },
    fields: { name: scopedField('Drill', { source: 'set', ownValue: 'Drill', required: true }) },
  });
}

beforeEach(() => {
  archivedAt = null;
  setUpEditorApi({ read });
});
afterEach(() => cleanup());

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;

describe('permission lost mid-session', () => {
  it.each([403, 500])('a %i on Save claims nothing saved and keeps the staged change', async (status) => {
    api.put.mockRejectedValue(new ApiError(status, { error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL', message: 'refused by server' } } as never));
    renderEditor(ProductEditor, { url: AT_C });
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    fireEvent.change(name, { target: { value: 'Wiertarka' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    // The refusal is stated in text, and nothing says "Saved".
    expect(await screen.findByText(/refused by server/)).toBeInTheDocument();
    expect(screen.queryByText(/^Saved \d+ change/)).not.toBeInTheDocument();
    // The change is still staged and still savable.
    expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
    expect(screen.getByRole('button', { name: /^Save 1 change/ })).toBeEnabled();
  });
});

describe('archived product', () => {
  it('shows the archived notice and the scope switcher still switches scope', async () => {
    archivedAt = '2026-10-01T10:00:00.000Z';
    const view = renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}` });
    expect(await screen.findByTestId('product-archived-notice')).toBeInTheDocument();
    const channel = screen.getByLabelText(en['productEditor.scope.channelSelect']!);
    fireEvent.change(channel, { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    expect(await screen.findByTestId('product-archived-notice')).toBeInTheDocument();
  });
});
