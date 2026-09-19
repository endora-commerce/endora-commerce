# @endora-commerce/mod-orders

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-carts@0.9.2
  - @endora-commerce/mod-credit-limits@0.9.2
  - @endora-commerce/mod-inventory@0.12.1
  - @endora-commerce/mod-invoices@0.10.1
  - @endora-commerce/mod-promotions@0.10.2

## 0.10.1

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
  - @endora-commerce/mod-invoices@0.10.0
  - @endora-commerce/mod-inventory@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/mod-carts@0.9.1
  - @endora-commerce/mod-credit-limits@0.9.1
  - @endora-commerce/mod-promotions@0.10.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

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
  - @endora-commerce/mod-carts@0.9.0
  - @endora-commerce/mod-credit-limits@0.9.0
  - @endora-commerce/mod-inventory@0.11.0
  - @endora-commerce/mod-invoices@0.9.0
  - @endora-commerce/mod-promotions@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5f64f59]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/mod-inventory@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-carts@0.8.2
  - @endora-commerce/mod-credit-limits@0.8.2
  - @endora-commerce/mod-invoices@0.8.2
  - @endora-commerce/mod-promotions@0.9.1
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- b9169a9: `orders` resolves the three registries it reads from `payment_methods` and
  `delivery_methods` per read, behind the presence probe its `degrades-without`
  declarations already promise (D-228).

  `OrdersModuleOptions`' `paymentAdapterRegistry`, `shippingAdapterRegistry` and
  `paymentOrderStatusRegistry` now return `T | null`, and `OrderService`'s
  `paymentDeps` takes the three as accessors rather than as values. A consumer
  composing the module through `registerModule` is unaffected; a consumer
  constructing `OrderService` directly passes `paymentAdapters: () => registry`
  where it passed `paymentAdapters: registry`.

  The plugin body no longer invokes the accessors. It ran under `avvio` while
  routes were being registered, so the container was asked before any request
  existed: a composition that never installed the owner threw
  `AwilixResolutionError` instead of degrading, and the one answer it did get was
  frozen for the life of the process, leaving placement dispatching through a
  table an operator had switched off.

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [02838b7]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/mod-inventory@0.9.0
  - @endora-commerce/mod-promotions@0.9.0
  - @endora-commerce/mod-carts@0.8.1
  - @endora-commerce/mod-credit-limits@0.8.1
  - @endora-commerce/mod-invoices@0.8.1
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
- Updated dependencies [6e037cd]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [a2d2fb0]
- Updated dependencies [089d2d4]
- Updated dependencies [142fcdd]
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
  - @endora-commerce/mod-credit-limits@0.8.0
  - @endora-commerce/mod-inventory@0.8.0
  - @endora-commerce/mod-invoices@0.8.0
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/mod-carts@0.8.0
  - @endora-commerce/mod-promotions@0.8.0

## 0.7.0

### Major Changes

- fd75757: `POST /api/v1/orders/:id/cancel` refuses with `ORDER_NOT_CANCELLABLE`, and the
  refusal is translated.

  `CustomerOrderCancellationService.cancelByCustomer` answered
  `409 VALIDATION_FAILED` when the buyer may not cancel the order. It now answers
  `409 ORDER_NOT_CANCELLABLE`, which is what
  `specs/001-b2b-platform-foundation/contracts/orders.contract.md` has specified
  for this route all along.

  **If you branch on the code**, this is the change to make:

  ```diff
   const res = await cancelOrder(orderId);
   if (res.status === 409) {
  -  if (res.body.error.code === 'VALIDATION_FAILED') showCannotCancel();
  +  if (res.body.error.code === 'ORDER_NOT_CANCELLABLE') showCannotCancel();
   }
  ```

  The status is unchanged, so a client that reads only the status needs nothing.
  The other 409 this route can answer is unchanged too: `INVALID_TRANSITION`,
  raised when the buyer _may_ cancel and the configured status graph refuses the
  move anyway, is a different condition and keeps its own code.

  **The reason this is worth a release note rather than a tidy-up.**
  `VALIDATION_FAILED` is the one code `localizeErrorEnvelope` returns _before_
  translating — deliberately, because the code is overloaded and several services
  carry machine-readable tokens in its message. So the refusal was served as the
  raise site's hard-coded English to every buyer, in every language, while
  `errors.ORDER_NOT_CANCELLABLE` sat written and translated in this package's own
  `i18n/en.json` and `i18n/pl.json`, unreachable. A buyer asking for Polish now
  gets _"Tego zamówienia nie można już anulować."_; the English sentence is the
  bundle's, not the service's, and the message written at the raise site is only
  the fallback the envelope substitutes when no bundle answers.

  The module's `errorCodes` declaration is not in this change and is not needed
  by it: feature 090's `orders` migration declares both codes this package owns,
  and `ORDER_NOT_CANCELLABLE` routes here through `@endora-commerce/mod-i18n`
  either way — by the declaration once it is composed, and by the `ORDER_*` prefix
  chain before that. The sentence was reachable all along; nothing raised the code
  that reaches it.

