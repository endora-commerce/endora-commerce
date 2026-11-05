import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { orgSalesChannels } from './org-sales-channels';

/**
 * Feature 159, T062 — the create-order screen groups its lines
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §2; FR-060 … FR-062):
 * the kit's editor around the items table, each group's summary from the
 * preview's per-line amounts, *Create* sending `groups` and each line's
 * `groupKey` in display order. One product may be on several lines, in
 * different groups (research N-31), and *Split line* makes one (N-33). Without
 * a group the request is the one it always was.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { OrderCreatePage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderCreatePage');

const REPO_ROOT = resolve(process.cwd(), '..');
const ORDERS_EN = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages/modules/orders/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const CUSTOMER = { id: 'cust-1', email: 'jan@acme.test', firstName: 'Jan', lastName: 'Kowalski', organizationName: 'Acme', organizationId: 'org-1' };
const ORG_ADDRESS = {
  id: 'addr-1',
  recipientName: 'Acme HQ',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: '00-001',
  country: 'PL',
  isDefault: true,
};
const PRODUCTS = [
  { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', type: 'simple', name: 'Widget' },
  { id: 'prod-2', sku: 'SKU-2', slug: 'p2', status: 'active', type: 'simple', name: 'Gadget' },
];
const PRICES: Record<string, number> = { 'prod-1': 10, 'prod-2': 20 };

const BUNDLE = {
  ...passthroughBundle('core', [
    'common.action.back',
    'orderCreate.field.customer',
    'orderCreate.field.salesChannel',
    'orderCreate.field.paymentMethod',
    'orderCreate.field.deliveryMethod',
    'orderCreate.field.product',
    'orderCreate.field.quantity',
    'orderCreate.items.quickSearch',
    'orderCreate.submit',
  ]),
  orders: ORDERS_EN,
};

const QUICK_SEARCH = 'orderCreate.items.quickSearch';
// toHaveTextContent collapses whitespace, the currency's no-break space included.
const money = (amount: number): string => formatMoney(amount, 'PLN').replace(/\s/g, ' ');

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) return Promise.resolve({ data: { personal: [], organization: [ORG_ADDRESS] } });
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) {
      const q = new URLSearchParams(path.split('?')[1] ?? '').get('q') ?? '';
      return Promise.resolve({ data: PRODUCTS.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase())) });
    }
    if (path.endsWith('/sales-channels')) {
      return Promise.resolve(orgSalesChannels([{ id: 'chan-1', code: 'CH', name: { 'en-US': 'Channel 1' }, active: true }]));
    }
    if (path.startsWith('/api/v1/admin/payment-methods')) {
      return Promise.resolve({ data: [{ id: 'pay-1', code: 'PM', name: { 'en-US': 'Payment 1' }, status: 'active' }] });
    }
    if (path.startsWith('/api/v1/admin/delivery-methods')) {
      return Promise.resolve({ data: [{ id: 'del-1', code: 'DM', name: { 'en-US': 'Delivery 1' }, status: 'active' }] });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string, body: { items: Array<{ productId: string; quantity: number }> }) => {
    if (path.endsWith('/orders/preview')) {
      const lines = body.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: PRICES[item.productId]!.toFixed(2),
        currency: 'PLN',
        lineTotal: PRICES[item.productId]! * item.quantity,
        taxRate: 0.23,
      }));
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      return Promise.resolve({
        data: {
          lines,
          summary: {
            subtotal,
            taxTotal: Math.round(subtotal * 23) / 100,
            deliveryTotal: 0,
            paymentSurcharge: 0,
            discountTotal: 0,
            total: Math.round(subtotal * 123) / 100,
            currency: 'PLN',
          },
          messages: [],
        },
      });
    }
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

function renderPage(): { container: HTMLElement } {
  return renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/orders/new']}>
          <OrderCreatePage />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['*'] }),
          presence: modulePresence({ present: ['orders'] }),
        },
      )}
    </StrictMode>,
    BUNDLE,
  );
}

async function fillParties(): Promise<void> {
  await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
  await pick('customerAccountId', 'Jan Kowalski');
  await pick('salesChannelId', 'Channel 1');
  await pick('paymentMethodId', 'Payment 1');
  await pick('deliveryMethodId', 'Delivery 1');
}

async function quickAdd(name: string): Promise<void> {
  const quick = screen.getByLabelText(QUICK_SEARCH);
  await userEvent.clear(quick);
  await userEvent.type(quick, name.slice(0, 3));
  await pick(QUICK_SEARCH, name);
}

const rowgroup = (name: string): HTMLElement => screen.getByRole('rowgroup', { name });

async function groupGadgetInHallA(): Promise<void> {
  await fillParties();
  await quickAdd('Widget');
  await quickAdd('Gadget');
  await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'Hall A');
  await userEvent.click(screen.getByRole('button', { name: 'Move Gadget to group' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hall A' }));
  await waitFor(() => expect(within(rowgroup('Hall A')).getByText('Gadget')).toBeInTheDocument());
}

describe('OrderCreatePage — line groups (T062)', () => {
  it('groups lines, summarises each group from the preview and sends groups and groupKey in display order', async () => {
    const { container } = renderPage();
    await groupGadgetInHallA();
    expect(within(rowgroup('Ungrouped')).getByText('Widget')).toBeInTheDocument();

    // Count, net, VAT and gross of the group's lines, from the preview's line amounts.
    await waitFor(() =>
      expect(rowgroup('Hall A')).toHaveTextContent(
        `1 item · Net ${money(20)} · VAT ${money(4.6)} · Gross ${money(24.6)}`,
      ),
    );
    expect(rowgroup('Ungrouped')).toHaveTextContent(`1 item · Net ${money(10)} · VAT ${money(2.3)} · Gross ${money(12.3)}`);
    await expectNoAxeViolations(container);

    // The preview is asked about the lines alone — its request carries no grouping.
    const previewBodies = postSpy.mock.calls.filter(([path]) => String(path).endsWith('/orders/preview'));
    for (const [, body] of previewBodies) {
      expect(JSON.stringify(body)).not.toContain('groupKey');
      expect(body).not.toHaveProperty('groups');
    }

    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    const create = await waitFor(() => {
      const call = postSpy.mock.calls.find(([path]) => path === '/api/v1/admin/orders');
      expect(call).toBeDefined();
      return call!;
    });
    const body = create[1] as { groups: Array<{ key: string; name: string }>; items: unknown[] };
    expect(body.groups).toEqual([{ key: expect.any(String), name: 'Hall A' }]);
    expect(body.items).toEqual([
      { productId: 'prod-2', quantity: 1, groupKey: body.groups[0]!.key },
      { productId: 'prod-1', quantity: 1, groupKey: null },
    ]);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/orders/new-order-1'));
  });

  it('blocks Create while a group has no name', async () => {
    renderPage();
    await fillParties();
    await quickAdd('Widget');
    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    // Long enough for the preview to answer, which is what unlocks a valid form.
    await waitFor(() => expect(rowgroup('Ungrouped')).toHaveTextContent(`Net ${money(10)}`));
    expect(screen.getByText('orderCreate.submit')).toBeDisabled();
  });

  it('places one product on two lines in two groups — each its own quantity, price and summary (N-31)', async () => {
    renderPage();
    await fillParties();
    await quickAdd('Widget');
    await quickAdd('Widget');
    await waitFor(() => expect(screen.getAllByText('Widget')).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'Hall A');
    await userEvent.click(screen.getAllByRole('button', { name: 'Move Widget to group' })[1]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hall A' }));
    const hallQuantity = within(rowgroup('Hall A')).getByRole('textbox', { name: 'orderCreate.field.quantity Widget' });
    await userEvent.clear(hallQuantity);
    await userEvent.type(hallQuantity, '3');
    await waitFor(() => expect(rowgroup('Hall A')).toHaveTextContent(`1 item · Net ${money(30)}`));
    expect(rowgroup('Ungrouped')).toHaveTextContent(`1 item · Net ${money(10)}`);

    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    const create = await waitFor(() => {
      const call = postSpy.mock.calls.find(([path]) => path === '/api/v1/admin/orders');
      expect(call).toBeDefined();
      return call!;
    });
    const body = create[1] as { groups: Array<{ key: string }>; items: unknown[] };
    expect(body.items).toEqual([
      { productId: 'prod-1', quantity: 3, groupKey: body.groups[0]!.key },
      { productId: 'prod-1', quantity: 1, groupKey: null },
    ]);
  });

  it('splits a line into a group with Split line (N-33)', async () => {
    renderPage();
    await fillParties();
    await quickAdd('Widget');
    const quantity = screen.getByRole('textbox', { name: 'orderCreate.field.quantity Widget' });
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'Hall A');

    await userEvent.click(screen.getByRole('button', { name: 'Split line: Widget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Split line: Widget' });
    const moved = within(dialog).getByLabelText(ORDERS_EN['lineGroups.split.quantity']!);
    await userEvent.clear(moved);
    await userEvent.type(moved, '2');
    await userEvent.selectOptions(within(dialog).getByLabelText(ORDERS_EN['lineGroups.split.target']!), 'Hall A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Split line' }));

    expect(within(rowgroup('Hall A')).getByRole('textbox', { name: 'orderCreate.field.quantity Widget' })).toHaveValue('2');
    expect(within(rowgroup('Ungrouped')).getByRole('textbox', { name: 'orderCreate.field.quantity Widget' })).toHaveValue('3');
    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    const create = await waitFor(() => {
      const call = postSpy.mock.calls.find(([path]) => path === '/api/v1/admin/orders');
      expect(call).toBeDefined();
      return call!;
    });
    const body = create[1] as { groups: Array<{ key: string }>; items: unknown[] };
    expect(body.items).toEqual([
      { productId: 'prod-1', quantity: 2, groupKey: body.groups[0]!.key },
      { productId: 'prod-1', quantity: 3, groupKey: null },
    ]);
  });

  it('without a group sends the request it always sent', async () => {
    renderPage();
    await fillParties();
    await quickAdd('Widget');
    expect(screen.queryByRole('rowgroup', { name: 'Ungrouped' })).toBeNull();
    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders', {
        customerAccountId: 'cust-1',
        salesChannelId: 'chan-1',
        deliveryMethodId: 'del-1',
        paymentMethodId: 'pay-1',
        deliveryAddressId: 'addr-1',
        billingAddressId: 'addr-1',
        items: [{ productId: 'prod-1', quantity: 1 }],
      }),
    );
  });
});
