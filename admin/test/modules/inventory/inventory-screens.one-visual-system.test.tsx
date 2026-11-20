import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { LowStockPage } from '../../../../packages/modules/inventory/src/admin/pages/LowStockPage';
import { WarehousesList } from '../../../../packages/modules/inventory/src/admin/pages/WarehousesList';
import { AvailabilityNotificationsPage } from '../../../../packages/modules/inventory/src/admin/pages/AvailabilityNotificationsPage';
import { StockImportWizard } from '../../../../packages/modules/inventory/src/admin/pages/StockImportWizard';
import { WarehouseEditor } from '../../../../packages/modules/inventory/src/admin/pages/WarehouseEditor';

/**
 * Issue #1492 (UX audit CAT-17), the inventory module's remaining screens: the
 * low-stock list, the warehouses list and editor, the back-in-stock queue and
 * the stock import. Each drew `b2b-card`s painted with inline colours as status
 * banners, which carry no live role (WCAG 4.1.3), and legacy fields whose
 * labels were not tied to their inputs (SC 1.3.1). They draw kit primitives
 * now; `admin/test/unit/one-visual-system.test.ts` holds the class vocabulary,
 * and this file holds the behaviour the move fixed.
 */
const en = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const k = (key: string): string => {
  const value = en[key];
  if (value === undefined) throw new Error(`missing core key ${key}`);
  return value;
};

const get = vi.fn<(url: string) => Promise<unknown>>();
const post = vi.fn<(url: string, body: unknown) => Promise<unknown>>();
const patch = vi.fn<(url: string, body: unknown) => Promise<unknown>>();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (url: string) => get(url),
      post: (url: string, body: unknown) => post(url, body),
      patch: (url: string, body: unknown) => patch(url, body),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});


function mount(ui: ReactElement, path: string, permissions = ['inventory:read', 'inventory:write']): void {
  renderWithI18n(
    withSession(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>, {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: ['inventory'] }),
    }),
    { core: en },
  );
}

const WAREHOUSE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  code: 'main',
  name: 'Main warehouse',
  active: true,
  description: null,
  address: { street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', countryCode: 'PL' },
  contact: null,
  defaultLowStockThreshold: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  totals: { products: 3, onHand: 12, isDefaultForChannelCount: 1 },
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

describe('low-stock list (#1492)', () => {
  it('announces loading as a status, then shows the rows in the kit table', async () => {
    let release: (value: unknown) => void = () => undefined;
    get.mockImplementation(() => new Promise((r) => { release = r; }));
    mount(<LowStockPage />, '/inventory/low-stock');
    expect(screen.getByRole('status')).toHaveTextContent(k('inventory.loading'));
    release({
      items: [
        { productId: 'p-1', productSku: 'SKU-1', productName: 'Bolt', cumulativeOnHand: 2, lowStockThreshold: 5 },
      ],
    });
    const table = await screen.findByRole('table');
    expect(table.getAttribute('data-slot') ?? table.className).toBeTruthy();
    const row = within(table).getByText('Bolt').closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', { name: k('inventory.action.editStock') });
    // The row's action edits stock, so it lands on the Inventory tab (as the inventory list does).
    expect(link.getAttribute('href')).toBe('/catalog/products/p-1?tab=inventory');
  });

  it('shows a load failure as an alert, not a card painted red', async () => {
    get.mockRejectedValue(new Error('down'));
    mount(<LowStockPage />, '/inventory/low-stock');
    expect(await screen.findByRole('alert')).toHaveTextContent(k('inventory.lowStock.error.load'));
  });
});

describe('warehouses list (#1492)', () => {
  it('is the kit toolbar: a named search box and an "Active only" chip that announces its state', async () => {
    get.mockResolvedValue({ items: [WAREHOUSE], page: 0, pageSize: 25, total: 1 });
    mount(<WarehousesList />, '/warehouses');
    await screen.findByText('Main warehouse');
    expect(screen.getByRole('searchbox', { name: k('warehouses.search.label') })).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: k('warehouses.filter.activeOnly') });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(get.mock.calls.some(([url]) => url.includes('activeOnly=true'))).toBe(true));
  });

  it('shows a load failure as an alert', async () => {
    get.mockRejectedValue(new Error('down'));
    mount(<WarehousesList />, '/warehouses');
    expect(await screen.findByRole('alert')).toHaveTextContent(k('warehouses.error.load'));
  });
});

