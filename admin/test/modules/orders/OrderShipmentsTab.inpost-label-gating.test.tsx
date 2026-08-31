import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 068 — the InPost label button on the Delivery tab, on both axes.
 *
 * The branch gated it on `hasPermission('inpost:manage')` alone, which is the
 * half of the question !1084 ruled insufficient: the admin router carries no
 * guard, so a module the operator has switched off must contribute no surface
 * at all (Constitution XVII item 5), and a permission check alone leaves the
 * button rendering and the route answering 503. `useSurfaceVisibility` asks
 * both, and it is the real predicate that runs here — only `useAuth` and
 * `useModulePresence` are stubbed, as `DeliveryMethodsPage`'s gating test does.
 *
 * The third axis is the carrier's, and it is not a gate: the button appears on
 * an attempt whose `providerDetails.provider` says InPost opened it, so a DHL
 * shipment on the same order never offers an InPost label.
 */

const getSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
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

/** The codes the operator holds, and the modules the projection reports, per case. */
let permissions: readonly string[] = [];
let presentModules: readonly string[] = [];


const { OrderShipmentsTab } = await import('../../../src/modules/orders/OrderShipmentsTab');

const INPOST_SUCCESS = {
  id: 's1',
  status: 'success',
  externalReference: 'TRK-1',
  providerDetails: { provider: 'inpost', shipxShipmentId: '4321' },
  failureReason: null,
  attemptNo: 1,
  createdAt: '2026-08-21T12:00:00Z',
};

const OTHER_CARRIER_SUCCESS = {
  ...INPOST_SUCCESS,
  id: 's2',
  providerDetails: { provider: 'dhl_parcel' },
};

const BUNDLE = {
  ...passthroughBundle('core', [
    'orderDetail.shipments.title',
    'orderDetail.shipments.status.success',
    'orderDetail.shipments.columns.attempt',
    'orderDetail.shipments.columns.status',
    'orderDetail.shipments.columns.tracking',
    'orderDetail.shipments.columns.createdAt',
    'orderDetail.shipments.columns.failure',
  ]),
  ...passthroughBundle('inpost', ['label.download']),
};

function renderTab(): void {
  renderWithI18n(
    withSession(<OrderShipmentsTab orderId="o1" deliveryMethodCode="inpost_locker" />, {
      session: adminSession({ permissions: [...permissions] }),
      presence: modulePresence({ present: [...presentModules] }),
    }),
    BUNDLE,
  );
}

describe('OrderShipmentsTab — the InPost label button (feature 068)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    permissions = ['inpost:manage'];
    presentModules = ['orders', 'inpost'];
  });

  it('offers the label when the operator holds inpost:manage and inpost is present', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab();

    await waitFor(() => expect(screen.getByText('label.download')).toBeInTheDocument());
  });

  it('offers nothing when the role does not hold inpost:manage', async () => {
    permissions = [];
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(screen.queryByText('label.download')).not.toBeInTheDocument();
  });

  it('offers nothing while the inpost module is switched off', async () => {
    presentModules = ['orders'];
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(screen.queryByText('label.download')).not.toBeInTheDocument();
  });

  it('offers nothing on an attempt another carrier opened', async () => {
    getSpy.mockResolvedValue({ data: [OTHER_CARRIER_SUCCESS] });
    renderTab();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(screen.queryByText('label.download')).not.toBeInTheDocument();
  });
});
