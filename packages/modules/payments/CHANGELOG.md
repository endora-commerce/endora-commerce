# @endora-commerce/mod-payments

## 0.10.2

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/mod-orders@0.10.7
  - @endora-commerce/platform@0.13.3

## 0.10.1

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/mod-orders@0.10.6
  - @endora-commerce/platform@0.13.2

## 0.10.0

### Minor Changes

- 7f14ad6: `payments` now creates the `payments.refunded_amount` column its `Payment` entity maps, in its first own migration, `Migration20260925T115728PaymentsRefundedAmount`.

  Until now the only migration creating that column was `@endora-commerce/mod-stripe`'s, so an instance without `stripe` could not record a payment, and a hard uninstall of `stripe` dropped a column this module reads and writes. The new migration runs `alter table "payments" add column if not exists "refunded_amount" numeric(14,2) not null default '0'`: on every database that already has the column it is a no-op and keeps every value; on a fresh one it creates it with `0`. Its `down()` is deliberately empty, because the `payments` table is the platform's and its rows outlive this module's uninstall — dropping the column would silently reset every surviving payment's refunded amount.

  The package gains a `./migrations` subpath and a `@mikro-orm/migrations` `^6` peer dependency, the same shape every module that ships a migration has. Regenerate the migration registry (`pnpm --filter backend run composer:generate` in this repository, `endora generate` in an instance) so the migration runs.

### Patch Changes

- 0261b2f: Source comments only: the mixed-case e-mail example uses an `example.com` address, and a migration comment cites its design record without a repository path. No runtime change.
- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/email-components@0.9.5
  - @endora-commerce/mod-orders@0.10.5
  - @endora-commerce/platform@0.13.1

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/mod-orders@0.10.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/mod-orders@0.10.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-orders@0.10.2

## 0.9.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/mod-orders@0.10.1
  - @endora-commerce/platform@0.11.1

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/email-components@0.9.0
  - @endora-commerce/mod-orders@0.10.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-orders@0.9.1
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [b9169a9]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/mod-orders@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/mod-orders@0.8.0

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