describe('availability notifications (#1492)', () => {
  const ROW = {
    id: 'n-1',
    productId: 'p-1',
    productName: 'Bolt',
    productSku: 'SKU-1',
    customerAccountId: null,
    email: 'buyer@example.test',
    status: 'queued',
    queuedAt: '2026-11-01T00:00:00.000Z',
    notifiedAt: null,
  };

  it('exposes the status chips’ state with aria-pressed, one at a time', async () => {
    get.mockResolvedValue({ items: [ROW], page: 0, pageSize: 200, total: 1 });
    mount(<AvailabilityNotificationsPage />, '/inventory/availability');
    await screen.findByText('buyer@example.test');
    const region = screen.getByRole('search', { name: k('inventory.availability.toolbar.label') });
    expect(within(region).getByRole('searchbox', { name: k('inventory.availability.searchLabel') })).toBeInTheDocument();
    const queued = within(region).getByRole('button', { name: k('inventory.availability.status.queued') });
    const notified = within(region).getByRole('button', { name: k('inventory.availability.status.notified') });
    expect(queued.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(notified);
    await waitFor(() => expect(notified.getAttribute('aria-pressed')).toBe('true'));
    expect(queued.getAttribute('aria-pressed')).toBe('false');
  });

  it('announces a cancelled subscription in a status region', async () => {
    get.mockResolvedValue({ items: [ROW], page: 0, pageSize: 200, total: 1 });
    patch.mockResolvedValue({});
    mount(<AvailabilityNotificationsPage />, '/inventory/availability');
    await screen.findByText('buyer@example.test');
    fireEvent.click(screen.getByRole('button', { name: k('inventory.availability.cancel') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: k('inventory.availability.cancelSubscription') }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((node) => node.textContent?.includes(k('inventory.availability.info.cancelled'))),
      ).toBe(true),
    );
  });
});

describe('stock import (#1492)', () => {
  it('names the warehouse picker, the file input and the paste box', async () => {
    get.mockResolvedValue({ items: [WAREHOUSE], page: 0, pageSize: 200, total: 1 });
    mount(<StockImportWizard />, '/inventory/import', ['inventory:write']);
    const select = await screen.findByLabelText(k('inventory.import.field.warehouse'));
    expect(select.tagName).toBe('SELECT');
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(WAREHOUSE.id));
    expect(screen.getByLabelText(k('inventory.import.field.file')).getAttribute('type')).toBe('file');
    expect(screen.getByLabelText(k('inventory.import.field.paste')).tagName).toBe('TEXTAREA');
  });

  it('prints each skipped row’s reason in words, and announces the summary', async () => {
    get.mockResolvedValue({ items: [WAREHOUSE], page: 0, pageSize: 200, total: 1 });
    post.mockResolvedValue({
      data: {
        rowsRead: 2,
        rowsApplied: 1,
        rowsSkipped: 1,
        errors: [{ row: 2, sku: 'NOPE', reason: 'product_not_found' }],
      },
    });
    mount(<StockImportWizard />, '/inventory/import', ['inventory:write']);
    const paste = await screen.findByLabelText(k('inventory.import.field.paste'));
    await waitFor(() =>
      expect((screen.getByLabelText(k('inventory.import.field.warehouse')) as HTMLSelectElement).value).toBe(WAREHOUSE.id),
    );
    fireEvent.change(paste, { target: { value: 'sku,onHand\nA,1\nNOPE,2\n' } });
    fireEvent.click(screen.getByRole('button', { name: k('inventory.import.previewDryRun') }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText(k('inventory.import.reason.product_not_found'))).toBeInTheDocument();
    expect(within(table).queryByText('product_not_found')).not.toBeInTheDocument();
    const status = screen.getAllByRole('status').find((node) => node.textContent?.includes(k('inventory.import.dryRunSummary')));
    expect(status).toBeDefined();
  });
});

describe('warehouse editor (#1492)', () => {
  async function mountEditor(): Promise<void> {
    // The country picker reads the dictionary; the editor reads the warehouse.
    get.mockImplementation(async (url) => (url.includes('/warehouses/') ? { data: WAREHOUSE } : { data: [] }));
    mount(
      <Routes>
        <Route path="/warehouses/:id" element={<WarehouseEditor />} />
      </Routes>,
      `/warehouses/${WAREHOUSE.id}`,
    );
    await screen.findByDisplayValue('Main warehouse');
  }

  it('ties every address field to its label', async () => {
    await mountEditor();
    expect(screen.getByLabelText(k('warehouses.editor.field.street'))).toHaveValue('Prosta 1');
    expect(screen.getByLabelText(k('warehouses.editor.field.city'))).toHaveValue('Warszawa');
    expect(screen.getByLabelText(k('warehouses.editor.field.postalCode'))).toHaveValue('00-001');
    expect(screen.getByLabelText(k('warehouses.editor.field.contactEmail'))).toHaveValue('');
  });

  it('describes the code field by its hint', async () => {
    await mountEditor();
    // The label carries the required asterisk after the name.
    const code = screen.getByLabelText(new RegExp(`^${k('warehouses.editor.field.code')}`));
    const describedBy = code.getAttribute('aria-describedby') ?? '';
    expect(describedBy).not.toBe('');
    const text = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(text).toContain(k('warehouses.editor.field.codeHelp'));
  });

  it('keeps Save the one filled button: Delete is outline (Von Restorff)', async () => {
    await mountEditor();
    const remove = screen.getByRole('button', { name: k('warehouses.action.delete') });
    const save = screen.getByRole('button', { name: k('warehouses.action.saveChanges') });
    expect(remove.className).toContain('border-input');
    expect(save.className).toContain('bg-primary');
  });
});
