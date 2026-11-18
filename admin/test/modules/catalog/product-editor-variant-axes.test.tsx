import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BASE, PRODUCT_ID, api, en, renderEditor, scopedValuesResponse, setUpEditorApi } from './product-editor-harness';

/**
 * Issue #1457 (UX audit CAT-04) — the Variants tab offers one control per variant axis of the
 * product's attribute set, with the attribute's options, instead of one free-text
 * `key=value, key=value` field that nothing checked. The table shows one column per axis with
 * the option labels in the admin language; the create row no longer asks for stock (Inventory
 * owns it, per warehouse); removing a variant is a ghost icon button named for its SKU; and a
 * variant's axis values can be edited.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const SET_ID = '00000000-0000-4000-8000-0000000000e1';
const COLOR_ID = '00000000-0000-4000-8000-00000000c001';
const SIZE_ID = '00000000-0000-4000-8000-00000000c002';
const BRAND_ID = '00000000-0000-4000-8000-00000000c003';

const SET = {
  id: SET_ID,
  attributes: [
    { id: BRAND_ID, key: 'brand', label: { 'en-US': 'Brand' }, valueType: 'string', position: 0, scopable: false, scopeLevels: ['G'] },
    { id: SIZE_ID, key: 'size', label: { 'en-US': 'Size' }, valueType: 'enum', position: 2, scopable: false, scopeLevels: ['G'] },
    { id: COLOR_ID, key: 'color', label: { 'en-US': 'Colour' }, valueType: 'select', position: 1, scopable: false, scopeLevels: ['G'] },
  ],
};

function option(value: string, label: string, sortOrder: number) {
  return { id: `${value}-id`, value, label: { 'en-US': label }, labelDefault: label, sortOrder };
}

const OPTIONS: Record<string, unknown[]> = {
  [COLOR_ID]: [option('blue', 'Navy blue', 1), option('red', 'Signal red', 0)],
  [SIZE_ID]: [option('m', 'Medium', 0), option('l', 'Large', 1)],
};

const VARIANT = {
  id: '33333333-3333-4333-8333-333333331457',
  parentProductId: PRODUCT_ID,
  sku: 'TEE-RED-M',
  variantAttributeValues: { color: 'red', size: 'm' },
  stockLevel: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function setUp(options: { axisIds?: string[]; variants?: unknown[] } = {}): void {
  const axisIds = options.axisIds ?? [COLOR_ID, SIZE_ID];
  const variants = options.variants ?? [VARIANT];
  setUpEditorApi({
    read: (scope) => scopedValuesResponse({ scope, product: { ...scopedValuesResponse().data.product, type: 'configurable' } }),
    extra: (path) => {
      if (path === `${BASE}/variants`) return { data: variants };
      if (path === '/api/v1/admin/catalog/attributes/by-flag?flag=isVariantAxis') {
        return { data: { items: axisIds.map((id) => ({ id, key: id, label: {}, labelDefault: id, valueType: 'select' })) } };
      }
      if (path === `/api/v1/admin/catalog/attribute-sets/${SET_ID}`) return { data: SET };
      const optionsMatch = /\/api\/v1\/admin\/catalog\/attributes\/([^/]+)\/options$/.exec(path);
      if (optionsMatch) return { data: { items: OPTIONS[decodeURIComponent(optionsMatch[1]!)] ?? [] } };
      return undefined;
    },
  });
  api.post.mockResolvedValue({ data: VARIANT });
  api.patch.mockResolvedValue({ data: VARIANT });
}

function renderVariants(): void {
  renderEditor(() => <ProductEditor />, { url: `/catalog/products/${PRODUCT_ID}?tab=variants` });
}

afterEach(() => cleanup());

describe('ProductEditor › Variants — structured variant-axis controls (issue #1457)', () => {
  it('offers one select per variant axis of the set, in set order, with the options in the admin language', async () => {
    setUp();
    renderVariants();
    const group = await screen.findByRole('group', { name: en['productEditor.variants.createTitle']! });
    const colour = await within(group).findByRole('combobox', { name: 'Colour' });
    await waitFor(() => expect(within(colour).getAllByRole('option').map((o) => o.textContent)).toContain('Signal red'));
    // Options keep the attribute's sort order; the first entry asks for a choice.
    expect(within(colour).getAllByRole('option').map((o) => o.textContent)).toEqual([
      en['productEditor.variants.field.choose']!,
      'Signal red',
      'Navy blue',
    ]);
    expect(within(group).getByRole('combobox', { name: 'Size' })).toBeInTheDocument();
    // The set's other attribute is no axis, and the old free-text and stock fields are gone.
    expect(within(group).queryByLabelText('Brand')).toBeNull();
    expect(within(group).queryByPlaceholderText(/=/)).toBeNull();
    expect(within(group).queryByRole('spinbutton')).toBeNull();
  });

  it('shows one column per axis with the option label, and no stock column', async () => {
    setUp();
    renderVariants();
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([en['productEditor.variants.column.sku']!, 'Colour', 'Size', en['productEditor.variants.column.actions']!]);
    const row = await within(table).findByRole('row', { name: /TEE-RED-M/ });
    await waitFor(() => expect(within(row).getByText('Signal red')).toBeInTheDocument());
    expect(within(row).getByText('Medium')).toBeInTheDocument();
  });

  it('removes a variant through a ghost icon button named for its SKU', async () => {
    setUp();
    renderVariants();
    const remove = await screen.findByRole('button', { name: 'Delete variant TEE-RED-M' });
    expect(remove.textContent).toBe('');
    expect(remove.className).not.toMatch(/bg-destructive/);
  });

  it('creates a variant with the chosen option values', async () => {
    setUp();
    renderVariants();
    const group = await screen.findByRole('group', { name: en['productEditor.variants.createTitle']! });
    await waitFor(() => expect(within(group).getAllByRole('option', { name: 'Navy blue' })).toHaveLength(1));
    fireEvent.change(within(group).getByLabelText(en['productEditor.variants.field.sku']!), { target: { value: ' TEE-BLUE-L ' } });
    fireEvent.change(within(group).getByRole('combobox', { name: 'Colour' }), { target: { value: 'blue' } });
    fireEvent.change(within(group).getByRole('combobox', { name: 'Size' }), { target: { value: 'l' } });
    fireEvent.click(within(group).getByRole('button', { name: en['productEditor.variants.action.add']! }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`${BASE}/variants`, { sku: 'TEE-BLUE-L', variantAttributeValues: { color: 'blue', size: 'l' } }),
    );
  });

  it('refuses a variant without a value on every axis, naming the field, and sends nothing', async () => {
    setUp();
    renderVariants();
    const group = await screen.findByRole('group', { name: en['productEditor.variants.createTitle']! });
    fireEvent.change(within(group).getByLabelText(en['productEditor.variants.field.sku']!), { target: { value: 'TEE-X' } });
    fireEvent.click(within(group).getByRole('button', { name: en['productEditor.variants.action.add']! }));
    const colour = within(group).getByRole('combobox', { name: 'Colour' });
    await waitFor(() => expect(colour).toHaveAttribute('aria-invalid', 'true'));
    const describedBy = colour.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(en['productEditor.variants.error.axisRequired']!);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('refuses a SKU-less variant on the SKU field', async () => {
    setUp();
    renderVariants();
    const group = await screen.findByRole('group', { name: en['productEditor.variants.createTitle']! });
    fireEvent.click(within(group).getByRole('button', { name: en['productEditor.variants.action.add']! }));
    await waitFor(() => expect(within(group).getByLabelText(en['productEditor.variants.field.sku']!)).toHaveAttribute('aria-invalid', 'true'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('refuses a second variant with the same values, naming the variant that has them', async () => {
    setUp();
    renderVariants();
    const group = await screen.findByRole('group', { name: en['productEditor.variants.createTitle']! });
    await waitFor(() => expect(within(group).getAllByRole('option', { name: 'Signal red' })).toHaveLength(1));
    fireEvent.change(within(group).getByLabelText(en['productEditor.variants.field.sku']!), { target: { value: 'TEE-RED-M-2' } });
    fireEvent.change(within(group).getByRole('combobox', { name: 'Colour' }), { target: { value: 'red' } });
    fireEvent.change(within(group).getByRole('combobox', { name: 'Size' }), { target: { value: 'm' } });
    fireEvent.click(within(group).getByRole('button', { name: en['productEditor.variants.action.add']! }));
    expect(await within(group).findByText(en['productEditor.variants.error.duplicate']!.replace('{sku}', 'TEE-RED-M'))).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('edits a variant’s axis values in its row', async () => {
    setUp();
    renderVariants();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit variant TEE-RED-M' }));
    const row = screen.getByRole('row', { name: /TEE-RED-M/ });
    const colour = within(row).getByRole('combobox', { name: 'Colour' });
    expect(colour).toHaveValue('red');
    fireEvent.change(colour, { target: { value: 'blue' } });
    fireEvent.click(within(row).getByRole('button', { name: en['productEditor.variants.action.save']! }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/variants/${VARIANT.id}`, { variantAttributeValues: { color: 'blue', size: 'm' } }),
    );
  });

  it('explains that the set has no variant attributes instead of offering a create row', async () => {
    setUp({ axisIds: [], variants: [] });
    renderVariants();
    expect(await screen.findByText(en['productEditor.variants.noAxes.body']!)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en['productEditor.variants.noAxes.action']! })).toHaveAttribute('href', '/catalog/attribute-sets');
    expect(screen.queryByRole('group', { name: createGroupName() })).toBeNull();
  });

  it('shows a stored key that is no axis in its own column rather than hiding it', async () => {
    setUp({ variants: [{ ...VARIANT, variantAttributeValues: { color: 'red', size: 'm', colr: 'blu' } }] });
    renderVariants();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain(en['productEditor.variants.column.other']!);
    expect(await within(table).findByText('colr: blu')).toBeInTheDocument();
  });
});

function createGroupName(): string {
  return en['productEditor.variants.createTitle']!;
}
