import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
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
 * Feature 170 (T099, T102; US6 #1–#8, FR-060…FR-065, FR-081, FR-082) — the editor's fields at a
 * scope: "Use value from <parent scope>" on text, select and date fields, the three states, a
 * required field refusing an empty value, an optional one staging `empty`, Global-only fields and
 * tabs, and fields not set at the scope's level.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_C: ScopeRef = { level: 'channel', channelId: CH_RETAIL };

function read(scope: ScopeRef) {
  if (scope.level === 'global') {
    return scopedValuesResponse({ scope, version: '5', validScopes: VALID_SCOPES, fields: { description: scopedField('Global text') } });
  }
  return scopedValuesResponse({
    scope,
    version: '5',
    validScopes: VALID_SCOPES,
    fields: {
      name: scopedField('Drill', { source: 'inherited_global', required: true }),
      description: scopedField('Retail text', { source: 'set', ownValue: 'Retail text' }),
      status: scopedField<'active' | 'inactive'>('active', { source: 'inherited_global' }),
      window: scopedField(
        { from: null, until: null },
        { levels: ['G', 'C'], source: 'inherited_global', supportedHere: scope.level !== 'channel_language' },
      ),
    },
  });
}

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string, body: { scope: Record<string, string> }) => {
    if (!path.endsWith('/scoped-values')) return { data: null };
    const scope: ScopeRef = body.scope.channelId ? AT_C : { level: 'global' };
    return { ...read(scope), warnings: [] };
  });
});
afterEach(() => cleanup());

const atChannel = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;

async function save(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything()));
  const call = api.put.mock.calls.find(([path]) => path === `${BASE}/scoped-values`)!;
  return (call[1] as { changes: Record<string, unknown> }).changes;
}

describe('fields at a scope (feature 170, US6)', () => {
  it('an inherited text field: checked "Use value from Global", read-only, untick and type stages a value (US6 #1, #2)', async () => {
    renderEditor(ProductEditor, { url: atChannel });
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    expect(name).toHaveValue('Drill');
    expect(name).toHaveAttribute('readonly');
    const box = screen.getByRole('checkbox', { name: `Use value from Global for ${en['productEditor.field.name']}` });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(name).not.toHaveAttribute('readonly');
    fireEvent.change(name, { target: { value: 'Wiertarka' } });
    expect(await save()).toEqual({ name: 'Wiertarka' });
  });

  it('ticking an own value stages inherit (US6 #3)', async () => {
    renderEditor(ProductEditor, { url: atChannel });
    const box = await screen.findByRole('checkbox', { name: `Use value from Global for ${en['productEditor.field.description']}` });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(await save()).toEqual({ description: { inherit: true } });
  });

  it('clearing an optional own value stages empty (US6 #4)', async () => {
    renderEditor(ProductEditor, { url: atChannel });
    const description = await screen.findByLabelText(en['productEditor.field.description']!);
    fireEvent.change(description, { target: { value: '' } });
    expect(await save()).toEqual({ description: null });
  });

  it('clearing the name at Global is refused beside the field, and nothing is sent (US6 #5)', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(expect.stringContaining(en['productEditor.save.error.requiredEmpty']!));
    expect(api.put).not.toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.anything());
  });

  it('an inherited select is a read-only text with the option label; untick offers the select (US6 #6)', async () => {
    renderEditor(ProductEditor, { url: atChannel });
    const status = await screen.findByLabelText(en['productEditor.field.status']!);
    expect(status.tagName).toBe('INPUT');
    expect(status).toHaveValue(en['productEditor.statusValue.active']);
    fireEvent.click(screen.getByRole('checkbox', { name: `Use value from Global for ${en['productEditor.field.status']}` }));
    const select = screen.getByLabelText(en['productEditor.field.status']!);
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'inactive' } });
    expect(await save()).toEqual({ status: 'inactive' });
  });

  it('the publication window at Channel × language says it is set per channel and jumps there (FR-082)', async () => {
    const view = renderEditor(ProductEditor, { url: `${atChannel.replace('scope=channel', 'scope=cl')}&language=pl-PL` });
    const field = await screen.findByLabelText(en['productEditor.field.publishWindow']!, { exact: false });
    expect(field).toHaveAttribute('readonly');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByText('Set per channel').length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit at Retail PL' })[0]!);
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('channel'));
  });

  it('a Global-only field outside Global is read-only with "Edit at Global" (FR-081)', async () => {
    const view = renderEditor(ProductEditor, { url: atChannel });
    const sku = await screen.findByLabelText(en['productEditor.field.sku']!);
    expect(sku).toHaveAttribute('readonly');
    expect(screen.getAllByText('Global only').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit at Global' })[0]!);
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('global'));
  });

  it('a Global-only tab shows one notice outside Global (FR-081)', async () => {
    renderEditor(ProductEditor, { url: `${atChannel}&tab=pricing` });
    expect(await screen.findByTestId('global-only-tab-notice')).toBeInTheDocument();
  });

  it('at Global a field has no "Use value from" checkbox (US6 #8)', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.queryAllByRole('checkbox', { name: /Use value from/ })).toHaveLength(0);
  });
});
