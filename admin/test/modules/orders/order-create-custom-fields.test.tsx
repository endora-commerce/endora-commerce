import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { orgSalesChannels } from './org-sales-channels';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-017, FR-039,
 * contracts/admin-panel-and-check.md §3) — the order create screen embeds the
 * order's custom fields: the panel renders (its definitions are
 * `custom_fields:read`'s), its bag travels as `customFieldValues` in
 * `POST /api/v1/admin/orders`, and a `422 CUSTOM_FIELD_VALUE_INVALID` is said at
 * the field it names, the form kept as typed.
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
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationName: 'Acme',
  organizationId: 'org-1',
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
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', name: 'Widget' };
const PREVIEW = {
  lines: [{ productId: 'prod-1', quantity: 1, unitPrice: '10.00', currency: 'PLN', lineTotal: 10 }],
  summary: { subtotal: 10, taxTotal: 0, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, total: 10, currency: 'PLN' },
  messages: [],
};
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=order';
const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000e175',
  entityType: 'order',
  key: 'po_number',
  label: { en: 'PO number' },
  labelDefault: 'PO number',
  valueType: 'text',
  required: true,
  audience: 'customer',
  sortOrder: 0,
  config: {},
  options: [],
  customerInput: [],
  adminAccess: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BUNDLE = passthroughBundle('core', [
  'common.action.back',
  'orderCreate.field.customer',
  'orderCreate.field.salesChannel',
  'orderCreate.field.paymentMethod',
  'orderCreate.field.deliveryMethod',
  'orderCreate.items.quickSearch',
  'orderCreate.submit',
  'customFields.title',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === DEFINITIONS_URL) return Promise.resolve({ data: [DEFINITION] });
    if (path.includes('/addresses')) {
      return Promise.resolve({ data: { personal: [], organization: [ORG_ADDRESS] } });
    }
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
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
  postSpy.mockImplementation((path: string) => {
    if (path.endsWith('/orders/preview')) return Promise.resolve({ data: PREVIEW });
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  const option = await screen.findByRole('option', { name: new RegExp(optionLabel) });
  await userEvent.click(option);
}

function renderPage(permissions: readonly string[] = ['*']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/new']}>
        <OrderCreatePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['orders', 'quick_order'] }),
      },
    ),
    BUNDLE,
  );
}

async function fillOrder(): Promise<HTMLElement> {
  await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
  await pick('customerAccountId', 'Jan Kowalski');
  await pick('salesChannelId', 'Channel 1');
  await pick('paymentMethodId', 'Payment 1');
  await pick('deliveryMethodId', 'Delivery 1');
  await userEvent.type(screen.getByLabelText('orderCreate.items.quickSearch'), 'Wid');
  await pick('orderCreate.items.quickSearch', 'Widget');
  const submit = screen.getByText('orderCreate.submit');
  await waitFor(() => expect(submit).not.toBeDisabled());
  return submit;
}

const orderPosts = (): unknown[][] => postSpy.mock.calls.filter((c) => c[0] === '/api/v1/admin/orders');

describe('OrderCreatePage — custom fields (feature 175)', () => {
  it('renders the order custom fields and sends their bag with the create', async () => {
    renderPage();
    const submit = await fillOrder();
    await userEvent.type(await screen.findByLabelText('PO number *'), 'PO-42');
    await userEvent.click(submit);

    await waitFor(() => expect(orderPosts()).toHaveLength(1));
    expect(orderPosts()[0]?.[1]).toMatchObject({ customFieldValues: { po_number: 'PO-42' } });
  });

  it('says a refusal at the field it names and keeps the form', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path.endsWith('/orders/preview')) return Promise.resolve({ data: PREVIEW });
      return Promise.reject(
        new ApiError(422, {
          error: {
            code: 'CUSTOM_FIELD_VALUE_INVALID',
            message: 'One or more custom fields are invalid.',
            requestId: 'r',
            details: [{ path: 'po_number', issue: 'Field "po_number" is required.' }],
          },
        } as never),
      );
    });
    renderPage();
    const submit = await fillOrder();
    const input = await screen.findByLabelText('PO number *');
    await userEvent.click(submit);

    await waitFor(() => expect(screen.getByText('Field "po_number" is required.')).toBeTruthy());
    expect(input.parentElement).toContainElement(screen.getByText('Field "po_number" is required.'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('neither asks for the definitions nor sends values without custom_fields:read', async () => {
    renderPage(['orders:read', 'orders:write', 'customers:read', 'catalog:read']);
    const submit = await fillOrder();
    await userEvent.click(submit);
    await waitFor(() => expect(orderPosts()).toHaveLength(1));
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(DEFINITIONS_URL);
    expect(orderPosts()[0]?.[1]).not.toHaveProperty('customFieldValues');
  });
});
