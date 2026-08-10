import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection is stubbed as "everything is here"; the filtering itself is
// covered in AppShell.module-presence.test.tsx.
vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: () => true,
    presenceOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  setModuleActivation: vi.fn(),
  getModulePresence: vi.fn(),
}));

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
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

const { OrderCreatePage } = await import('../../../src/modules/orders/OrderCreatePage');

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

describe('OrderCreatePage', () => {
  it('submits the assembled order and navigates to the created order', async () => {
    renderWithI18n(
      <MemoryRouter>
        <OrderCreatePage />
      </MemoryRouter>,
      BUNDLE,
    );

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
    renderWithI18n(
      <MemoryRouter>
        <OrderCreatePage />
      </MemoryRouter>,
      BUNDLE,
    );
    expect(screen.getByText('orderCreate.submit')).toBeDisabled();
  });
});
