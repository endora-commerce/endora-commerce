import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
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
 * Issue #1489 (UX audit 2026-11-17, CAT-07) — inside the product editor the page's one Save is
 * the only filled primary (Von Restorff). Every "Add …" in a tab section is an `outline` button
 * with a `Plus` icon; every row removal is a quiet `ghost` icon button in the destructive tone,
 * named after its row, that asks before it deletes anything (Fitts: distance, not proximity, for
 * the destructive action; Signal-to-Noise: ten rows are not ten red buttons). The rule is the kit
 * README's § Button hierarchy (DS-07, #1441).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const IMG = '00000000-0000-4000-8000-0000000000c1';
const ATT = '00000000-0000-4000-8000-0000000000d1';
const CHILD = '00000000-0000-4000-8000-0000000000e1';
const OPTION = '00000000-0000-4000-8000-0000000000e2';
const TARGET = '00000000-0000-4000-8000-0000000001b1';
const LINK = '00000000-0000-4000-8000-0000000001a1';
const UNIT = '00000000-0000-4000-8000-0000000000f1';
const COLOR = '00000000-0000-4000-8000-00000000c001';
/** The product fixture's attribute set, with one variant axis. */
const SET_ID = scopedValuesResponse().data.product.attributeSetId!;

type ProductType = 'simple' | 'configurable' | 'grouped' | 'bundle';

function read(type: ProductType) {
  return (scope: ScopeRef) =>
    scopedValuesResponse({
      scope,
      validScopes: VALID_SCOPES,
      product: { ...scopedValuesResponse().data.product, type },
      gallery: {
        items: [{ id: IMG, assetId: IMG, url: 'https://cdn.example.com/front.jpg', position: 0, altText: scopedField<string>('Front'), hidden: scopedField(false), assetAltText: null }],
        roles: { baseImage: scopedField<string>(IMG), smallImage: scopedField<string>(null), thumbnail: scopedField<string>(null) },
      },
      attachments: [
        { id: ATT, assetId: ATT, typeId: ATT, position: 0, fileName: 'manual.pdf', name: scopedField('Manual'), description: scopedField<string>(null), hidden: scopedField(false) },
      ],
      packagingUnits: [{ id: UNIT, baseQuantity: 480, position: 0, isDefault: true, minOrderUnits: null, name: scopedField('Pallet') }],
    });
}

function setUp(type: ProductType): void {
  setUpEditorApi({
    read: read(type),
    extra: (path) => {
      if (path === `${BASE}/variants`) {
        return { data: [{ id: 'v1', parentProductId: PRODUCT_ID, sku: 'TEE-RED-M', variantAttributeValues: { color: 'red' }, stockLevel: null }] };
      }
      if (path === '/api/v1/admin/catalog/attributes/by-flag?flag=isVariantAxis') {
        return { data: { items: [{ id: COLOR, key: 'color', label: {}, labelDefault: 'Colour', valueType: 'select' }] } };
      }
      if (path === `/api/v1/admin/catalog/attribute-sets/${SET_ID}`) {
        return {
          data: {
            id: SET_ID,
            attributes: [{ id: COLOR, key: 'color', label: { 'en-US': 'Colour' }, valueType: 'select', position: 0, scopable: false, scopeLevels: ['G'] }],
          },
        };
      }
      if (path === `/api/v1/admin/catalog/attributes/${COLOR}/options`) {
        return { data: { items: [{ id: 'red-id', value: 'red', label: { 'en-US': 'Red' }, labelDefault: 'Red', sortOrder: 0 }] } };
      }
      if (path === `${BASE}/links`) {
        return { data: [{ id: LINK, sourceProductId: PRODUCT_ID, targetProductId: TARGET, kind: 'related', position: 0 }] };
      }
      if (path === `${BASE}/grouped-items`) {
        return { data: [{ id: 'g1', parentProductId: PRODUCT_ID, childProductId: CHILD, quantity: 1, position: 0 }] };
      }
      if (path === `${BASE}/bundle-slots`) {
        return {
          data: [
            {
              id: 's1',
              parentProductId: PRODUCT_ID,
              name: { 'en-US': 'Battery' },
              minQuantity: 0,
              maxQuantity: 1,
              position: 0,
              options: [{ id: 'o1', slotId: 's1', optionProductId: OPTION, defaultQuantity: 1, position: 0 }],
            },
          ],
        };
      }
      if (path === `${BASE}/packaging-units`) {
        return {
          data: [{ id: UNIT, productId: PRODUCT_ID, name: 'Pallet', baseQuantity: 480, position: 0, isDefault: true, minOrderUnits: null }],
        };
      }
      if (path.startsWith('/api/v1/admin/warehouses')) return { items: [] };
      if (path.startsWith('/api/v1/admin/inventory/levels')) return { items: [] };
      return undefined;
    },
  });
  api.post.mockImplementation(async (path: string) =>
    path === '/api/v1/admin/catalog/products/batch-by-id'
      ? { data: [{ id: TARGET, sku: 'TARGET-1', name: 'Cordless drill', slug: 'cordless-drill', status: 'active' }], pagination: { hasMore: false } }
      : { data: null },
  );
  api.delete.mockResolvedValue(undefined);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const at = (tab: string): string => `/catalog/products/${PRODUCT_ID}?scope=global&tab=${tab}`;
const sub = (key: string, params: Record<string, string>): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, value), en[key]!);

/** The class tokens that make a button filled: the kit's `default` / `destructive`, the legacy primary / danger. */
const FILLED = ['bg-primary', 'bg-destructive', 'b2b-btn--primary', 'b2b-btn--danger'];
const tokens = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
const isFilled = (el: Element): boolean => tokens(el).some((c) => FILLED.includes(c));

