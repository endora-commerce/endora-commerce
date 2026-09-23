import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

const list = vi.fn(async () => []);
const orderStatuses = vi.fn(async () => []);
const adapters = vi.fn(async () => []);

vi.mock(
  '../../../../packages/modules/payment_methods/src/admin/api/payment-methods-client',
  () => ({
    paymentMethodsClient: {
      list: (...args: unknown[]) => list(...(args as [])),
      orderStatuses: (...args: unknown[]) => orderStatuses(...(args as [])),
      adapters: (...args: unknown[]) => adapters(...(args as [])),
      upsert: vi.fn(),
      remove: vi.fn(),
    },
  }),
);

const { PaymentMethodsPage } = await import(
  '../../../../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage'
);

function StripeStandIn(): React.JSX.Element {
  return <a href="/settings/stripe">stripe integration</a>;
}

function TpayStandIn(): React.JSX.Element {
  return <a href="/settings/tpay">tpay integration</a>;
}

const GATEWAY_ENTRIES = [
  {
    moduleId: 'stripe',
    contributions: {
      zones: [
        {
          zone: 'payment_method.list.integrations' as const,
          component: async () => ({ default: StripeStandIn }),
          weight: 100,
          requiredPermission: 'stripe:read',
        },
      ],
    } satisfies AdminContributions,
  },
  {
    moduleId: 'tpay',
    contributions: {
      zones: [
        {
          zone: 'payment_method.list.integrations' as const,
          component: async () => ({ default: TpayStandIn }),
          weight: 200,
          requiredPermission: 'tpay:read',
        },
      ],
    } satisfies AdminContributions,
  },
];

const bundle = passthroughBundle('core', [
  'legacyMethods.payment.title',
  'legacyMethods.payment.description',
  'legacyMethods.payment.empty',
  'legacyMethods.payment.noPermission',
  'legacyMethods.integrations.title',
  'legacyMethods.integrations.description',
  'legacyMethods.formTitle',
  'legacyMethods.columns.code',
  'legacyMethods.columns.name',
  'legacyMethods.columns.kind',
  'legacyMethods.columns.status',
  'legacyMethods.fields.code',
  'legacyMethods.fields.nameEn',
  'legacyMethods.fields.namePl',
  'legacyMethods.fields.kind',
  'legacyMethods.fields.status',
  'legacyMethods.status.active',
  'legacyMethods.status.inactive',
  'common.state.loading',
  'common.action.save',
  'common.action.edit',
  'common.action.delete',
]);

function renderPage(options: {
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: GATEWAY_ENTRIES,
      },
    ),
    bundle,
  );
}

function integrationHrefs(): (string | null)[] {
  return [...document.querySelectorAll('a')]
    .map((anchor) => anchor.getAttribute('href'))
    .filter((href) => href === '/settings/stripe' || href === '/settings/tpay');
}

const cardIsRendered = (): boolean =>
  screen.queryAllByText('legacyMethods.integrations.title').length > 0;

describe('the payment-method integrations card is a zone', () => {
  it('renders visible contributors in declared order', async () => {
    renderPage({
      permissions: ['payment_methods:read', 'stripe:read', 'tpay:read'],
      present: ['payment_methods', 'stripe', 'tpay'],
    });

    await waitFor(() =>
      expect(integrationHrefs()).toEqual(['/settings/stripe', '/settings/tpay']),
    );
  });

  it('filters a switched-off contributor without hiding a present one', async () => {
    renderPage({
      permissions: ['payment_methods:read', 'stripe:read', 'tpay:read'],
      present: ['payment_methods', 'tpay'],
    });

    await waitFor(() => expect(integrationHrefs()).toEqual(['/settings/tpay']));
  });

  it('filters a contributor whose permission is withheld', async () => {
    renderPage({
      permissions: ['payment_methods:read', 'stripe:read'],
      present: ['payment_methods', 'stripe', 'tpay'],
    });

    await waitFor(() => expect(integrationHrefs()).toEqual(['/settings/stripe']));
  });

  it('does not render an empty integrations card', async () => {
    renderPage({ permissions: ['payment_methods:read'], present: ['payment_methods'] });

    await waitFor(() =>
      expect(screen.queryAllByText('legacyMethods.payment.title').length).toBeGreaterThan(0),
    );
    expect(cardIsRendered()).toBe(false);
    expect(integrationHrefs()).toEqual([]);
  });
});
