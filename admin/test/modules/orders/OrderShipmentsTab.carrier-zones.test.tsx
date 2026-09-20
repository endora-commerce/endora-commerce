import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AdminZoneContribution } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The Delivery tab's two zones, from the **host's** side (feature 091, P7d).
 *
 * ## What this file used to be
 *
 * `OrderShipmentsTab.inpost-label-gating.test.tsx`: feature 068's proof that the
 * InPost label button asked both axes, written when this screen rendered that
 * button itself. It named `inpost` because the file under test did — a
 * `useSurfaceVisibility({ module: 'inpost', … })` gate, a
 * `useTranslation('inpost')` namespace and a
 * `providerDetails.provider === 'inpost'` branch, two of which were keys in
 * `backend/scripts/ledgers/foreign-module-ids.ts`.
 *
 * The host renders `order.shipment.row.actions` and
 * `order.shipments.tab.actions` now, so the subject here is what the **host**
 * owes a contributor and nothing about a carrier. The carrier halves moved to
 * the modules that own them, each with the four off-state cases Constitution XVII
 * item 6 asks for: `admin/test/modules/dhl_parcel/dhl-shipment-actions-zone.test.tsx`,
 * and — until `specs/134-paid-module-extraction/` T035 — `inpost`'s counterpart at
 * `admin/test/modules/inpost/inpost-shipment-row-zone.test.tsx`. That file left with its
 * module and is **owed to the paid repository**, which has no admin test host yet; it is
 * recorded as owed under T035 in that feature's `tasks.md` and recoverable in full at
 * `git show ddfa78304:admin/test/modules/inpost/inpost-shipment-row-zone.test.tsx`. This
 * file's own subject is unaffected — it is the host's half, and the host is still here.
 *
 * ## What a host owes, and it is exactly two things
 *
 * The **props**, per mount, because a key the props do not carry never agrees
 * with a `match` — the fail-closed rule, and the one way this conversion could
 * regress in silence. And the **absence of the carrier**: this screen must no
 * longer name one, in any of the three spellings it used.
 *
 * The contributions below are therefore synthetic. A real one would assert the
 * carrier's declaration a second time, in the file whose subject is the host;
 * a probe records the props it was mounted with, which is what the host is
 * responsible for.
 */

const getSpy = vi.fn();

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
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrderShipmentsTab } = await import('../../../../packages/modules/orders/src/admin/components/OrderShipmentsTab');

/** Every props object a probe was mounted with, in mount order. */
const rowMounts: Record<string, unknown>[] = [];
const tabMounts: Record<string, unknown>[] = [];

function probe(sink: Record<string, unknown>[], label: string) {
  return function Probe(props: Record<string, unknown>): ReactNode {
    sink.push(props);
    return <span>{label}</span>;
  };
}

function contribution(
  zone: AdminZoneContribution['zone'],
  sink: Record<string, unknown>[],
  label: string,
  match?: AdminZoneContribution['match'],
): AdminZoneContribution {
  return {
    zone,
    weight: 100,
    requiredPermission: 'probe:read',
    ...(match === undefined ? {} : { match }),
    component: async () => ({ default: probe(sink, label) }),
  };
}

const INPOST_SUCCESS = {
  id: 's1',
  status: 'success',
  externalReference: 'TRK-1',
  providerDetails: { provider: 'inpost', shipxShipmentId: '4321' },
  failureReason: null,
  attemptNo: 1,
  createdAt: '2026-08-21T12:00:00Z',
};

const NO_PROVIDER_ATTEMPT = {
  ...INPOST_SUCCESS,
  id: 's2',
  attemptNo: 2,
  status: 'pending_manual',
  providerDetails: null,
};

const BUNDLE = passthroughBundle('core', [
  'orderDetail.shipments.title',
  'orderDetail.shipments.status.success',
  'orderDetail.shipments.status.pending_manual',
  'orderDetail.shipments.carrierNotContacted.title',
  'orderDetail.shipments.carrierNotContacted.body',
  'orderDetail.shipments.generate.again',
  'orderDetail.shipments.columns.attempt',
  'orderDetail.shipments.columns.status',
  'orderDetail.shipments.columns.tracking',
  'orderDetail.shipments.columns.createdAt',
  'orderDetail.shipments.columns.failure',
]);

function renderTab(options: {
  readonly deliveryMethodCode?: string;
  readonly contributions?: readonly AdminZoneContribution[];
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): void {
  renderWithI18n(
    withSession(
      <OrderShipmentsTab
        orderId="o1"
        deliveryMethodCode={options.deliveryMethodCode ?? 'inpost_locker'}
      />,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['probe:read'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['orders', 'probe'])] }),
        contributions: [
          { moduleId: 'probe', contributions: { zones: options.contributions ?? [] } },
        ],
      },
    ),
    BUNDLE,
  );
}

