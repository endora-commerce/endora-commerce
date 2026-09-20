---
'@endora-commerce/mod-inpost': minor
---

`./test-support` publishes the nine names a host-owned test reaches by package name

`@endora-commerce/mod-inpost/test-support` carried two entity row types and nothing else. It now
also exports, all of them this module's own production symbols and none of them new code:

- `INPOST_LOCKER_ADAPTER_KEY`, `INPOST_COURIER_ADAPTER_KEY` and `INPOST_SETTING_CODES`, from
  `./backend/constants.js` — the two shipping-adapter keys and the setting codes, including the
  activation control Constitution XVII item 6 drives.
- `InpostWebhookLedger`, `InpostShipmentLinks` and `InpostWebhookService`, the idempotency ledger,
  the shipment-link store and the webhook service, constructible against a real EntityManager.
- `ReceiveShipmentHandlerPort`, as a type: the `receive_shipment` port shape
  `InpostWebhookService`'s constructor already takes, so a double can be annotated without reaching
  into `@endora-commerce/mod-shipments` — which gains no export and no new subpath from this.
- `registerInpostPublicRoutes` and `InpostWebhookAuth`, the public ShipX webhook receiver and its
  token authenticator, registrable on a bare Fastify instance.

`minor` rather than `patch`: this is additive published surface, and `specs/conventions/release-intent.md`
makes the level the author's judgement. In a `0.x` series a minor takes every caret dependent out of
range, which is what a consumer pinning `^0.10.0` should be made to notice about a subpath that
changed shape.

Nothing on `.`, `./backend`, `./migrations` or `./admin` moves, so a consumer of the module — as
opposed to a test composing against it — sees no change. `./test-support` is the development-only
layer; it is not resolved by an installed deployment.
