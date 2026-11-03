import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
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
 * Feature 170 (T106; US7 #1–#6 UI half, FR-070…FR-076, FR-083) — one Save of the current scope:
 * the button counts the staged changes, staged changes survive tab switches, a scope switch
 * with staged changes asks Save / Discard / Stay, and every refusal is shown where it belongs —
 * a version conflict with a Reload that discards, a field's refusal beside the field, the
 * completeness gate per (channel, language), its warn mode in the gate-warning region.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '9',
    validScopes: VALID_SCOPES,
    fields: {
      name: scopedField('Drill', { source: 'set', ownValue: 'Drill', required: true }),
      description: scopedField('Text', { source: 'set', ownValue: 'Text' }),
    },
  });
}

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'channel', channelId: CH_RETAIL }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;

function scopedPuts(): unknown[][] {
  return api.put.mock.calls.filter(([path]) => path === `${BASE}/scoped-values`);
}

function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(status, { error: { code, message: code, ...(details ? { details } : {}) } } as never);
}

async function stageName(value = 'Wiertarka'): Promise<HTMLElement> {
  const name = await screen.findByLabelText(en['productEditor.field.name']!);
  fireEvent.change(name, { target: { value } });
  return name;
}

describe('one Save of the current scope (feature 170, US7)', () => {
  it('counts the staged changes and keeps them across tab switches (FR-083)', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.change(screen.getByLabelText(en['productEditor.field.description']!), { target: { value: 'New text' } });
    expect(screen.getByRole('button', { name: /^Save 2 change/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.media']! }));
    fireEvent.click(await screen.findByRole('tab', { name: en['productEditor.tab.details']! }));
    expect(await screen.findByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
    fireEvent.click(screen.getByRole('button', { name: /^Save 2 change/ }));
    await waitFor(() => expect(scopedPuts()).toHaveLength(1));
    expect((scopedPuts()[0]![1] as { changes: unknown }).changes).toEqual({ name: 'Wiertarka', description: 'New text' });
    expect(await screen.findByRole('button', { name: new RegExp(`^${en['productEditor.save.action']}`) })).toBeDisabled();
  });

  it('a scope switch with staged changes asks first; Stay keeps scope and changes (FR-075)', async () => {
    const view = renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.guard.stay']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentSearch(view).get('channel')).toBe(CH_RETAIL);
    expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
  });

  it('Discard switches and drops the changes; nothing is saved', async () => {
    const view = renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['productEditor.guard.discard']! }));
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    expect(await screen.findByLabelText(en['productEditor.field.name']!)).toHaveValue('Drill');
    expect(scopedPuts()).toHaveLength(0);
  });

  it('Save and continue saves at the old scope, then switches', async () => {
    const view = renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['productEditor.guard.save']! }));
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    expect(scopedPuts()).toHaveLength(1);
    expect((scopedPuts()[0]![1] as { scope: unknown }).scope).toEqual({ channelId: CH_RETAIL });
  });

  it('Back with staged changes asks first (§11)', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('button', { name: en['productEditor.back']! }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.guard.discard']! }));
    expect(await screen.findByText('product list')).toBeInTheDocument();
  });

  it('a version conflict saves nothing and offers a Reload that discards (US7 #6)', async () => {
    api.put.mockRejectedValue(apiError(409, 'VERSION_CONFLICT'));
    renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    expect(await screen.findByText(en['productEditor.save.error.conflict']!)).toBeInTheDocument();
    expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
    fireEvent.click(screen.getByRole('button', { name: en['productEditor.save.reloadDiscarding']! }));
    await waitFor(() => expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Drill'));
  });

  it('a field refusal is shown beside the field and keeps the change', async () => {
    api.put.mockRejectedValue(
      apiError(422, 'SCOPED_VALUE_INVALID', { fields: [{ field: 'description', scope: { level: 'channel', channelId: CH_RETAIL }, reason: 'invalid' }] }),
    );
    renderEditor(ProductEditor, { url: AT_C });
    const description = await screen.findByLabelText(en['productEditor.field.description']!);
    fireEvent.change(description, { target: { value: 'Bad' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    await waitFor(() => expect(description).toHaveAttribute('aria-invalid', 'true'));
    expect(description).toHaveAccessibleDescription(expect.stringContaining(en['productEditor.save.reason.invalid']!));
    expect(description).toHaveValue('Bad');
  });

  it('the completeness gate refuses per (channel, language) and nothing is saved', async () => {
    api.put.mockRejectedValue(
      apiError(422, 'SCOPE_INCOMPLETE', { pairs: [{ channelId: CH_RETAIL, languageCode: 'pl-PL', missing: ['name'] }] }),
    );
    renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    const error = await screen.findByTestId('product-save-error');
    expect(error).toHaveTextContent('Retail PL');
    expect(error).toHaveTextContent('PL');
  });

  it('warn mode saves and says what is missing in the gate-warning region (FR-098)', async () => {
    api.put.mockResolvedValue({
      ...read({ level: 'channel', channelId: CH_RETAIL }),
      warnings: [{ kind: 'completeness', channelId: CH_RETAIL, languageCode: 'pl-PL', missing: ['urlKey'] }],
    });
    renderEditor(ProductEditor, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change/ }));
    expect(await screen.findByTestId('product-gate-warning')).toHaveTextContent('Retail PL');
  });
});