describe('OrderShipmentsTab — the two zones it renders (feature 091, P7d)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    rowMounts.length = 0;
    tabMounts.length = 0;
  });

  it('mounts the row zone once per attempt, with that attempt’s own props', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS, NO_PROVIDER_ATTEMPT] });
    renderTab({
      contributions: [contribution('order.shipment.row.actions', rowMounts, 'row-action')],
    });

    await waitFor(() => expect(rowMounts).toHaveLength(2));
    // `providerCode` and `status` are the two props a carrier matches on, so a
    // mount that carried neither would hide every contribution and report
    // nothing. `providerCode` is read out of the adapter's envelope and is
    // `null` when the carrier never answered — the fail-closed value.
    expect(rowMounts[0]).toEqual({
      orderId: 'o1',
      shipmentId: 's1',
      deliveryMethodCode: 'inpost_locker',
      providerCode: 'inpost',
      status: 'success',
    });
    expect(rowMounts[1]).toEqual({
      orderId: 'o1',
      shipmentId: 's2',
      deliveryMethodCode: 'inpost_locker',
      providerCode: null,
      status: 'pending_manual',
    });
  });

  it('mounts the footer zone once, with the latest attempt', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS, NO_PROVIDER_ATTEMPT] });
    renderTab({
      deliveryMethodCode: 'dhl_parcel_courier',
      contributions: [contribution('order.shipments.tab.actions', tabMounts, 'tab-action')],
    });

    await waitFor(() => expect(tabMounts).toHaveLength(1));
    // The latest attempt is the highest `attemptNo`, which is the only one an
    // operator can still act on — the host already computed it for its own
    // "generate again" button and hands the same answer over.
    expect(tabMounts[0]).toEqual({
      orderId: 'o1',
      deliveryMethodCode: 'dhl_parcel_courier',
      latestShipmentId: 's2',
      latestStatus: 'pending_manual',
    });
  });

  it('mounts the footer zone with nulls when the order has no attempt yet', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderTab({
      contributions: [contribution('order.shipments.tab.actions', tabMounts, 'tab-action')],
    });

    await waitFor(() => expect(tabMounts).toHaveLength(1));
    // Nullable rather than an omitted mount: a contributor decides for itself
    // whether it can act, because `match` compares strings and has no negation.
    expect(tabMounts[0]).toMatchObject({ latestShipmentId: null, latestStatus: null });
  });

  it('renders the action column only while some row would carry an action', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab({
      // Agrees with no attempt this order has, so the column is not needed.
      contributions: [
        contribution('order.shipment.row.actions', rowMounts, 'row-action', {
          providerCode: 'nobody',
        }),
      ],
    });

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(rowMounts).toHaveLength(0);
  });

  it('adds the action column as soon as one row would carry an action', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab({
      contributions: [
        contribution('order.shipment.row.actions', rowMounts, 'row-action', {
          providerCode: 'inpost',
        }),
      ],
    });

    await waitFor(() => expect(rowMounts).toHaveLength(1));
    // Six: the five the host owns, plus the unlabelled action column.
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
  });

  it('mounts nothing while the contributor is switched off', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab({
      present: ['orders'],
      contributions: [
        contribution('order.shipment.row.actions', rowMounts, 'row-action'),
        contribution('order.shipments.tab.actions', tabMounts, 'tab-action'),
      ],
    });

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(rowMounts).toHaveLength(0);
    expect(tabMounts).toHaveLength(0);
  });

  it('mounts nothing for an operator without the contributor’s code', async () => {
    getSpy.mockResolvedValue({ data: [INPOST_SUCCESS] });
    renderTab({
      permissions: [],
      contributions: [
        contribution('order.shipment.row.actions', rowMounts, 'row-action'),
        contribution('order.shipments.tab.actions', tabMounts, 'tab-action'),
      ],
    });

    await waitFor(() =>
      expect(screen.getByText('orderDetail.shipments.status.success')).toBeInTheDocument(),
    );
    expect(rowMounts).toHaveLength(0);
    expect(tabMounts).toHaveLength(0);
  });

  it('names no carrier in its own source, in any of the three spellings', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const host = readFileSync(
      resolve(
        process.cwd(),
        // Re-keyed by feature 091's Phase 4 batch 15: `orders` took its admin
        // surface into its own package and this file went with it. A
        // `readFileSync` of the old path throws rather than reporting a carrier
        // name that came back.
        '../packages/modules/orders/src/admin/components/OrderShipmentsTab.tsx',
      ),
      'utf8',
    );
    // The two `foreign-module-ids` keys this conversion retires: a visibility
    // gate naming `inpost` and a translation namespace naming it.
    expect(host).not.toContain("module: 'inpost'");
    expect(host).not.toContain("useTranslation('inpost')");
    // The carrier no ledger could see — named by delivery-method code rather
    // than by module id, which is why §10.4 says a repair naming one carrier
    // has not understood the shape.
    expect(host).not.toContain('dhl_parcel_courier');
    expect(host).not.toContain('dhl_parcel_pickup');
    // And the file whose only reason to exist was that `orders` could not hand
    // those routes back.
    expect(host).not.toContain('carrierDocumentsClient');
    expect(host).toContain('name="order.shipment.row.actions"');
    expect(host).toContain('name="order.shipments.tab.actions"');
  });
});
