import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The real providers, not a stubbed hook (feature 091, P3 and P4d).
 *
 * This file used to `vi.mock('../../../../packages/admin-shell/src/lib/module-presence')` with an
 * `isPresent: () => true`. That mock was already inert for anything inside the
 * kit — P3 moved the hook into `@endora-commerce/admin-kit/lib`, where a mock at
 * the admin's shim path cannot reach it — and P4d is where it started to
 * matter: this screen mounts the `order.entry.tabs` zone, whose enumeration
 * runs `useSurfaceVisibility` and `useAdminContributions` inside the package.
 * `useAdminZone` **refuses** a mount with no `AdminContributionsProvider` above
 * it rather than answering "nobody contributed", so a host screen's test has to
 * mount the real thing.
 *
 * The registry is deliberately **empty**: these cases are about the order form,
 * and an empty registry means the strip renders nothing, which is the same
 * thing the old presence stub produced on screen. The strip's own cases are
 * `admin/test/modules/orders/order-entry-tabs-zone.test.tsx`.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

/**
 * The kit's module, not the admin's shim.
 *
 * This screen still lives in `admin/src` and still writes `@/lib/api-client`,
 * which is a re-export of `@endora-commerce/admin-kit/lib` — so mocking the kit
 * covers it. The reverse is not true, and that is what this had to change for:
 * the product picker this page renders is the kit's since feature 091's batch 8
 * and builds its own request from the kit's `apiClient`, past the shim
 * entirely. Mocking the shim left the picker on the real client, whose every
 * call `admin/test/setup.ts` refuses by name — so the page rendered with no
 * products and the case failed on an option that had never been fetched.
 */
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

// Reference data returned by the mocked endpoints. The address book has one
// default org address, which the page auto-selects for both delivery + billing.
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationName: 'Acme',
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
  summary: {
    subtotal: 10,
    taxTotal: 0,
    deliveryTotal: 0,
    paymentSurcharge: 0,
    discountTotal: 0,
    total: 10,
    currency: 'PLN',
  },
  messages: [],
};

const BUNDLE = passthroughBundle('core', [
  'common.action.back',
  'orderCreate.field.customer',
  'orderCreate.field.salesChannel',
  'orderCreate.field.paymentMethod',
  'orderCreate.field.deliveryMethod',
  'orderCreate.field.product',
  'orderCreate.field.quantity',
  'orderCreate.submit',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) {
      return Promise.resolve({ data: { personal: [], organization: [ORG_ADDRESS] } });
    }
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: 'chan-1', code: 'CH', name: { 'en-US': 'Channel 1' }, active: true }] });
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

/** Open a combobox by its aria-label and click the option matching `label`. */
async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  const option = await screen.findByRole('option', { name: new RegExp(optionLabel) });
  await userEvent.click(option);
}

/**
 * The page under the real session and presence providers, with no zone
 * contribution — see the note at the top of the file.
 */
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

