# @endora-commerce/mod-payments

## 0.7.0

### Major Changes

- f566742: `POST /api/v1/orders/:orderId/payments/retry` refuses with three codes of this
  module's own, and all three refusals are translated.

  `PaymentRetryService.retryForCustomer` answered `409 VALIDATION_FAILED` for
  every one of its three refusals. It now answers one of three codes this package
  declares and translates:

  | Condition                                                                             | Code                          |
  | ------------------------------------------------------------------------------------- | ----------------------------- |
  | The money is not the buyer's to pay — paid, drawn against a credit limit, or refunded | `PAYMENT_NOT_DUE`             |
  | The order's lifecycle status is terminal, so somebody cancelled it                    | `PAYMENT_ORDER_CLOSED`        |
  | The method the order was placed with has no adapter registered any more               | `PAYMENT_ADAPTER_UNAVAILABLE` |

  **If you branch on the code**, this is the change to make:

  ```diff
   const res = await retryPayment(orderId);
   if (res.status === 409) {
  -  showCannotPay(res.body.error.message);
  +  switch (res.body.error.code) {
  +    case 'PAYMENT_NOT_DUE': showNothingToPay(); break;
  +    case 'PAYMENT_ORDER_CLOSED': offerToReorder(); break;
  +    case 'PAYMENT_ADAPTER_UNAVAILABLE': offerToContactTheShop(); break;
  +  }
   }
  ```

  The status is unchanged, so a client that reads only the status needs nothing.
  Three codes rather than one because the buyer's next move differs in each: with
  `PAYMENT_NOT_DUE` there is nothing to do, with `PAYMENT_ORDER_CLOSED` the goods
  need a new order, and with `PAYMENT_ADAPTER_UNAVAILABLE` the order is still open
  and still owed — what is broken is the shop's configuration.

  The package also exports `paymentsErrorCodes`, the branded declaration those
  three come from (`defineModuleErrorCodes`). Name a code through it rather than
  as a string literal and a typo is a compile error.

  **The reason this is worth a release note rather than a tidy-up.**
  `VALIDATION_FAILED` is the one code `localizeErrorEnvelope` returns _before_
  translating — deliberately, because the code is overloaded and several services
  carry machine-readable tokens in its message. So each refusal was served as the
  raise site's hard-coded English to every buyer, in every language. Measured with
  the correct English sentence at each raise site, both bundles installed and only
  the locale under test: a buyer sending `Accept-Language: pl` still received
  `This order is not awaiting payment.` A Polish buyer now reads _"To zamówienie
  nie oczekuje na płatność."_, _"To zamówienie zostało zamknięte i nie można go
  już opłacić."_ and _"Metoda płatności wybrana przy składaniu tego zamówienia nie
  jest już dostępna."_

  This package shipped no `i18n` bundle at all before this change — it has no
  admin screen of its own — so `i18n/en.json`, `i18n/pl.json` and the manifest's
  `i18n` declaration arrive with the codes.

### Minor Changes

- e41284d: `orders` and `payments` are module packages. Each publishes a root export (its
  manifest) and `./backend` (`registerModule` plus its `entities` array);
  `mod-orders` also publishes `./migrations` and a type-only `./ports`.

  **`mod-payments` publishes no `./ports`, and the interface you are looking for is
  on `mod-orders`.** `PaymentPlacementApplyPort` and `PaymentOpened` are declared by
  `@endora-commerce/mod-orders/ports` even though `payments` is what implements and
  registers them:

  ```diff
  -import type { PaymentPlacementApplyPort } from '@endora-commerce/mod-payments/ports';
  +import type { PaymentPlacementApplyPort } from '@endora-commerce/mod-orders/ports';
  ```

  The reason is structural rather than stylistic, and it is worth knowing if you are
  writing a module of your own that pairs with another. The two modules reach each
  other — order placement opens a payment row inside the order's transaction, and a
  gateway settlement stamps the order's payment status inside the payment's — so
  only one of the two npm edges can exist: a mutual devDependency between two module
  packages is a build **deadlock** rather than a race, because every package build
  sets `noEmitOnError`, so the side that loses emits nothing and the side that would
  have won never gets the `.d.ts` it is waiting for. The declaration therefore goes
  to the module the other names in its manifest `dependencies` — here `orders`,
  because `payments` declares it — which is the direction that adds no claim the
  manifest does not already make.

  Nothing about the seam itself changed: the container name is still
  `paymentPlacementApplyPort`, `payments` still provides it with a typed
  `providePort<T>` and still names it at its `implements` clause, and the
  `payments.order_id -> orders.id` foreign key that makes the call co-transactional
  is untouched. Resolve it exactly as before:

  ```ts
  const placement = lazyPort<PaymentPlacementApplyPort>(ctx, 'paymentPlacementApplyPort');
  ```

  `OrderPaymentStatusApplyPort` is on `@endora-commerce/mod-orders/ports` too, where
  it has always been, and is `orders`' own.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

- bbf9258: Three admin zone members for the order detail, and both of its carriers become contributors.

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

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [5d9bb88]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [73da94f]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [fd75757]
- Updated dependencies [4412591]
- Updated dependencies [e41284d]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [5253b3e]
- Updated dependencies [e1465e0]
- Updated dependencies [7af67c0]
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [afedd32]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/mod-orders@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
