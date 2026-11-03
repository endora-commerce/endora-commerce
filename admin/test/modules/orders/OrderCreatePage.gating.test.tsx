import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { orgSalesChannels } from './org-sales-channels';

/**
 * Feature 145, User Story 2 (FR-021, FR-025): on Create order, **Items** and
 * **Order summary** stay hidden until the customer and the sales channel — the
 * two inputs pricing needs — are set. A hint names what is missing; payment,
 * delivery and addresses do not gate anything. Hiding never discards a line.
 *
 * The rig is `OrderCreatePage.test.tsx`'s: the kit's `apiClient` mocked, the
 * real session and presence providers, an empty zone registry.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
  return { ...actual, useNavigate: () => vi.fn() };
});

const { OrderCreatePage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderCreatePage');

const JAN = { id: 'cust-1', email: 'jan@acme.test', firstName: 'Jan', lastName: 'Kowalski', organizationName: 'Acme', organizationId: 'org-1' };
const EWA = { id: 'cust-2', email: 'ewa@beta.test', firstName: 'Ewa', lastName: 'Nowak', organizationName: 'Beta', organizationId: 'org-2' };
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', name: { 'en-US': 'Widget' } };

const PREVIEW = {
  lines: [{ productId: 'prod-1', quantity: 1, unitPrice: '10.00', currency: 'PLN', lineTotal: 10 }],
  summary: { subtotal: 10, taxTotal: 0, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, total: 10, currency: 'PLN' },
  messages: [],
};

const ITEMS = 'orderCreate.section.items';
const SUMMARY = 'orderCreate.summary.title';
const MISSING_BOTH = 'orderCreate.gate.missingBoth';
const MISSING_CUSTOMER = 'orderCreate.gate.missingCustomer';
const MISSING_CHANNEL = 'orderCreate.gate.missingChannel';
const QUICK_SEARCH = 'orderCreate.items.quickSearch';

const BUNDLE = passthroughBundle('core', [
  'common.action.back',
  'common.combobox.clearSelection',
  ITEMS,
  SUMMARY,
  MISSING_BOTH,
  MISSING_CUSTOMER,
  MISSING_CHANNEL,
  QUICK_SEARCH,
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) return Promise.resolve({ data: { personal: [], organization: [] } });
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: JAN });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [JAN, EWA] });
    if (path === '/api/v1/admin/catalog/products/prod-1') return Promise.resolve({ data: PRODUCT });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    if (path.endsWith('/sales-channels')) {
      return Promise.resolve(
        orgSalesChannels([
          { id: 'chan-1', code: 'CH1', name: { 'en-US': 'Channel 1' }, active: true },
          { id: 'chan-2', code: 'CH2', name: { 'en-US': 'Channel 2' }, active: true },
        ]),
      );
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string) => {
    if (path.endsWith('/orders/preview')) return Promise.resolve({ data: PREVIEW });
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

function renderPage(entry = '/orders/new'): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[entry]}>
        <OrderCreatePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'quick_order'] }),
      },
    ),
    BUNDLE,
  );
}

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  const option = await screen.findByRole('option', { name: new RegExp(optionLabel) });
  await userEvent.click(option);
}

async function pickCustomer(name: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('customerAccountId'), name.split(' ')[0]!);
  await pick('customerAccountId', name);
}

/** Clear a combobox through its own clear button. */
async function clearCombobox(label: string): Promise<void> {
  const input = screen.getByLabelText(label);
  const container = input.closest('div.relative') as HTMLElement;
  await userEvent.click(within(container).getByRole('button', { name: 'common.combobox.clearSelection' }));
}

/** Add the widget as a line through the quick search beside Browse products. */
async function addWidget(): Promise<void> {
  await userEvent.type(screen.getByLabelText(QUICK_SEARCH), 'Wid');
  await pick(QUICK_SEARCH, 'Widget');
}

/** The widget's line, by its name cell. */
function widgetLine(): HTMLElement | null {
  return screen.queryByText('Widget', { selector: '[data-line-name]' });
}

const previewCalls = (): Array<Record<string, unknown>> =>
  postSpy.mock.calls
    .filter(([path]) => path === '/api/v1/admin/orders/preview')
    .map(([, body]) => body as Record<string, unknown>);

