import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  IMMEDIATE_BADGE,
  BASE,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  en,
  renderEditor,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Feature 180, WP-4 — the product Inventory tab and the one Save (owner ruling OQ-7 = B; FR-025;
 * `contracts/product-editor-save-ui.md` §5).
 *
 * The product-row settings — stock management, backorders, the low-stock threshold and its mode,
 * the fulfilment strategy — are staged Global cells of the editor's own write: the tab has no Save
 * of its own for them, changing the threshold mode no longer saves by itself, and the one Save
 * carries them in its `PUT …/scoped-values` (`changes.product`, which the scoped-values contract
 * already carries; research R22). Per-warehouse stock levels and thresholds stay immediate, under
 * an "Applies immediately" badge.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const CORE = shippedCoreBundle('en').core as Record<string, string>;
const WH_A = '00000000-0000-4000-8000-0000000000a1';
const WH_B = '00000000-0000-4000-8000-0000000000b2';
const AT_INVENTORY = `/catalog/products/${PRODUCT_ID}?tab=inventory`;

function read(scope: ScopeRef) {
  return scopedValuesResponse({ scope, version: '9', validScopes: VALID_SCOPES });
}

/** A sentence as a regular expression that matches it literally. */
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scopedPuts = (): unknown[][] => api.put.mock.calls.filter(([path]) => path === `${BASE}/scoped-values`);
const productPatches = (): unknown[][] => api.patch.mock.calls.filter(([path]) => path === BASE);
const saveButton = (): HTMLElement => screen.getByTestId('product-save');

beforeEach(() => {
  setUpEditorApi({
    read,
    extra: (path) => {
      if (path.startsWith('/api/v1/admin/warehouses')) {
        return {
          items: [
            { id: WH_A, code: 'WA', name: 'Warsaw', isDefault: true },
            { id: WH_B, code: 'WB', name: 'Berlin', isDefault: false },
          ],
        };
      }
      if (path.startsWith('/api/v1/admin/inventory/levels')) {
        return {
          items: [
            {
              productId: PRODUCT_ID,
              perWarehouse: [
                { warehouseId: WH_A, onHand: 5, lowStockThreshold: null },
                { warehouseId: WH_B, onHand: 2, lowStockThreshold: 1 },
              ],
            },
          ],
        };
      }
      if (path === '/api/v1/admin/settings/inventory.allow_negative_stock') {
        return { code: 'inventory.allow_negative_stock', globalValue: true, defaultValue: false };
      }
      return undefined;
    },
  });
  api.put.mockImplementation(async (path: string) => {
    if (path === `${BASE}/scoped-values`) return { ...read({ level: 'global' }), warnings: [] };
    if (path === '/api/v1/admin/inventory/levels') return { data: { before: 5, after: 7, productId: PRODUCT_ID, warehouseId: WH_A } };
    return { data: null };
  });
  api.patch.mockResolvedValue({ data: null });
});
afterEach(() => cleanup());

async function openInventory(): Promise<void> {
  renderEditor(ProductEditor, { url: AT_INVENTORY });
  await screen.findByText(en['inventoryTab.stockMgmt.title']!);
}