describe('OrderCreatePage', () => {
  it('submits the assembled order and navigates to the created order', async () => {
    renderPage();

    // Customer is a server-side search picker: type, then pick the result.
    await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
    await pick('customerAccountId', 'Jan Kowalski');

    await pick('salesChannelId', 'Channel 1');
    await pick('paymentMethodId', 'Payment 1');
    await pick('deliveryMethodId', 'Delivery 1');

    // Product line — also a server-side search picker.
    await userEvent.type(screen.getByLabelText('product-0'), 'Wid');
    await pick('product-0', 'Widget');

    // The default org address is auto-selected for both sides once the
    // customer loads; submit unlocks after the live preview resolves.
    const submit = screen.getByText('orderCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);

    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders', {
      customerAccountId: 'cust-1',
      salesChannelId: 'chan-1',
      deliveryMethodId: 'del-1',
      paymentMethodId: 'pay-1',
      deliveryAddressId: 'addr-1',
      billingAddressId: 'addr-1',
      items: [{ productId: 'prod-1', quantity: 1 }],
    });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/orders/new-order-1'));
  });

  it('keeps submit disabled until required fields are filled', async () => {
    renderPage();
    expect(screen.getByText('orderCreate.submit')).toBeDisabled();
  });

  /**
   * Opened from another screen (feature 143, US10): the query string may name
   * where the order is being created from, what to preselect, and where to go
   * back to. The page reads all of it as opaque — it never learns what an
   * origin *is*.
   */
  describe('opened with an origin', () => {
    const ORIGIN_ID = '00000000-0000-4000-8000-0000000000b1';
    const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
    const RETURN_TO = `/crm/opportunities/${ORIGIN_ID}?created=order`;
    const entry = (params: Record<string, string>): string =>
      `/orders/new?${new URLSearchParams(params).toString()}`;

    it('preselects the customer and the sales channel, sends the origin, and returns to where it came from', async () => {
      renderPage(
        entry({
          originType: 'crm_opportunity',
          originId: ORIGIN_ID,
          organizationId: ORGANIZATION_ID,
          customerAccountId: 'cust-1',
          salesChannelId: 'chan-1',
          returnTo: RETURN_TO,
        }),
      );

      // Neither picker is touched: both arrive chosen, by name.
      await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
      await waitFor(() => expect(screen.getByLabelText('salesChannelId')).toHaveValue('Channel 1'));

      await pick('paymentMethodId', 'Payment 1');
      await pick('deliveryMethodId', 'Delivery 1');
      await userEvent.type(screen.getByLabelText('product-0'), 'Wid');
      await pick('product-0', 'Widget');

      const submit = screen.getByText('orderCreate.submit');
      await waitFor(() => expect(submit).not.toBeDisabled());
      await userEvent.click(submit);

      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders', {
        customerAccountId: 'cust-1',
        salesChannelId: 'chan-1',
        deliveryMethodId: 'del-1',
        paymentMethodId: 'pay-1',
        deliveryAddressId: 'addr-1',
        billingAddressId: 'addr-1',
        items: [{ productId: 'prod-1', quantity: 1 }],
        origin: { type: 'crm_opportunity', id: ORIGIN_ID },
      });
      await waitFor(() =>
        expect(navigateSpy).toHaveBeenCalledWith(RETURN_TO, {
          state: { createdDocument: { id: 'new-order-1' } },
        }),
      );
    });

    it('offers only the customers of the organization it was given', async () => {
      renderPage(entry({ originType: 'crm_opportunity', originId: ORIGIN_ID, organizationId: ORGANIZATION_ID }));

      // Offered before anything is typed, and narrowed to the organization.
      await waitFor(() =>
        expect(
          getSpy.mock.calls.some(
            ([path]) =>
              typeof path === 'string' &&
              path.startsWith('/api/v1/admin/customers?') &&
              new URLSearchParams(path.split('?')[1]).get('organizationId') === ORGANIZATION_ID,
          ),
        ).toBe(true),
      );
      const searches = (): string[] =>
        getSpy.mock.calls
          .map(([path]) => String(path))
          .filter((path) => path.startsWith('/api/v1/admin/customers?'));
      // A typed search stays inside the organization as well.
      await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
      await waitFor(() => expect(searches().some((path) => path.includes('q=Jan'))).toBe(true));
      for (const path of searches()) {
        expect(new URLSearchParams(path.split('?')[1]).get('organizationId')).toBe(ORGANIZATION_ID);
      }
    });

    it('leads back to where it came from, and does not call an arriving selection unsaved work', async () => {
      renderPage(
        entry({ originType: 'crm_opportunity', originId: ORIGIN_ID, customerAccountId: 'cust-1', returnTo: RETURN_TO }),
      );
      expect(screen.getByRole('link', { name: 'common.action.back' })).toHaveAttribute('href', RETURN_TO);
    });

    it.each([
      ['an id that is not a uuid', { originType: 'crm_opportunity', originId: 'nope' }],
      ['a type that is not an identifier', { originType: 'CRM Opportunity', originId: ORIGIN_ID }],
      ['a type alone', { originType: 'crm_opportunity' }],
    ])('sends no origin for %s', async (_label, params) => {
      renderPage(entry({ ...params, customerAccountId: 'cust-1', salesChannelId: 'chan-1' }));
      await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
      await pick('paymentMethodId', 'Payment 1');
      await pick('deliveryMethodId', 'Delivery 1');
      await userEvent.type(screen.getByLabelText('product-0'), 'Wid');
      await pick('product-0', 'Widget');
      const submit = screen.getByText('orderCreate.submit');
      await waitFor(() => expect(submit).not.toBeDisabled());
      await userEvent.click(submit);

      const [, body] = postSpy.mock.calls.find(([path]) => path === '/api/v1/admin/orders') ?? [];
      expect(body).not.toHaveProperty('origin');
      await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/orders/new-order-1'));
    });

    it.each(['https://evil.example/x', '//evil.example/x', 'crm/opportunities'])(
      'does not follow a return address that leaves the application: %s',
      async (returnTo) => {
        renderPage(entry({ returnTo }));
        expect(screen.getByRole('link', { name: 'common.action.back' })).toHaveAttribute('href', '/orders');
      },
    );
  });
});
