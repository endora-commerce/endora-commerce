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
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';
import { shippedCoreBundle } from '../../helpers/core-bundle';

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
    fireEvent.change(screen.getByLabelText(en['inventoryTab.lowStock.title']!), { target: { value: '4' } });
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

  it('switching stock management off is a staged change, not a write', async () => {
    await openInventory();
    fireEvent.click(screen.getByLabelText(new RegExp(escape(en['inventoryTab.stockMgmt.disableManageStock']!))));
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
    expect(screen.queryByRole('button', { name: en['inventoryTab.lowStock.save']! })).toBeNull();
    // The only Save on the page that is not a per-warehouse row's is the editor's.
    const saves = screen.getAllByRole('button', { name: /^Save/ }).filter((button) => !button.closest('table'));
    expect(saves.map((button) => button.getAttribute('data-testid'))).toEqual(['product-save']);
  });

  it('keeps per-warehouse stock immediate, under an "Applies immediately" badge', async () => {
    await openInventory();
    const table = screen.getByRole('table');
    const heading = screen.getByRole('heading', { name: new RegExp(en['inventoryTab.table.title']!) });
    expect(heading).toHaveTextContent(en['productEditor.immediate.badge']!);
    const warsaw = within(table).getByText('Warsaw').closest('tr')!;
    fireEvent.change(within(warsaw).getByRole('spinbutton'), { target: { value: '7' } });
    fireEvent.click(within(warsaw).getByRole('button', { name: /^Save/ }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/v1/admin/inventory/levels', { productId: PRODUCT_ID, warehouseId: WH_A, onHand: 7 }),
    );
    expect(scopedPuts()).toHaveLength(0);
    // The stock heading of the editor no longer claims the whole tab applies immediately.
    expect(document.getElementById('product-stock-heading')).not.toHaveTextContent(
      en['productEditor.immediate.badge']!,
    );
  });
});