describe('the Inventory tab saves with the product (feature 180, WP-4)', () => {
  it('stages the five product-row settings and writes them with the one Save, in the scoped write', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(new RegExp(escape(en['inventoryTab.stockMgmt.backorder']!))));
    // The input and its section share a name (#1488: the section is a region labelled by its heading).
    fireEvent.change(screen.getByRole('spinbutton', { name: en['inventoryTab.lowStock.title']! }), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(CORE['fulfilment.label']!), { target: { value: 'lowest_stock_first' } });
    expect(saveButton()).toHaveAccessibleName(/^Save 3 changes/);
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(scopedPuts()).toHaveLength(1));
    expect((scopedPuts()[0]![1] as { changes: unknown }).changes).toEqual({
      // The warehouse order stays as saved (`null`), so it is not sent.
      product: { backorderEnabled: true, lowStockThreshold: 4, fulfilmentStrategy: 'lowest_stock_first' },
    });
    expect(productPatches()).toHaveLength(0);
  });

  it('a defined warehouse order travels with its strategy', async () => {
    await openInventory();
    fireEvent.change(screen.getByLabelText(CORE['fulfilment.label']!), { target: { value: 'defined_order' } });
    fireEvent.change(screen.getByRole('combobox', { name: CORE['fulfilment.warehouseOrder.add']! }), { target: { value: WH_B } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(scopedPuts()).toHaveLength(1));
    expect((scopedPuts()[0]![1] as { changes: unknown }).changes).toEqual({
      product: { fulfilmentStrategy: 'defined_order', fulfilmentStrategyWarehouseOrder: [WH_B] },
    });
  });

  it('tracking stock is a positive switch, and turning it off is a staged change, not a write', async () => {
    await openInventory();
    // Issue #1454 (CAT-01): the control used to be a "Disable stock management" checkbox,
    // checked when stock was *not* managed — a double negative (Mental Model).
    const track = screen.getByRole('switch', { name: en['inventoryTab.stockMgmt.trackStock']! });
    expect(track).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(track);
    expect(track).toHaveAttribute('aria-checked', 'false');
    expect(saveButton()).toHaveAccessibleName(/^Save 1 change/);
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(scopedPuts()).toHaveLength(1));
    expect((scopedPuts()[0]![1] as { changes: unknown }).changes).toEqual({ product: { manageStock: false } });
  });

  it('changing the threshold mode no longer saves by itself; changing it back unstages it', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modePerWarehouse']!));
    expect(api.patch).not.toHaveBeenCalled();
    expect(saveButton()).toHaveAccessibleName(/^Save 1 change/);
    // The per-warehouse thresholds show for the mode being edited.
    expect(screen.getByRole('columnheader', { name: en['inventoryTab.column.threshold']! })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modeCumulative']!));
    expect(saveButton()).toHaveAccessibleName(/^Save( |$)/);
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('offers no Save of its own for the product-row settings', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modePerWarehouse']!));
    // Issue #1454 (CAT-01): the per-warehouse rows used to carry a filled "Save" each, so the
    // tab showed N + 1 primaries. The editor's Save is now the only Save on the page.
    const saves = screen.getAllByRole('button', { name: /^Save/ });
    expect(saves.map((button) => button.getAttribute('data-testid'))).toEqual(['product-save']);
  });

  it('keeps per-warehouse stock immediate, under an "Applies immediately" badge', async () => {
    await openInventory();
    const table = screen.getByRole('table');
    const heading = screen.getByRole('heading', { name: new RegExp(en['inventoryTab.table.title']!) });
    expect(heading).toHaveTextContent(IMMEDIATE_BADGE);
    const warsaw = within(table).getByText('Warsaw').closest('tr')!;
    fireEvent.change(within(warsaw).getByRole('spinbutton'), { target: { value: '7' } });
    fireEvent.click(within(warsaw).getByRole('button', { name: applyStock('Warsaw') }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/v1/admin/inventory/levels', { productId: PRODUCT_ID, warehouseId: WH_A, onHand: 7 }),
    );
    expect(scopedPuts()).toHaveLength(0);
    // The tab's first section does not claim the whole tab applies immediately.
    expect(screen.getByRole('heading', { name: en['inventoryTab.stockMgmt.title']! })).not.toHaveTextContent(
      IMMEDIATE_BADGE,
    );
  });
});

/** `inventoryTab.<key>` with `{name}` placeholders filled. */
function copy(key: string, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[`inventoryTab.${key}`]!,
  );
}
const applyStock = (warehouse: string): string => copy('action.applyStockFor', { warehouse });
const applyThreshold = (warehouse: string): string => copy('action.applyThresholdFor', { warehouse });

