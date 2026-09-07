import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #250 — the Delivery tab is where `pending_manual` stops being a value
 * in a column and becomes something an operator can act on.
 *
 * A state nobody can see on a screen is the "say nothing" variant with extra
 * steps, so all three halves are asserted: the row says which state it is in,
 * the tab says why in a sentence and names the module, and the recovery is one
 * button away. The button posts to the **generate** endpoint, not the retry
 * one — opening a retry attempt contacts no adapter, so it would produce a
 * second silent row.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * The tab asks `useSurfaceVisibility` for the InPost label column (feature 068),
 * so the two hooks behind that predicate are stubbed here — `hasPermission` to
 * `false`, which is what keeps this file measuring #250's state and nothing
 * else. `DeliveryMethodsPage.permission-gating.test.tsx` is where the predicate
 * itself is exercised.
 */


const { OrderShipmentsTab } = await import('../../../../packages/modules/orders/src/admin/components/OrderShipmentsTab');

const SHIPMENTS_PATH = '/api/v1/admin/orders/o1/shipments';

const STALLED = {
  id: 's1',
  status: 'pending_manual',
  externalReference: null,
  failureReason:
    'The "demo_carrier" module is not switched on here, so the carrier was never asked to create this shipment.',
  attemptNo: 1,
  createdAt: '2026-08-19T12:00:00Z',
};

const ACCEPTED = {
  id: 's2',
  status: 'pending',
  externalReference: null,
  failureReason: null,
  attemptNo: 2,
  createdAt: '2026-08-19T13:00:00Z',
};

const BUNDLE = passthroughBundle('core', [
  'orderDetail.shipments.title',
  'orderDetail.shipments.status.pending',
  'orderDetail.shipments.status.pending_manual',
  'orderDetail.shipments.carrierNotContacted.title',
  'orderDetail.shipments.carrierNotContacted.body',
  'orderDetail.shipments.generate.again',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

function renderTab(): void {
  // Deliberately not a `dhl_parcel_*` code: this file is #250's
  // carrier-not-contacted state, which is carrier-agnostic, and the prop only
  // selects DHL's own panels. A DHL code here would render UI this file does
  // not assert on and quietly change what it measures.
  renderWithI18n(
    withSession(<OrderShipmentsTab orderId="o1" deliveryMethodCode="courier" />, {
      session: adminSession({ permissions: [] }),
      presence: modulePresence({ present: ['orders', 'inpost'] }),
    }),
    BUNDLE,
  );
}

/**
 * #250 — a shipment no carrier was asked for.
 *
 * The recovery used to be its own button inside the alert, labelled
 * `carrierNotContacted.action`. !1008 consolidated it into the general
 * `generateAgain` button below the table, and the capability is unchanged:
 * `canGenerate` includes `latest?.status === 'pending_manual'`, which is
 * exactly this state, and the handler is the same one. So this file asserts
 * the merged label — what it must keep asserting is that **a recovery is
 * offered at all**, not which of the two buttons offers it.
 */
describe('OrderShipmentsTab — a shipment no carrier was asked for (#250)', () => {
  it('names the state, explains it and offers the recovery', async () => {
    getSpy.mockResolvedValue({ data: [STALLED] });
    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('orderDetail.shipments.carrierNotContacted.title'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('orderDetail.shipments.status.pending_manual')).toBeInTheDocument();
    // The persisted sentence is what names the module the operator has to
    // switch back on; no translation can supply that. It reads twice — in the
    // banner and in the row's own reason column — and both are wanted.
    expect(screen.getAllByText(/demo_carrier/)).toHaveLength(2);
    expect(screen.getByText('orderDetail.shipments.generate.again')).toBeInTheDocument();
  });

  it('generates a new attempt — the endpoint that asks the carrier — and reloads', async () => {
    getSpy.mockResolvedValue({ data: [STALLED] });
    postSpy.mockResolvedValue({ data: ACCEPTED });
    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('orderDetail.shipments.generate.again'),
      ).toBeInTheDocument(),
    );
    getSpy.mockResolvedValue({ data: [STALLED, ACCEPTED] });
    await userEvent.click(screen.getByText('orderDetail.shipments.generate.again'));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(SHIPMENTS_PATH, {}));
    // The list is re-read, and the banner goes with the stalled attempt no
    // longer being the latest one.
    await waitFor(() =>
      expect(
        screen.queryByText('orderDetail.shipments.carrierNotContacted.title'),
      ).not.toBeInTheDocument(),
    );
  });

  it('says nothing extra when the latest attempt reached the carrier', async () => {
    // The stalled row is still in the history — an earlier attempt that was
    // never sent stays on the record — but it is not what the operator has to
    // act on any more.
    getSpy.mockResolvedValue({ data: [STALLED, ACCEPTED] });
    renderTab();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.pending')).toBeInTheDocument(),
    );
    expect(
      screen.queryByText('orderDetail.shipments.carrierNotContacted.title'),
    ).not.toBeInTheDocument();
  });
});
