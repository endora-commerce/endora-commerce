import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
 * Feature 170 (T109; US8 #1–#5, FR-080, FR-081, FR-082, FR-084) — read-only access and fields
 * that cannot change at the scope; plus the Global-only Details fields the block-1 rewrite left
 * without a test: the category picker and the attribute-set swap stage and save at Global.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;
const AT_CL = `${AT_C.replace('scope=channel', 'scope=cl')}&language=pl-PL`;
const SET_A = '22222222-2222-4222-8222-2222222222a1';
const SET_B = '22222222-2222-4222-8222-2222222222b2';
const CAT_TOOLS = '33333333-3333-4333-8333-3333333333c1';

function read(scope: ScopeRef) {
  const base = scopedValuesResponse({ scope, version: '5', validScopes: VALID_SCOPES });
  return scopedValuesResponse({
    scope,
    version: '5',
    validScopes: VALID_SCOPES,
    product: { ...base.data.product, attributeSetId: SET_A, categoryIds: [] },
    fields: {
      window: scopedField({ from: null, until: null }, { levels: ['G', 'C'], supportedHere: scope.level !== 'channel_language' }),
      name: scopedField('Drill', scope.level === 'global' ? { source: 'set', ownValue: 'Drill', required: true } : { source: 'inherited_global', required: true }),
    },
  });
}

function extra(path: string): unknown {
  if (path === '/api/v1/admin/catalog/attribute-sets') {
    return { data: [{ id: SET_A, code: 'tools', isSystem: false }, { id: SET_B, code: 'garden', isSystem: false }] };
  }
  if (path === '/api/v1/admin/catalog/categories') {
    return { data: [{ id: CAT_TOOLS, parentCategoryId: null, name: { 'en-US': 'Power tools', 'pl-PL': 'Elektronarzędzia' }, slug: 'tools', sortOrder: 0 }] };
  }
  return undefined;
}

beforeEach(() => {
  setUpEditorApi({ read, extra });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'global' }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

function scopedPutBody(): { changes: Record<string, unknown> } {
  const call = api.put.mock.calls.find(([path]) => path === `${BASE}/scoped-values`);
  return call![1] as { changes: Record<string, unknown> };
}

describe('read-only access (feature 170, US8)', () => {
  it('#1 without catalog:write the switcher works, every control is read-only, no checkbox, no Save, no whole-product actions', async () => {
    const view = renderEditor(ProductEditor, { url: AT_C, permissions: ['catalog:read'] });
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    expect(name).toHaveAttribute('readonly');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Inherited from Global')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByRole('button', { name: en['productEditor.wholeProduct.menu']! })).toBeNull();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    expect(await screen.findByLabelText(en['productEditor.field.name']!)).toHaveAttribute('readonly');
  });

  it('#2 at a non-Global scope a global-only field is read-only with "Global only"', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    expect(await screen.findByLabelText(en['productEditor.field.sku']!)).toHaveAttribute('readonly');
    expect(screen.getAllByText('Global only').length).toBeGreaterThan(0);
  });

  it('#3 a field not supported at C×L is read-only with "Set per channel"', async () => {
    renderEditor(ProductEditor, { url: AT_CL });
    const field = await screen.findByLabelText(`${en['productEditor.field.publishWindow']!} ${en['productEditor.field.publishFrom']!}`);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getAllByText('Set per channel').length).toBeGreaterThan(0);
  });

  it('#4 a staged change survives a tab switch and back', async () => {
    renderEditor(ProductEditor);
    fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka' } });
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.media']! }));
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.details']! }));
    expect(await screen.findByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
    expect(screen.getByRole('button', { name: /^Save 1 change\b/ })).toBeInTheDocument();
  });

  it('#5 leaving the product with staged changes asks first', async () => {
    renderEditor(ProductEditor);
    fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['productEditor.back']!) }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(/1 unsaved change at this scope/);
    expect(screen.queryByText('product list')).toBeNull();
  });
});

describe('Global-only Details fields (restored after the block-1 rewrite)', () => {
  it('the category picker stages the categories and Save sends them', async () => {
    renderEditor(ProductEditor);
    const group = await screen.findByRole('group', { name: en['productEditor.section.categories']! });
    fireEvent.click(await within(group).findByRole('checkbox', { name: /Power tools/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change\b/ }));
    await waitFor(() => expect(scopedPutBody().changes).toEqual({ product: { categoryIds: [CAT_TOOLS] } }));
  });

  it('category names follow the admin language when read-only', async () => {
    setUpEditorApi({
      read: (scope) => {
        const r = read(scope);
        return { ...r, data: { ...r.data, product: { ...r.data.product, categoryIds: [CAT_TOOLS] } } };
      },
      extra,
    });
    renderEditor(ProductEditor, { url: AT_C });
    expect(await screen.findByDisplayValue('Power tools')).toHaveAttribute('readonly');
  });

  it('swapping the attribute set stages it and Save sends it', async () => {
    renderEditor(ProductEditor);
    const select = await screen.findByLabelText(en['productEditor.field.attributeSet']!);
    await within(select).findByRole('option', { name: 'garden' });
    fireEvent.change(select, { target: { value: SET_B } });
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change\b/ }));
    await waitFor(() => expect(scopedPutBody().changes).toEqual({ product: { attributeSetId: SET_B } }));
  });
});
