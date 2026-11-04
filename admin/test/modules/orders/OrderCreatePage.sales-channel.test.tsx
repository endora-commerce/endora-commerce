import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { orgSalesChannels } from './org-sales-channels';

/**
 * Issue #515 — the channel an operator places a customer's order on is chosen
 * among exactly what the API accepts (`422 ORDER_SALES_CHANNEL_NOT_ALLOWED`):
 * the customer's Organization's own active channels, read from
 * `GET /api/v1/admin/organizations/:id/sales-channels`. Never another active
 * channel, nor an inactive one of its own. One is preselected when it is the
 * only one, else the operator chooses; a channel handed over in the link is
 * kept only when it is one of them. With none, or when they cannot be read, the
 * screen says so and nothing can be sent. The rig is `OrderCreatePage.test.tsx`'s.
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

const ORG = 'org-1';
const CHANNELS_URL = `/api/v1/admin/organizations/${ORG}/sales-channels`;
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationName: 'Acme',
  organizationId: ORG,
};
const ORG_ADDRESS = {
  id: 'addr-1',
  recipientName: 'Acme HQ',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: '00-001',
  country: 'PL',
  isDefault: true,
};
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', name: { 'en-US': 'Widget' } };
const PREVIEW = {
  lines: [{ productId: 'prod-1', quantity: 1, unitPrice: '10.00', currency: 'PLN', lineTotal: 10 }],
  summary: { subtotal: 10, taxTotal: 0, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, total: 10, currency: 'PLN' },
  messages: [],
};

const RETAIL = { id: 'chan-retail', code: 'RET', name: { 'en-US': 'Retail' }, active: true };
const WHOLESALE = { id: 'chan-wholesale', code: 'WHS', name: { 'en-US': 'Wholesale' }, active: true };
const FOREIGN = { id: 'chan-foreign', code: 'FOR', name: { 'en-US': 'Foreign store' }, active: true };
const RETIRED = { id: 'chan-retired', code: 'OLD', name: { 'en-US': 'Retired store' }, active: false };
const ALL = [RETAIL, WHOLESALE, FOREIGN, RETIRED];

/** The Organization's assignment; `null` makes the read fail. */
let assigned: string[] | null;