function expectGated(hint: string): void {
  expect(screen.queryByText(ITEMS)).not.toBeInTheDocument();
  expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(QUICK_SEARCH)).not.toBeInTheDocument();
  expect(widgetLine()).not.toBeInTheDocument();
  expect(screen.getByText(hint)).toBeInTheDocument();
}

describe('OrderCreatePage — Items and Order summary gated on customer and sales channel', () => {
  it('hides both sections on a fresh form and names both missing fields (sc. 1)', async () => {
    renderPage();
    expectGated(MISSING_BOTH);
    expect(screen.queryByText(MISSING_CUSTOMER)).not.toBeInTheDocument();
    expect(screen.queryByText(MISSING_CHANNEL)).not.toBeInTheDocument();
  });

  it('names the channel once only the customer is set, then shows Items, and the summary after the first priced line (sc. 2)', async () => {
    renderPage();
    await pickCustomer('Jan Kowalski');
    expectGated(MISSING_CHANNEL);

    await pick('salesChannelId', 'Channel 1');
    expect(await screen.findByText(ITEMS)).toBeInTheDocument();
    expect(screen.queryByText(MISSING_CHANNEL)).not.toBeInTheDocument();
    // No line priced yet — no summary.
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();

    await addWidget();
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  // Issue #515 — the channels offered are the customer's Organization's, so
  // there is no channel to choose before there is a customer.
  it('offers no channel before a customer is chosen', async () => {
    renderPage();
    expect(screen.getByLabelText('salesChannelId')).toBeDisabled();
    expectGated(MISSING_BOTH);
    expect(getSpy.mock.calls.some(([p]) => String(p).endsWith('/sales-channels'))).toBe(false);
  });

  it('keeps the lines and re-prices them when the customer or channel changes (sc. 3)', async () => {
    renderPage();
    await pickCustomer('Jan Kowalski');
    await pick('salesChannelId', 'Channel 1');
    await addWidget();
    await screen.findByText(SUMMARY);

    await pick('salesChannelId', 'Channel 2');
    await waitFor(() =>
      expect(previewCalls().at(-1)).toMatchObject({
        customerAccountId: 'cust-1',
        salesChannelId: 'chan-2',
        items: [{ productId: 'prod-1', quantity: 1 }],
      }),
    );

    // Another customer's Organization has channels of its own: the choice is
    // asked again (issue #515), and the lines stay.
    await clearCombobox('customerAccountId');
    await pickCustomer('Ewa Nowak');
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toBeEnabled());
    await pick('salesChannelId', 'Channel 2');
    await waitFor(() =>
      expect(previewCalls().at(-1)).toMatchObject({
        customerAccountId: 'cust-2',
        salesChannelId: 'chan-2',
        items: [{ productId: 'prod-1', quantity: 1 }],
      }),
    );
    expect(widgetLine()).toBeInTheDocument();
  });

  it('hides both sections when a required field is cleared and brings the same lines back (sc. 4, FR-025)', async () => {
    renderPage();
    await pickCustomer('Jan Kowalski');
    await pick('salesChannelId', 'Channel 1');
    await addWidget();
    await screen.findByText(SUMMARY);

    await clearCombobox('salesChannelId');
    await waitFor(() => expectGated(MISSING_CHANNEL));

    await pick('salesChannelId', 'Channel 1');
    await waitFor(() => expect(widgetLine()).toBeInTheDocument());
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  it('shows Items at once when opened with a customer and a sales channel (sc. 5)', async () => {
    renderPage('/orders/new?customerAccountId=cust-1&salesChannelId=chan-1');
    // As soon as the Organization's channels are read and the link's is among them (issue #515).
    expect(await screen.findByText(ITEMS)).toBeInTheDocument();
    expect(screen.getByLabelText(QUICK_SEARCH)).toBeInTheDocument();
    expect(screen.queryByText(MISSING_BOTH)).not.toBeInTheDocument();
  });

  it('still counts hidden lines as unsaved work (Edge Cases)', async () => {
    renderPage();
    await pickCustomer('Jan Kowalski');
    await pick('salesChannelId', 'Channel 1');
    await addWidget();

    // Back to the opened state for every field but the lines, which are now
    // hidden. Clearing the customer clears the channel with it (issue #515).
    await clearCombobox('customerAccountId');
    await waitFor(() => expectGated(MISSING_BOTH));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await userEvent.click(screen.getByRole('link', { name: 'common.action.back' }));
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });
});