- 5253b3e: Four promise-form `catch`es stop swallowing `ModuleDisabledError`. Each is a call that
  answered "there is nothing here" for a capability the operator had switched off, and each
  therefore has a new contract for its caller.

  **Breaking — `OrderConfirmationService.resolveAdditional(organizationId, salesChannelId)`.**
  It documented "invalid or empty entries are dropped, never fatal" and returned `[]` for any
  failure of the organisation read, which goes through `organizationDetailsPort`. It now
  rejects with `ModuleDisabledError` when `organizations` is absent and still returns `[]` for
  every other failure.

      // before — an order confirmed with the buyer as its only recipient
      const extra = await confirmation.resolveAdditional(orgId, channelId);

      // after — the caller decides, because it can now tell the two apart
      let extra: string[];
      try {
        extra = await confirmation.resolveAdditional(orgId, channelId);
      } catch (error) {
        rethrowIfModuleDisabled(error);
        throw error;
      }

  **Breaking — `resolveEmbedderConfig(settings, channelId, credentials)`.** It returned the
  empty config, which every caller reads as "LLM search is not configured", for an absent
  `credentials` module as well as for an unset reference. It now rejects with
  `ModuleDisabledError` for the first and still returns the empty config for the second.

  **Breaking — `LlmProviderFactory.capability()` and `.resolve()`.** `capability()` reported
  `not_configured` and `resolve()` threw `AssistantNotConfigured` when `credentials` was
  absent, sending the operator to configure a credential that was already configured. Both now
  let `ModuleDisabledError` through.

  **Breaking — `DeliveryConfigService.remove(productFeedId)`.** The credential cleanup after
  the configuration delete absorbed everything. It now rejects with `ModuleDisabledError` when
  `credentials` is absent — the configuration row is gone and its secret is not, and a retry
  cannot reach the secret because the code that named it went with the row. A credential that
  is merely already gone is still tolerated.

  `@endora-commerce/mod-pim-pimcore` is a rename with no API surface: one file-scoped `worker`
  binding becomes `deliveryWorker`.

### Minor Changes

- 543151a: `catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

  **`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
  gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
  with eight `routes` and six `nav` declarations — the product roster and editor, the category
  tree, the attribute and attribute-set registries, the attachment types and the two
  bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
  nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
  that composes either package's `./admin` gets those screens without editing an application file.

  **`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
  `open-categories` and `open-attributes`, each with the destination, permission code and keywords
  the admin's hand-written palette row carried, and with the labels and descriptions those rows
  rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
  `open-orders` action it had declared all along.

  **`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
  `@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
  declaration names its icon rather than importing it, and `orders`' three sidebar rows render
  that glyph.

  **Breaking for a consumer that imports these two modules' screens from the admin application.**
  Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
  were deleted with them:
  - `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
  - `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
    `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
    `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
    `@endora-commerce/admin-kit/lib`'s.

  **`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
  `appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
  shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
  module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
  bundles.

  **One route tightens.** `/orders/new` was declared by the admin application and therefore
  ungated, while the sidebar row that advertised it carried `orders:write`; the route is
  `@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
  previously open an order-entry form whose save would refuse now meets the admin's not-found
  treatment instead.

- 9b2a43e: Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
  zone a tab strip.

  `@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
  `OrderEntryTabsZoneProps`, which is empty: the contributions _are_ the tabs, so the mount has
  no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
  `<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
  an `<AdminZone>` mount is.

  `@endora-commerce/admin-kit` gains two exports:
  - `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
    and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
    per-contributor error boundary and the `weight` ordering are unchanged. **It renders
    nothing at all when fewer than two contributions survive presence and permission**: one tab
    is not a choice. The floor is a constant rather than a prop, deliberately — two is a
    property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
    refuses.
  - `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
    own selected state, because in a contributed strip no component sees the whole set. That
    costs `RouteTabs`' _longest-wins_ tie-break: two contributed tabs whose paths are prefixes
    of one another would both read as selected. `RouteTabs` itself is unchanged and is still
    the primitive to use whenever one component knows every tab.

  `@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
  _Standard order_ tab at weight 100. `@endora-commerce/mod-quick-order` gains the _Quick
  order_ tab at weight 200. Both are gated on `orders:write`, which is the code their routes
  enforce. Each label now ships in its own module's bundle
  (`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

  **If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
  both module ids and both routes and belonged to neither module; mount the zone instead:

  ```diff
  -import { OrderEntryTabs } from '@/components/OrderEntryTabs';
  -<OrderEntryTabs />
  +import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
  +<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
  ```

- 49164fb: `OrderRecord` gains `shippingAdapterData?: Record<string, unknown> | null`, and
  `orderReadPort` projects it.

  The adapter-specific shipping envelope captured at placement (feature 068). Opaque on the
  record on purpose: only the delivery method's own `ShippingAdapter` knows its shape, and
  the reader that needs it is that same adapter reading back what it wrote. It is published
  so a carrier module can read the order it is shipping over `OrderReadPort` instead of
  importing `orders`' entity.

  Additive: no existing field moves and no caller has to change.

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

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

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

- 4412591: `orders` declares the two error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  both of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

  No `tokens` are declared: neither code carries a refusal discriminator. Every
  one of `ORDER_NOT_FOUND`'s fifteen raise sites is a three-argument
  `new HttpError`, so nothing can put a `details.code` on the wire, and
  `ORDER_NOT_CANCELLABLE` has no raise site at all.

  The list is short and the module is not. This package throws eighteen distinct
  error codes and owns exactly one of them — `INVOICE_NOT_READY` is `invoices`',
  `CART_EMPTY` is `carts`', `STOCK_UNAVAILABLE` is `inventory`', and fourteen more
  belong to the platform block. Ownership follows the domain noun and never the
  thrower.

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
- Updated dependencies [f2ffa45]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [ed34cac]
- Updated dependencies [f8ffc57]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [5d9bb88]
- Updated dependencies [3b07abc]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [b9d2f12]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [6e6d7d7]
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
- Updated dependencies [e637f56]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [af72a42]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [98ef35e]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [705d398]
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
- Updated dependencies [44d0ec3]
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
  - @endora-commerce/mod-credit-limits@0.7.0
  - @endora-commerce/mod-carts@0.7.0
  - @endora-commerce/mod-inventory@0.7.0
  - @endora-commerce/mod-invoices@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/mod-promotions@0.7.0