const BUNDLE = passthroughBundle('core', [
  'common.action.back',
  'common.action.retry',
  'orderCreate.items.quickSearch',
  'orderCreate.submit',
  'orderCreate.channelsLoadError',
  'orderCreate.noChannelWarning',
]);
const QUICK_SEARCH = 'orderCreate.items.quickSearch';

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  assigned = [RETAIL.id];
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) return Promise.resolve({ data: { personal: [], organization: [ORG_ADDRESS] } });
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    if (path === CHANNELS_URL) {
      return assigned === null
        ? Promise.reject(new Error('network'))
        : Promise.resolve(orgSalesChannels(ALL, assigned, ORG));
    }
    if (path.startsWith('/api/v1/admin/payment-methods')) {
      return Promise.resolve({ data: [{ id: 'pay-1', code: 'PM', name: { 'en-US': 'Payment 1' }, status: 'active' }] });
    }
    if (path.startsWith('/api/v1/admin/delivery-methods')) {
      return Promise.resolve({ data: [{ id: 'del-1', code: 'DM', name: { 'en-US': 'Delivery 1' }, status: 'active' }] });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string) => {
    if (path.endsWith('/orders/preview')) return Promise.resolve({ data: PREVIEW });
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

function renderPage(entry: string): void {
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
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

/** Methods and a line: everything but the channel. */
async function fillTheRest(): Promise<void> {
  await pick('paymentMethodId', 'Payment 1');
  await pick('deliveryMethodId', 'Delivery 1');
  await userEvent.type(await screen.findByLabelText(QUICK_SEARCH), 'Wid');
  await pick(QUICK_SEARCH, 'Widget');
}

const creates = () => postSpy.mock.calls.filter(([path]) => path === '/api/v1/admin/orders');
const channelReads = () => getSpy.mock.calls.filter(([path]) => path === CHANNELS_URL);

describe('OrderCreatePage — the sales channel (#515)', () => {
  it('reads the customer’s Organization’s channels, preselects the only one and sends it', async () => {
    renderPage('/orders/new?customerAccountId=cust-1');
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toHaveValue('Retail'));
    expect(channelReads().length).toBeGreaterThan(0);
    // The old list of every active channel is not read any more.
    expect(getSpy.mock.calls.some(([path]) => String(path).startsWith('/api/v1/admin/sales-channels'))).toBe(false);

    await fillTheRest();
    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    expect(creates()[0]?.[1]).toMatchObject({ customerAccountId: 'cust-1', salesChannelId: RETAIL.id });
  });

  it('offers only the Organization’s active channels: never another one, never an inactive one of its own', async () => {
    assigned = [RETAIL.id, WHOLESALE.id, RETIRED.id];
    renderPage('/orders/new?customerAccountId=cust-1');
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toBeEnabled());
    // Two to choose from: none is chosen for the operator.
    expect(screen.getByLabelText('salesChannelId')).toHaveValue('');

    await userEvent.click(screen.getByLabelText('salesChannelId'));
    const offered = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(offered.some((t) => t.includes('Retail'))).toBe(true);
    expect(offered.some((t) => t.includes('Wholesale'))).toBe(true);
    expect(offered.some((t) => t.includes('Foreign store'))).toBe(false);
    expect(offered.some((t) => t.includes('Retired store'))).toBe(false);
  });

  it('keeps a channel the link names when it is one of them', async () => {
    assigned = [RETAIL.id, WHOLESALE.id];
    renderPage(`/orders/new?customerAccountId=cust-1&salesChannelId=${WHOLESALE.id}`);
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toHaveValue('Wholesale'));
  });

  it('drops a channel the link names when it is not one of them, and does not call that unsaved work', async () => {
    assigned = [RETAIL.id, WHOLESALE.id];
    renderPage(`/orders/new?customerAccountId=cust-1&salesChannelId=${FOREIGN.id}`);
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toBeEnabled());
    expect(screen.getByLabelText('salesChannelId')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('deliveryAddress-existing')).toHaveValue('Acme HQ ★'));

    // Nothing the operator chose changed: leaving asks nothing.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      await userEvent.click(screen.getByRole('link', { name: 'common.action.back' }));
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
    // And no preview was asked about the dropped channel.
    expect(postSpy.mock.calls.some(([, body]) => (body as { salesChannelId?: string })?.salesChannelId === FOREIGN.id)).toBe(
      false,
    );
  });

  it('says the Organization has no active channel and sends nothing', async () => {
    assigned = [RETIRED.id];
    renderPage('/orders/new?customerAccountId=cust-1');
    expect(await screen.findByText('orderCreate.noChannelWarning')).toBeInTheDocument();
    expect(screen.queryByLabelText('salesChannelId')).toBeNull();
    expect(screen.getByText('orderCreate.submit')).toBeDisabled();
  });

  it('says the channels cannot be read, sends nothing, and offers a retry that recovers', async () => {
    assigned = null;
    renderPage('/orders/new?customerAccountId=cust-1');
    expect(await screen.findByText('orderCreate.channelsLoadError')).toBeInTheDocument();
    expect(screen.getByText('orderCreate.submit')).toBeDisabled();

    assigned = [RETAIL.id];
    await userEvent.click(screen.getByRole('button', { name: 'common.action.retry' }));
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toHaveValue('Retail'));
    expect(screen.queryByText('orderCreate.channelsLoadError')).toBeNull();
  });

  it('shows the server’s sentence when the create is refused for the channel', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path.endsWith('/orders/preview')) return Promise.resolve({ data: PREVIEW });
      return Promise.reject(
        new ApiError(422, {
          error: {
            code: 'ORDER_SALES_CHANNEL_NOT_ALLOWED',
            message: "This sales channel is not one of the organization's active sales channels. Choose one of them.",
          },
        }),
      );
    });
    renderPage('/orders/new?customerAccountId=cust-1');
    await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toHaveValue('Retail'));
    await fillTheRest();
    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    expect(
      await screen.findByText("This sales channel is not one of the organization's active sales channels. Choose one of them."),
    ).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
