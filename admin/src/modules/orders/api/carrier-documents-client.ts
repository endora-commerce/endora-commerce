import { apiClient } from '@/lib/api-client';
import type { DhlParcelCourierBookingRequest } from '@endora-commerce/contracts';

/**
 * The carrier artefacts this module's shipments tab offers on an order.
 *
 * **A drained cross-module reach, not a convenience** (feature 091, Phase 4
 * batch five). `OrderShipmentsTab.tsx` used to import `dhlParcelAdminClient`
 * from `@/modules/dhl_parcel/api/dhl-parcel-client` and `inpostAdminClient`
 * from `@/modules/inpost/api/inpost-client`, and
 * `backend/scripts/ledgers/cross-module-imports/orders.ts` recorded both
 * reaches before any admin directory moved. The entries named the exit taken
 * here: *"the reach is the client module, not the HTTP call — the request and
 * response shapes are already in `@endora-commerce/contracts`, which both
 * sides compile"*, so the caller builds the request itself and no module names
 * a file another module owns. Rewriting the two specifiers as the carriers'
 * package subpaths is the exit those entries refuse: it is the same coupling
 * under a supported name, and `./admin` carries a contributions object rather
 * than a client in any case.
 *
 * **Both carriers move together**, which the `inpost` entry states as a rule
 * about the shape rather than as a preference: *"both carriers are one
 * shipment tab reaching two adapters, so the Phase 4 batch that moves this
 * consumer takes both or neither; a repair naming one is a repair that has not
 * understood the shape"*. This file is that repair, and it is one file for the
 * same reason.
 *
 * Each path, method and response field below is what the carrier's own admin
 * routes answer today — `packages/modules/dhl_parcel/src/backend/routes.admin.ts`
 * and `packages/modules/inpost/src/backend/routes.admin.ts` — so the tab asks
 * the server exactly what it asked before the move. Every one of these routes
 * is served by the carrier's own module, so an operator who has switched that
 * carrier off gets the 503 `MODULE_DISABLED` envelope from the seam that owns
 * the answer, exactly as before; the tab already renders each affordance behind
 * `useSurfaceVisibility` for that carrier's module.
 */

/**
 * The label DHL issued for a shipment.
 *
 * Declared here rather than imported: `dhlParcelShipmentDocumentSchema` in
 * `@endora-commerce/contracts` describes the adapter's own document envelope
 * and is **not** this route's response — the route answers a nullable
 * `labelBase64` beside a nullable `waybill`, and the contract's shape has both
 * a required `waybill` and a `protocolBase64`. Naming the contract type would
 * be a claim about the wire that is not true.
 */
export interface DhlShipmentLabel {
  shipmentId: string;
  waybill: string | null;
  labelBase64: string | null;
}

/** The handover protocol (PnP) DHL issues for a booked pickup. */
export interface DhlShipmentProtocol {
  shipmentId: string;
  protocolNumber: string | null;
  protocolBase64: string | null;
}

/** What booking a courier returns: the protocol, and the rows it covered. */
export interface DhlCourierBooking {
  protocolNumber: string | null;
  protocolBase64: string | null;
  affectedShipmentIds: string[];
}

const DHL_BASE = '/api/v1/admin/dhl-parcel';

export const carrierDocumentsClient = {
  dhlLabel(shipmentId: string): Promise<DhlShipmentLabel> {
    return apiClient
      .get<{ data: DhlShipmentLabel }>(`${DHL_BASE}/shipments/${shipmentId}/label`)
      .then((r) => r.data);
  },
  dhlProtocol(shipmentId: string): Promise<DhlShipmentProtocol> {
    return apiClient
      .get<{ data: DhlShipmentProtocol }>(`${DHL_BASE}/shipments/${shipmentId}/protocol`)
      .then((r) => r.data);
  },
  dhlBookCourier(body: DhlParcelCourierBookingRequest): Promise<DhlCourierBooking> {
    return apiClient
      .post<{ data: DhlCourierBooking }>(`${DHL_BASE}/courier-bookings`, body)
      .then((r) => r.data);
  },
  /**
   * The InPost label is fetched with `fetch` rather than `apiClient`, because
   * the tab needs the PDF bytes and their `Content-Type`, so this is the path
   * and not a call. It is the same string `inpostAdminClient.labelUrl` built.
   */
  inpostLabelPath(shipmentId: string): string {
    return `/api/v1/admin/inpost/shipments/${shipmentId}/label`;
  },
};
