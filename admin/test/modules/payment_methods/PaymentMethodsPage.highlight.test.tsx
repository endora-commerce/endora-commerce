import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

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

vi.mock('../../../../packages/modules/payment_methods/src/admin/api/payment-methods-client', () => ({
  paymentMethodsClient: {
    list: vi.fn(async () => rows),
    orderStatuses: vi.fn(async () => []),
    adapters: vi.fn(async () => []),
    upsert: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

/**
 * Permissive since the screen took a gate of its own (2026-08-28): the page
 * returns a refusal notice unless the operator holds `payment_methods:read`,
 * and this file is about `?highlight=` focus rather than about authority. The
 * session below holds the read code and nothing else, which is what keeps the
 * five gateway integration cards hidden here. The gate itself is
 * `PaymentMethodsPage.permission-gating.test.tsx`.
 *
 * **The screen is `@endora-commerce/mod-payment-methods`' since feature 091's
 * Phase 4 (the plan's batch 7), so its `useAuth` is the kit's** — this file
 * used to replace `@/lib/auth`, which is a re-export shim now, and a mock at
 * the old path is a no-op the screen never sees. The real provider is seeded
 * with the same answer instead.
 */
const SESSION = adminSession({ permissions: ['payment_methods:read'] });

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
      '../../../../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage'
    );
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/payment-methods?highlight=autopay_pbl']}>
          <PaymentMethodsPage />
        </MemoryRouter>,
        { session: SESSION },
      ),
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
      '../../../../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage'
    );
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/payment-methods']}>
          <PaymentMethodsPage />
        </MemoryRouter>,
        { session: SESSION },
      ),
      passthroughBundle('core', KEYS),
    );

    await waitFor(() => expect(screen.getByText('autopay_pbl')).toBeInTheDocument());
    expect(document.activeElement?.tagName).not.toBe('TR');
  });
});
