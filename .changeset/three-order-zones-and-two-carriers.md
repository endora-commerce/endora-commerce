---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-payments': minor
'@endora-commerce/mod-inpost': minor
'@endora-commerce/mod-dhl-parcel': minor
---

Three admin zone members for the order detail, and both of its carriers become contributors.

`@endora-commerce/contracts` — `AdminZoneNameSchema` gains `order.detail.payment`,
`order.shipment.row.actions` and `order.shipments.tab.actions`, each with its
`AdminZonePropsMap` entry: `OrderDetailZoneProps { orderId }`,
`OrderShipmentRowZoneProps { orderId, shipmentId, deliveryMethodCode, providerCode, status }`
and `OrderShipmentsActionsZoneProps { orderId, deliveryMethodCode, latestShipmentId,
latestStatus }`. Added members and added interfaces, so nothing a consumer writes today
stops compiling; a host that renders one of the three needs the props exactly as declared,
because `match` compares against them by key and a key the props do not carry never agrees.

`@endora-commerce/mod-payments` gains an `./admin` subpath — its first — exporting one
contribution to `order.detail.payment` at `payments:read`. The panel it loads is
`admin/src/modules/orders/OrderPaymentsTab.tsx`, which `orders` used to own and render
behind a hard-coded `{ module: 'payments' }` visibility gate.

`@endora-commerce/mod-inpost` adds a second zone contribution, to
`order.shipment.row.actions` at `inpost:manage`, narrowed by
`match: { providerCode: 'inpost', status: 'success' }` — the branch `orders` used to write
in its own JSX, and the first `match` in this repository.

`@endora-commerce/mod-dhl-parcel` adds **two** contributions to
`order.shipments.tab.actions`: the label and the handover protocol at `dhl_parcel:read`,
the courier booking at `dhl_parcel:write`, matched on the module's two delivery-method
codes. **This is a behaviour change and it is the point**: the three buttons those
contributions replace carried no permission gate at all, while the routes behind them have
always enforced those two codes. An operator without them was shown three buttons that
answered 403; they are absent now. Six `shipmentActions.*` strings join this package's own
`i18n/` bundle in both shipped languages, and the five `orderDetail.shipments.actions.*`
keys they replace leave `_i18n`'s — no module but this one read them.