function expectNoFilledButton(panel: HTMLElement): void {
  const filled = within(panel)
    .queryAllByRole('button')
    .filter(isFilled)
    .map((b) => b.textContent || b.getAttribute('aria-label'));
  expect(filled).toEqual([]);
}

function expectOutlineAdd(panel: HTMLElement, key: string): void {
  const add = within(panel).getByRole('button', { name: en[key]! });
  expect(tokens(add)).toContain('border');
  expect(isFilled(add)).toBe(false);
  expect(add.querySelector('svg.lucide-plus')).not.toBeNull();
  // The icon is the "+": the copy does not draw a second one.
  expect(en[key]!.startsWith('+')).toBe(false);
}

/** A quiet destructive row action: ghost, icon-only, the destructive tone, named after its row. */
function expectQuietRemove(button: HTMLElement): void {
  expect(isFilled(button)).toBe(false);
  expect(tokens(button)).not.toContain('border');
  expect(tokens(button)).toContain('text-destructive');
  expect(button.querySelector('svg.lucide-trash2, svg.lucide-trash-2')).not.toBeNull();
  expect(button.textContent?.trim()).toBe('');
}

async function panelAfter(heading: string, row: string): Promise<HTMLElement> {
  await screen.findByRole('heading', { name: new RegExp(`^${heading}`) });
  const panel = screen.getByRole('tabpanel');
  await within(panel).findByText(row);
  return panel;
}

describe('product editor: the one Save is the only filled primary (issue #1489, CAT-07)', () => {
  it('Variants: Add variant is outline; the row delete is a quiet icon', async () => {
    setUp('configurable');
    renderEditor(ProductEditor, { url: at('variants') });
    const panel = await panelAfter(en['productEditor.variants.title']!, 'TEE-RED-M');
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.variants.action.add');
    expectQuietRemove(within(panel).getByRole('button', { name: sub('productEditor.variants.action.deleteFor', { sku: 'TEE-RED-M' }) }));
  });

  it('Related products: Add link is outline; Remove names the product and asks first', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('links') });
    const panel = await panelAfter(en['productEditor.links.title']!, 'Cordless drill');
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.links.action.add');
    const remove = within(panel).getByRole('button', { name: sub('productEditor.links.action.removeFor', { product: 'Cordless drill' }) });
    expectQuietRemove(remove);
    fireEvent.click(remove);
    expect(await screen.findByRole('dialog', { name: en['productEditor.links.removeConfirm']! })).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('Grouped items: Add child is outline; Remove names the child and asks first', async () => {
    setUp('grouped');
    renderEditor(ProductEditor, { url: at('composite') });
    const panel = await panelAfter(en['productEditor.grouped.title']!, CHILD);
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.grouped.action.add');
    const remove = within(panel).getByRole('button', { name: sub('productEditor.grouped.action.removeFor', { product: CHILD }) });
    expectQuietRemove(remove);
    fireEvent.click(remove);
    expect(await screen.findByRole('dialog', { name: en['productEditor.grouped.removeConfirm']! })).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('Bundle slots: Add slot and Add option are outline; Delete slot and Remove option are quiet and ask first', async () => {
    setUp('bundle');
    renderEditor(ProductEditor, { url: at('composite') });
    const panel = await panelAfter(en['productEditor.bundle.title']!, OPTION);
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.bundle.action.add');
    expectOutlineAdd(panel, 'productEditor.bundle.action.addOption');
    const slot = within(panel).getByRole('button', { name: sub('productEditor.bundle.action.deleteSlotFor', { slot: 'Battery' }) });
    expectQuietRemove(slot);
    const option = within(panel).getByRole('button', { name: sub('productEditor.bundle.action.removeOptionFor', { product: OPTION }) });
    expectQuietRemove(option);
    fireEvent.click(option);
    expect(await screen.findByRole('dialog', { name: en['productEditor.bundle.removeOptionConfirm']! })).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('Media: Add to gallery is outline; Remove names the image', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('media') });
    await screen.findByRole('heading', { name: new RegExp(`^${en['productEditor.gallery.title']!}`) });
    const panel = screen.getByRole('tabpanel');
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.gallery.action.add');
    const [remove] = within(panel).getAllByRole('button', { name: /^Remove / });
    expectQuietRemove(remove!);
  });

  it('Attachments: Add attachment is outline; Remove names the file', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('attachments') });
    const panel = await panelAfter(en['productEditor.attachments.title']!, 'manual.pdf');
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'productEditor.attachments.action.add');
    expectQuietRemove(within(panel).getByRole('button', { name: sub('productEditor.attachments.action.removeItem', { name: 'manual.pdf' }) }));
  });

  it('Inventory: packaging units add with an outline button; Remove names the unit and deletes only after the dialog', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('inventory') });
    await screen.findByRole('heading', { name: new RegExp(`^${en['packagingUnits.title']!}`) });
    const panel = screen.getByRole('tabpanel');
    await within(panel).findByDisplayValue('Pallet');
    expectNoFilledButton(panel);
    expectOutlineAdd(panel, 'packagingUnits.action.add');
    const remove = within(panel).getByRole('button', { name: sub('packagingUnits.action.removeFor', { name: 'Pallet' }) });
    expectQuietRemove(remove);

    fireEvent.click(remove);
    let dialog = await screen.findByRole('dialog', { name: sub('packagingUnits.removeConfirm', { name: 'Pallet' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.archive.cancel']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(remove);
    dialog = await screen.findByRole('dialog', { name: sub('packagingUnits.removeConfirm', { name: 'Pallet' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.confirmRemoval.confirm']! }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/packaging-units/${UNIT}`));
  });

  it('Details: the tab panel carries no filled button (the Save sits outside it)', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('details') });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expectNoFilledButton(screen.getByRole('tabpanel'));
  });
});
