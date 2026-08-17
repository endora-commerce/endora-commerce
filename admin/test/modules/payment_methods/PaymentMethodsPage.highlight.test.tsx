import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 076 (D-83 item 6, SC-007) — arriving from a gateway screen lands on
 * the row.
 *
 * The gateway screens no longer set a method's availability; they link here with
 * `?highlight=<code>`. Scrolling alone would strand a keyboard operator at the
 * top of a list they now have to search, so the row also takes focus — that is
 * the half worth a test, because it is the half that silently regresses.
 */

const rows = [
  {
    id: '00000000-0000-4000-8000-00000000aa01',
    code: 'bank_transfer',
    adapter: 'bank_transfer',
    kind: 'bank_transfer' as const,
    name: { default: 'Bank transfer' },
    status: 'active' as const,
    additionalPrice: 0,
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
    salesChannelIds: [],
    rendererKey: null,
    availability: { ownerModule: null, available: true, ownerPresence: null },
  },
  {
    id: '00000000-0000-4000-8000-00000000aa02',
    code: 'autopay_pbl',
    adapter: 'autopay',
    kind: 'gateway' as const,
    name: { default: 'Online payment' },
    status: 'inactive' as const,
    additionalPrice: 0,
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
    salesChannelIds: [],
    rendererKey: null,
    availability: { ownerModule: null, available: true, ownerPresence: null },
  },
];

vi.mock('@/modules/payment_methods/api/payment-methods-client', () => ({
  paymentMethodsClient: {
    list: vi.fn(async () => rows),
    orderStatuses: vi.fn(async () => []),
    adapters: vi.fn(async () => []),
    upsert: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => false }),
}));

const KEYS = [
  'legacyMethods.payment.title',
  'legacyMethods.payment.description',
  'legacyMethods.payment.empty',
  'legacyMethods.columns.code',
  'legacyMethods.columns.name',
  'legacyMethods.columns.adapter',
  'legacyMethods.columns.status',
  'legacyMethods.fields.status',
  'legacyMethods.status.active',
  'legacyMethods.status.inactive',
  'legacyMethods.formTitle',
  'legacyMethods.editTitle',
  'common.state.loading',
  'common.action.edit',
  'common.action.delete',
];

describe('PaymentMethodsPage — arriving with ?highlight=<code>', () => {
  beforeEach(() => {
    // jsdom has no layout, so `scrollIntoView` is not implemented there. The
    // assertion below is about focus, which jsdom does model.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('moves focus to the linked method row', async () => {
    const { PaymentMethodsPage } = await import(
      '@/modules/payment_methods/PaymentMethodsPage'
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/payment-methods?highlight=autopay_pbl']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      passthroughBundle('core', KEYS),
    );

    await waitFor(() => expect(screen.getByText('autopay_pbl')).toBeInTheDocument());
    await waitFor(() => {
      const focused = document.activeElement;
      expect(focused?.tagName).toBe('TR');
      expect(focused?.textContent).toContain('autopay_pbl');
    });
  });

  it('focuses nothing when no method was named', async () => {
    const { PaymentMethodsPage } = await import(
      '@/modules/payment_methods/PaymentMethodsPage'
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      passthroughBundle('core', KEYS),
    );

    await waitFor(() => expect(screen.getByText('autopay_pbl')).toBeInTheDocument());
    expect(document.activeElement?.tagName).not.toBe('TR');
  });
});
