import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { OrderCreatePage } = await import('../../../src/modules/orders/OrderCreatePage');

const BUNDLE = passthroughBundle('core', [
  'orderCreate.field.customer',
  'orderCreate.field.salesChannel',
  'orderCreate.field.paymentMethod',
  'orderCreate.field.deliveryMethod',
  'orderCreate.field.deliveryAddress',
  'orderCreate.field.billingAddress',
  'orderCreate.field.product',
  'orderCreate.field.quantity',
  'orderCreate.submit',
]);

beforeEach(() => {
  postSpy.mockReset();
  navigateSpy.mockReset();
  postSpy.mockResolvedValue({ data: { id: 'new-order-1' } });
});

describe('OrderCreatePage', () => {
  it('submits the assembled order and navigates to the created order', async () => {
    renderWithI18n(
      <MemoryRouter>
        <OrderCreatePage />
      </MemoryRouter>,
      BUNDLE,
    );

    await userEvent.type(screen.getByLabelText('customerAccountId'), 'cust-1');
    await userEvent.type(screen.getByLabelText('salesChannelId'), 'chan-1');
    await userEvent.type(screen.getByLabelText('paymentMethodId'), 'pay-1');
    await userEvent.type(screen.getByLabelText('deliveryMethodId'), 'del-1');
    await userEvent.type(screen.getByLabelText('deliveryAddressId'), 'addr-d');
    await userEvent.type(screen.getByLabelText('billingAddressId'), 'addr-b');
    await userEvent.type(screen.getByLabelText('product-0'), 'prod-1');

    await userEvent.click(screen.getByText('orderCreate.submit'));

    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders', {
      customerAccountId: 'cust-1',
      salesChannelId: 'chan-1',
      deliveryMethodId: 'del-1',
      paymentMethodId: 'pay-1',
      deliveryAddressId: 'addr-d',
      billingAddressId: 'addr-b',
      items: [{ productId: 'prod-1', quantity: 1 }],
    });
    expect(navigateSpy).toHaveBeenCalledWith('/orders/new-order-1');
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
