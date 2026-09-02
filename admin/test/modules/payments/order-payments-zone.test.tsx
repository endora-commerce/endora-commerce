import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `payments` contributes the order detail's Payment tab (feature 091, P7d;
 * FR-007).
 *
 * ## The coupling this replaces
 *
 * `orders`' `OrderDetail.tsx` imported `./OrderPaymentsTab` — its own file
 * serving this module's route — and gated it on
 * `isVisible({ module: 'payments', requiredPermission: 'payments:read' })`,
 * the `visibility-gate` key in
 * `backend/scripts/ledgers/foreign-module-ids.ts` whose recorded retiring
 * condition is this contribution. The panel is
 * `@endora-commerce/mod-payments/admin`'s now and the host counts the zone.
 *
 * ## The permission is `payments:read`, measured
 *
 * §9.3: the code is read off the route in this merge request rather than
 * copied. `packages/modules/payments/src/backend/routes.ts` gates
 * `GET /api/v1/admin/orders/:id/payments` with `requireAdmin('payments:read')`,
 * which is what §10.6 declared and what `orders`' own gate named. This is the
 * P7 row where the contract's code held — P7b's did not.
 *
 * ## No `match`
 *
 * One host, one mount (Z13), so `match` would narrow nothing. Asserted absent
 * so a later author cannot add one quietly.
 *
 * ## Four cases, because this module has both axes
 *
 * `payments` declares `activation.settingCode`, so it has a real off state:
 * present, switched off, permission withheld, restored.
 *
 * ## The mock is `@endora-commerce/admin-kit/lib`, and that is not a detail
 *
 * The panel imports `apiClient` from the kit. `admin/src/lib/api-client.ts` is
 * a re-export shim, so a `vi.mock` at that path would leave this subject
 * talking to a real `fetch` while the file read as covered.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const payments = await import('@endora-commerce/mod-payments/admin');
const { manifest } = await import('@endora-commerce/mod-payments');

const ORDER_ID = '00000000-0000-4000-8000-0000000000f1';

const REGISTRY = [{ moduleId: 'payments', contributions: payments.contributions }];

const BUNDLE = passthroughBundle('core', [
  'common.state.loading',
  'common.state.error',
  'orderDetail.payments.title',
  'orderDetail.payments.empty',
  'orderDetail.invoices.title',
  'orderDetail.invoices.empty',
]);

function renderZone(options: {
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/x']}>
        <AdminZone name="order.detail.payment" props={{ orderId: ORDER_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['payments:read'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['payments'])] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('payments contributes the order detail payment zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.startsWith(`/api/v1/admin/orders/${ORDER_ID}/payments`)) return { data: [] };
      if (url.startsWith('/api/v1/admin/invoices')) return { data: [] };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares exactly the one member P7d adds, with no match', () => {
    const zones = payments.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual(['order.detail.payment']);
    // `match` narrows the *mounts of one place* (Z13). This place has one host
    // and one mount, so a `match` could only ever hide the panel.
    expect(zones[0]?.match).toBeUndefined();
    // The code the panel's own route enforces, so the tab never advertises a
    // 403 — read off `routes.ts` in this merge request.
    expect(zones[0]?.requiredPermission).toBe('payments:read');
    // FR-013: the chunk sits behind a factory the renderer reaches only after
    // it has decided presence and permission.
    expect(typeof zones[0]?.component).toBe('function');
  });

  it('declares no route and no nav entry', () => {
    // This module has never had a screen of its own — its operator surface is
    // a tab on someone else's screen, which is what made it an FR-007 case.
    // `check:admin-registrations` therefore does not move for P7d.
    expect(payments.contributions.routes).toBeUndefined();
    expect(payments.contributions.nav).toBeUndefined();
  });

  it('renders the payment ledger and the order’s invoices', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('orderDetail.payments.title'));
    expect(container.textContent).toContain('orderDetail.invoices.title');
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/orders/${ORDER_ID}/payments`);
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/invoices?filter[orderId]=${ORDER_ID}`);
  });

  it('renders nothing while the module is switched off, and fetches no chunk', async () => {
    const container = renderZone({ present: [] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing without payments:read, and fetches no chunk', async () => {
    const container = renderZone({ permissions: ['orders:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores the panel when the module comes back', async () => {
    const container = renderZone({ present: ['payments'] });
    await waitFor(() => expect(container.textContent).toContain('orderDetail.payments.title'));
  });

  it('is switchable, which is what makes the off-state case above real', () => {
    expect(manifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'payments.enabled' }),
    );
  });
});