describe('the per-warehouse rows (issue #1454, UX audit CAT-01)', () => {
  it('names every input after its warehouse, not only the column', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modePerWarehouse']!));
    for (const warehouse of ['Warsaw', 'Berlin']) {
      expect(screen.getByRole('spinbutton', { name: copy('column.newValueFor', { warehouse }) })).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: copy('column.thresholdFor', { warehouse }) })).toBeInTheDocument();
    }
  });

  it('shows a translated "Apply" on each row, named after its warehouse, and enabled only for a change', async () => {
    await openInventory();
    const apply = screen.getByRole('button', { name: applyStock('Warsaw') });
    expect(apply).toHaveTextContent(en['inventoryTab.action.apply']!);
    // Nothing to apply until the value differs from what is on hand.
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: copy('column.newValueFor', { warehouse: 'Warsaw' }) }), {
      target: { value: '7' },
    });
    expect(apply).toBeEnabled();
  });

  it('says busy while the write is in flight, and announces the result politely', async () => {
    let settle: (value: unknown) => void = () => undefined;
    api.put.mockImplementation(async (path: string) => {
      if (path === '/api/v1/admin/inventory/levels') {
        return new Promise((resolve) => {
          settle = resolve;
        });
      }
      return { data: null };
    });
    await openInventory();
    fireEvent.change(screen.getByRole('spinbutton', { name: copy('column.newValueFor', { warehouse: 'Warsaw' }) }), {
      target: { value: '7' },
    });
    const apply = screen.getByRole('button', { name: applyStock('Warsaw') });
    fireEvent.click(apply);
    await waitFor(() => expect(apply).toHaveAttribute('aria-busy', 'true'));
    expect(apply).toBeDisabled();

    settle({ data: { before: 5, after: 7, productId: PRODUCT_ID, warehouseId: WH_A } });
    const message = await screen.findByText(copy('success.save', { warehouse: 'Warsaw', value: 7 }));
    // A live region that was mounted before it had text (WCAG 4.1.3).
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(apply).not.toHaveAttribute('aria-busy');
  });

  it('applies a per-warehouse threshold immediately, without the one Save', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modePerWarehouse']!));
    fireEvent.change(screen.getByRole('spinbutton', { name: copy('column.thresholdFor', { warehouse: 'Berlin' }) }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: applyThreshold('Berlin') }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/v1/admin/inventory/warehouse-low-stock-thresholds', {
        productId: PRODUCT_ID,
        thresholds: [{ warehouseId: WH_B, threshold: 3 }],
      }),
    );
    expect(await screen.findByText(copy('lowStock.perWarehouseSaved', { warehouse: 'Berlin' }))).toBeInTheDocument();
    expect(scopedPuts()).toHaveLength(0);
  });

  it('reports a failed write as an alert', async () => {
    api.put.mockImplementation(async (path: string) => {
      if (path === '/api/v1/admin/inventory/levels') throw new Error('network');
      return { data: null };
    });
    await openInventory();
    fireEvent.change(screen.getByRole('spinbutton', { name: copy('column.newValueFor', { warehouse: 'Warsaw' }) }), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: applyStock('Warsaw') }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en['inventoryTab.error.save']!);
  });

  it('has no axe violations in either threshold mode', async () => {
    await openInventory();
    const tab = screen.getByRole('tabpanel');
    await expectNoAxeViolations(tab);
    fireEvent.click(screen.getByLabelText(en['inventoryTab.lowStock.modePerWarehouse']!));
    await expectNoAxeViolations(tab);
  });

  it('ships its new copy in Polish too', async () => {
    const pl = (await import('../../../../packages/modules/catalog/i18n/pl.json')).default as Record<string, string>;
    const keys = [
      'inventoryTab.action.apply',
      'inventoryTab.action.applyStockFor',
      'inventoryTab.action.applyThresholdFor',
      'inventoryTab.column.newValueFor',
      'inventoryTab.column.thresholdFor',
      'inventoryTab.stockMgmt.trackStock',
      'inventoryTab.error.load',
    ];
    for (const key of keys) {
      expect(pl[key], key).toBeTruthy();
      expect(pl[key], key).not.toBe(en[key]);
    }
    expect(en['inventoryTab.stockMgmt.disableManageStock']).toBeUndefined();
    expect(en['inventoryTab.stockMgmt.disableManageStockHelp']).toBeUndefined();
  });
});

/**
 * Issue #1492 (UX audit CAT-17): the tab drew kit sections around legacy
 * `b2b-field` inputs, a `b2b-tbl` and two bare radios in a `b2b-row`. Its
 * controls are the kit's now, and the two threshold modes are one radio group
 * named by its section, so a screen reader hears what the choice is about.
 */
describe('the Inventory tab in one visual system (#1492)', () => {
  it('groups the threshold modes as one radio group, named by its section', async () => {
    await openInventory();
    const group = screen.getByRole('radiogroup', { name: en['inventoryTab.lowStock.title']! });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: en['inventoryTab.lowStock.modeCumulative']! })).toBeChecked();
  });

  it('draws the per-warehouse table and its inputs with the kit', async () => {
    await openInventory();
    const table = screen.getByRole('table');
    expect(table).not.toHaveClass('b2b-tbl');
    const input = within(table).getByRole('spinbutton', { name: copy('column.newValueFor', { warehouse: 'Warsaw' }) });
    expect(input).not.toHaveClass('b2b-field');
    expect(input).toHaveClass('border-input');
  });
});
