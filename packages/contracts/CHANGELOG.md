# @endora-commerce/contracts

## 0.14.0

### Minor Changes

- d5778af: `@endora-commerce/contracts` no longer exports DHL Parcel's schemas; a carrier integration publishes its own

  **If you import any `dhlParcel*` or `DhlParcel*` symbol from `@endora-commerce/contracts`, this
  release removes it.** Twenty-two exports go — `dhlParcelModeSchema`,
  `dhlParcelAdapterKeySchema`, `dhlParcelLabelTypeSchema`, `dhlParcelConfigSchema`,
  `dhlParcelConfigUpdateSchema`, `dhlParcelPickupPointSchema`,
  `dhlParcelPickupPointListSchema`, `dhlParcelPickupPointQuerySchema`,
  `dhlParcelShipmentDocumentSchema`, `dhlParcelCourierBookingRequestSchema`,
  `dhlParcelConnectionCheckSchema` and each inferred type beside them. They are now on
  `@endora-commerce/mod-dhl-parcel`'s own `./contracts` subpath:

  ```diff
  - import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/contracts';
  + import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/mod-dhl-parcel/contracts';
  ```

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing DHL24's SOAP API is only usable by an instance that installs the DHL
  Parcel module, so shipping it here asked every consumer to carry per-vendor contract for an
  integration most of them will never run — and, once a carrier module is published from somewhere
  else, put the schema and the code it describes under two owners. The module now carries both.
  This is the same move `@endora-commerce/mod-inpost` made one release earlier, and DHL Parcel is
  the last carrier it applies to.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
  npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
  the whole consumer-facing meaning of a break.

  **Nothing else in the estate changes shape.** The `./contracts` subpath is not new — it arrived
  with `@endora-commerce/mod-inpost` — and it is rendered from a `src/contracts/` directory, so it
  appears only on a package that has one.

  **No changeset names `@endora-commerce/mod-dhl-parcel`, and that is deliberate.** This merge
  request deletes that package from this repository; the module is published from the repository
  that now holds its source, and a changeset for a package this branch deletes has nothing to
  version.

  **And none names `@endora-commerce/mod-delivery-methods` either**, which it did when
  `mod-inpost` left: that release was the one where its shipped page stopped linking a departing
  sibling, and the page already names carrier modules without linking one. Checked rather than
  assumed — no `.md` shipped by any package links a DHL page.

- e267293: `@endora-commerce/contracts` no longer exports the five payment gateways' schemas; a gateway integration publishes its own

  **If you import any `stripe*`/`Stripe*`, `tpay*`/`Tpay*`, `payu*`/`Payu*`, `autopay*`/`Autopay*`
  or `paypal*`/`Paypal*` symbol from `@endora-commerce/contracts`, this release removes it.** One
  hundred and thirty exports go, across five vendors — 23 for Stripe, 31 for TPay, 33 for PayU, 20
  for Autopay and 23 for PayPal. Each vendor's config, config-update, method-rule, method-update,
  method-list, mode and display-mode schemas, its saved-card and BLIK-alias shapes where it has
  them, its storefront config and its pay/create/capture request and response shapes, together with
  every type inferred beside them. They are now on each module's own `./contracts` subpath:

  ```diff
  - import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/contracts';
  + import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/mod-stripe/contracts';
  ```

  **Two removals are worth calling out by name, because neither reads as a gateway symbol.**
  `countryCodeSchema` — the unprefixed ISO-3166-1 alpha-2 schema — was declared in `stripe.ts` and
  reached the barrel from there, so it leaves with Stripe and is now
  `@endora-commerce/mod-stripe/contracts`' export. Nothing in this repository imported it outside
  that file, but its name says nothing about Stripe, so a consumer that found it on the barrel has
  no way of guessing where it went without this paragraph. `AUTOPAY_GATEWAY_ID_BY_METHOD`, the
  method-to-GatewayID map, moves with Autopay for the same reason it existed: it is Autopay's wire
  vocabulary, not the platform's.

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing Stripe's or PayU's API is only usable by an instance that installs
  that gateway, so shipping it here asked every consumer to carry per-vendor contract for
  integrations most of them will never run — and, once a gateway module is published from somewhere
  else, put the schema and the code it describes under two owners. Each module now carries both.
  This is the same split `@endora-commerce/mod-inpost`, `@endora-commerce/mod-dhl-parcel` and
  `@endora-commerce/mod-wfirma` took before them; these five are the fourth through eighth packages
  to use the `./contracts` subpath, and the first payment family to.

  The five gateway packages are a **minor** because each gains a published subpath — `./contracts`,
  rendered into its `exports` map by `manifests:generate` — which is additive and nothing else about
  them changes. `@endora-commerce/contracts` is a minor rather than a `major`: no package in this
  repository leaves `0.x` before the move to public npmjs, and in a `0.x` series a minor already
  takes every caret dependent out of range, which is the whole consumer-facing meaning of a break.

  **One duplication is created deliberately and is not solved here.** A published
  `@endora-commerce/contracts` older than this release still exports all 130 symbols, so an
  instance holding both it and a new gateway package resolves two copies of the same Zod schemas
  until a new `contracts` is cut. They are structurally identical and neither is compared against
  the other by identity anywhere, so the duplication is latent; it ends with the next `contracts`
  release, exactly as it does for the three packages that took this split before.

- d6bfea0: `@endora-commerce/contracts` no longer exports InPost's schemas; a carrier integration publishes its own

  **If you import any `inpost*` symbol from `@endora-commerce/contracts`, this release removes it.**
  Twenty-one exports go — `inpostConfigSchema`, `inpostConfigUpdateSchema`,
  `inpostGeowidgetConfigSchema`, `inpostLockerShippingAdapterDataSchema`, `inpostModeSchema`,
  `inpostAdapterKeySchema`, `inpostSendingMethodSchema`, `inpostParcelTemplateSchema`,
  `inpostLabelSizeSchema`, `inpostLabelErrorCodeSchema`, `normalizePolishMobilePhone` and each
  inferred type beside them. They are now on `@endora-commerce/mod-inpost`'s own `./contracts`
  subpath:

  ```diff
  - import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/contracts';
  + import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/mod-inpost/contracts';
  ```

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing InPost's ShipX API is only usable by an instance that installs the
  InPost module, so shipping it here asked every consumer to carry ~5 300 lines of per-vendor
  contract for integrations most of them will never run — and, once a carrier module is published
  from somewhere else, put the schema and the code it describes under two owners. The module now
  carries both.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
  npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
  the whole consumer-facing meaning of a break.

  **A new published subpath, `./contracts`, exists on module packages from this release.** It is
  rendered from a `src/contracts/` directory and appears only on a package that has one; nothing
  else in the estate changes shape. `@endora-commerce/mod-inpost` is the first to use it.

  `@endora-commerce/mod-delivery-methods` is a documentation patch, and the reason is the same
  split: its page linked a sibling carrier's page, which is a broken link in every instance that
  does not install that carrier. It now names carrier modules without linking one.

- b3b4286: `@endora-commerce/contracts` no longer exports wFirma's schemas or its two error codes

  **If you import any `wfirma*` or `WFIRMA_*` symbol from `@endora-commerce/contracts`, this
  release removes it.** Twenty-six exports go — `WFIRMA_SETTING_CODES`, `WFIRMA_READ_PERMISSION`,
  `WFIRMA_WRITE_PERMISSION`, `WFIRMA_INSTANCE_CREDENTIAL_CODE`, `WFIRMA_DELIVERY_MESSAGES`,
  `WFIRMA_HOST`, the eight `WFIRMA_*_PATH` endpoint constants, `WFIRMA_WEBHOOK_EVENT_IDS`,
  `wfirmaWebhookEventIdSchema`, `wfirmaWebhookEventDescriptorSchema`, `wfirmaConnectionDtoSchema`,
  `wfirmaConnectionUpsertBodySchema`, `wfirmaConnectionTestResponseSchema`, `WfirmaHttpPort` and
  each inferred type beside them. They are now on `@endora-commerce/mod-wfirma`'s own
  `./contracts` subpath:

  ```diff
  - import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/contracts';
  + import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/mod-wfirma/contracts';
  ```

  **And `ERROR_CODES` loses two members**, `WFIRMA_CONNECTION_FAILED` and
  `WFIRMA_WEBHOOK_NOT_FOUND`. That half is not tidying and has a rule behind it: an `ERROR_CODES`
  member that no installed manifest declares routes nowhere, so an operator reads the raising
  code's own English instead of a translated sentence — `check:error-translations`'
  `undeclared-enum-member`, which is what a code whose only declarant has left looks like. The two
  codes are declared by `@endora-commerce/mod-wfirma`'s manifest and translated in its own
  `i18n/` bundles, which is where they now live in full.

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing wFirma's REST API is only usable by an instance that installs the
  wFirma module, so shipping it here asked every consumer to carry per-vendor contract for an
  integration most of them will never run — and, once a vendor module is published from somewhere
  else, put the schema and the code it describes under two owners. The module now carries both.
  This is the same split `@endora-commerce/mod-inpost` and `@endora-commerce/mod-dhl-parcel` took
  in the `0.10` line; `@endora-commerce/mod-wfirma` is the third package to use the `./contracts`
  subpath and the first outside the carrier family.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to
  public npmjs, and in a `0.x` series a minor already takes every caret dependent out of range,
  which is the whole consumer-facing meaning of a break.

  `@endora-commerce/mod-invoice-ledger` is a patch and nothing it publishes changes behaviour: a
  doc comment on `InvoiceLedgerDeliveryAttempt.remoteVendorNumber` named one vendor for a field
  every vendor writes, and its registry test stated a two-member vendor family whose second member
  was a module this repository no longer holds. Both now say what they mean without naming a
  vendor, which is D-256's rule for this module read one comment further than D-256 reached.

### Patch Changes

- 8a05249: `@endora-commerce/mod-invoice-ledger` no longer recognises a ledger vendor's sentences; it applies a shape floor

  **If you write a ledger adapter against `InvoiceLedgerDeliveryPort`, the text you pass to
  `markFailed` is now stored as you wrote it, provided it looks like a sentence.** Until this
  release the ledger imported two vendors' error vocabularies and stored `last_error`
  verbatim only when your text was one of those vendors' sentences — anything else, including
  every sentence your own adapter authored, became _"The ledger vendor returned an unreadable
  error."_ The floor is now vendor-independent and refuses four shapes over the trimmed input:
  - it contains `<` or `>`;
  - it contains a control character — a newline, a carriage return, a tab, or any of C0, DEL, C1;
  - its first character is `{` or `[`;
  - it is longer than 500 characters.

  Any of those yields `INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR`. **Nothing is truncated** — a
  refusal is whole, because half a sentence is prose nobody wrote and can cut a leaked token in
  two. Whitespace-only input is refused as before, and `null` and `''` are returned unchanged.

  **What this means for an adapter you maintain.** Map the vendor's HTTP outcome onto your own
  operator sentence before you call `markFailed`, and assert in your own package that every
  sentence you can produce clears the four clauses above. Do not hand the ledger a response body,
  a header dump or an exception's `stack`: it will be stored as `unreadable` and the operator
  loses the detail. If your sentence composes text the vendor wrote — a field name, a validation
  message — bound that composition yourself; the 500 is a backstop, not a budget.

  **Why.** `@endora-commerce/mod-invoice-ledger` is the general-purpose half of this family: it
  persists a delivery and knows nothing about any one accounting vendor. It was nevertheless
  importing `WFIRMA_DELIVERY_MESSAGES` and `INFAKT_DELIVERY_MESSAGES` to re-recognise sentences the
  two adapters had already mapped — one vocabulary with two owners, and a vendor-agnostic package
  carrying two specific integrations' error text. The vendor that authors a sentence now owns both
  the vocabulary and the mapping; the ledger, which is the component that persists, keeps a floor
  and no vocabulary. A registry contributed by the vendors was considered and refused: on the read
  path a deactivated vendor's historical rows would re-read as _unreadable_, and on the write path
  the caller **is** the vendor, so the ledger would be asking a registry the vendor populated
  whether the vendor's sentence is one of the vendor's sentences.

  **`@endora-commerce/mod-wfirma` is no longer named here, and the release it was promised is
  the paid repository's to make.** Feature 134's wave 4 took that package out of this workspace
  between this changeset being written and this release going out, so `changeset version` can no
  longer honour an intent for it — `check:release-intent`'s `unversionable-changeset`, which is
  the finding that exists because a changeset naming a non-member exits 0 from `changeset status`
  and is byte-identical to a clean branch. The behaviour below is real and unreleased; whoever
  cuts `@endora-commerce/mod-wfirma` next, from the repository that now holds its source, owes it
  a `minor` and this paragraph as its body.

  **`formatWfirmaValidationError` now bounds its own composed tail, and exports the bound.** The composed sentence is `wFirma rejected the invoice.` followed
  by the field messages lifted out of wFirma's own JSON or XML body, which was unbounded. A field
  message carrying markup or a control character is now dropped whole; a composition whose tail
  exceeds `WFIRMA_VALIDATION_TAIL_MAX_LENGTH` (300, newly exported from
  `./backend`'s `wfirma-rest-client`) falls back to the bare sentence. The vendor sentence is
  never truncated and never exceeds the ledger's floor.

  **`@endora-commerce/contracts`: a comment, and nothing else.** The doc-blocks on
  `INFAKT_DELIVERY_MESSAGES` and, at the time, `WFIRMA_DELIVERY_MESSAGES` said _"Operator
  sentences the … worker and ledger mapper share"_, which is the design this release overturns.
  The wFirma half of that sentence has since left this package altogether — the sibling changeset
  in this same release removes it — so what this `patch` still describes is the Infakt doc-block.
  No exported value, type or schema changes for it; the bump is `patch` because a `.d.ts` comment
  is part of what the package emits and nothing more than that moved.

  **No changeset names `@endora-commerce/mod-infakt`.** Its only change is a co-located
  `*.test.ts`, and `src/**/*.test.ts` is excluded from that package's `tsconfig.json` and
  `tsconfig.build.json` alike — so the package emits exactly what it emitted before, and there is
  nothing to version.

## 0.13.0

### Minor Changes

- b413e2d: Connector family membership is declared in each module's own manifest and derived by the
  platform, replacing three hand-maintained arrays and the three boolean flags that
  duplicated them.

  ## Breaking: three manifest fields are removed

  _(Declared `minor` rather than `major` per **D-225**: no package leaves `0.x` before the
  move to public npmjs. In a `0.x` series the two carry the identical consumer-facing
  contract — `^0.9.0` excludes `0.10.0` exactly as it excludes `1.0.0` — so `minor` already
  forces the explicit opt-in that is what "breaking" means to a caller. The break is
  described below, which is where it belongs.)_

  `pimConnector`, `invoiceLedger` and `erpConnector` are gone from `ModuleManifestSchema`,
  along with `PIM_CONNECTOR_MODULES`, `INVOICE_LEDGER_MODULES` and `ERP_CONNECTOR_MODULES`.
  A module that declared one replaces it with a single additive line:

  ```ts
  capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],   // 'pim-connector'
  ```

  A capability's **owner** declares it mutually exclusive and mints the refusal code:

  ```ts
  exclusiveCapabilities: [
    { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
  ],
  ```

  The declaration carries membership only, creates no lifecycle edge, and requires no
  dependency on the owner's package — a key is a string literal, on the same terms as an
  error code. That is the point of the change: a connector installed from npm, and a
  per-deployment overlay module, can now join a family, which an array inside
  `@endora-commerce/contracts` could never let them do without editing a file they do not
  own.

  ## Breaking behaviour on upgrade: three PIM connectors become inactive

  **Read this before upgrading if you run Akeneo, Ergonode or Pimcore.**

  `pim_akeneo`, `pim_ergonode` and `pim_pimcore` shipped activated by default. They now ship
  **deactivated**, as every member of a mutually exclusive capability must
  (owner ruling, 2026-09-15).
  - **If you chose explicitly** — you switched the connector on or off on
    `/platform/modules` at any point — a settings row records that choice and **nothing
    changes for you**. The new default applies only where no override exists.
  - **If you never chose**, those three connectors were running on the shipped default and
    will be **off** after this upgrade. Switch the one you use back on at
    `/platform/modules`; the choice is recorded and survives every later upgrade.

  Nothing is deleted. Connections, identity maps, field protections and run history are
  preserved exactly as they were, and come back when the connector is switched on — the
  reversal is two clicks and no data is touched. **No migration writes an activation row**:
  changing a shipped default must not rewrite an operator's recorded choice, and the two
  migration-shaped alternatives were considered and rejected — materialising the effective
  value for everyone would persist three simultaneous exclusive claims attributed to an
  operator who made none, and materialising it only where a connection exists would put a
  read across four connectors' tables inside another module's migration and would pick one
  arbitrarily wherever several qualified.

  **Why the default had to move rather than being tolerated.** Exclusivity is enforced when a
  module is _activated_, so it guards the transition and not the state a deployment starts
  in. Three connectors shipping activated were therefore all active from the first boot, with
  no transition to refuse and nothing to report it — and the one connector that consulted the
  registry was refused activation out of the box, naming a connector the operator had never
  configured. A member of an exclusive capability declaring `default: true` is now refused
  when the platform derives the family, because the activation resolver returns booleans and
  carries no provenance: nothing downstream can tell a recorded choice from a shipped
  default, so a member that ships activated holds a claim nobody made.

  ## Also in this change
  - Exclusivity is **one** seam per family — a single `pre` interceptor on
    `POST /api/v1/admin/modules/:id/activation`, registered by the capability's owner over
    the derived family. It previously lived on one member with that member's id hard-coded,
    which is why only 1 of the 12 ordered pairs of the four PIM connectors was refused; all
    12 are now.
  - Exclusion resolves **effective** module presence — platform availability _and_ operator
    activation. A connector a deployment never installed no longer holds a claim.
  - `pim_akeneo` no longer refuses a connection save because another connector has a
    connection; that path validates its own module's activation and nothing else. The
    refusal an operator meets is the activation one, with the same code and the same
    `{ activeModuleId }` detail.
  - `PimErgonodeConnectorActivityPort` is removed from `@endora-commerce/contracts`: it
    existed so one connector could ask another about its connections, and has no caller.
  - Two keys never exclude each other. One ERP connector, one PIM connector and one
    invoice-ledger vendor may run together, which was always true and is now asserted.

## 0.12.0

### Minor Changes

- 4915024: Comarch ERP XL integration (feature 119): shared ERP connector layer and Comarch XL adapter.

  **`@endora-commerce/contracts`** adds `erp-connector.ts` and `comarch-xl.ts` (admin and wire
  schemas), `erpConnector` on `ModuleManifestSchema`, and `COMARCH_XL_*` / `ERP_CONNECTOR_*`
  error codes.

  **`@endora-commerce/mod-erp-connector`** is a new non-deactivatable infra package: mutual
  exclusion registry (`erpConnectorRegistryPort`), activation lock entity, and shared job/run
  vocabulary. Subpaths: `.`, `./backend`, `./migrations`.

  **`@endora-commerce/mod-comarch-xl`** is a new switchable connector package: OpenAPI v0.1.0
  REST client, identity mapping, BullMQ detect/sync pipeline, domain apply services, admin UI,
  and documented overlay ports. Subpaths: `.`, `./backend`, `./migrations`, `./admin`. Ships
  `i18n/` and operator documentation under `docs/`.

  **`@endora-commerce/mod-invoices`** extends the module with `erpSaleDocumentWritePort`,
  ERP-imported sale document entities, B2B customer routes, and attachment handling for XL
  sale documents.

  **`@endora-commerce/mod-inventory`** extends `inventoryStockImportPort` for Comarch XL stock
  apply wiring (warehouse snapshot import).

  **`@endora-commerce/mod-catalog`** honours `createProduct` request `status` instead of
  always defaulting new products to `draft`.

  Activation is gated by `comarch_xl.enabled` (default off). Only one `erpConnector: true`
  module may be operator-active at a time.

- 6b2ed26: `QuoteRequestReadPort` gains `findByBusinessId(businessId)`, answering the quote carrying a
  human-facing business id or `null`.

  It exists because `comarch_xl` needs it: an ERP offer names the quote it answers by the
  reference a person read off the document, never by the uuid. The connector had been reading
  `quote_requests` with a raw `select`, which crosses the module boundary without any
  specifier naming it and keeps returning rows after an operator has switched
  `quote_requests` off. Consumers resolve it through the container name
  `quoteRequestReadPort`, as they do the other three methods.

- 55fc950: wFirma invoice-ledger adapter (`specs/131-wfirma-integration/`): a second vendor on the
  existing ledger, with no schema of its own.

  **`@endora-commerce/mod-wfirma`** is a new switchable module package — connection screen and
  credential type, synchronous VAT copy, corrections, paid alignment, webhook ingress and a
  BullMQ delivery worker, plus KSeF delegation when the ledger's routing setting says `vendor`.
  Subpaths: `.`, `./backend`, `./admin`, `./tailwind.css`. Ships `i18n/` (`en`, `pl`) and its
  operator documentation under `docs/`. Activation is `wfirma.activation`, default off; while
  off it performs no wFirma HTTP, its screens and palette entry are gone and the webhook
  answers 503.

  **`@endora-commerce/contracts`** adds `wfirma.ts` (admin and wire schemas, `WfirmaHttpPort`,
  the two `WFIRMA_*` error codes) and extends `invoice-ledger.ts`: `wfirma` joins
  `INVOICE_LEDGER_MODULES`, and `InvoiceLedgerDeliveryPort.markAwaitingRemote` /
  `markSucceeded` take an optional `remoteVendorNumber`, which `LedgerDeliveryRecord` and
  `InvoiceLedgerDeliveryAttempt` now carry. Both port changes are additive — an existing
  implementation keeps compiling and an existing caller keeps its behaviour.

  **`@endora-commerce/mod-invoice-ledger`** implements those two fields: the vendor's own
  document number is recorded on the succeeding attempt and projected onto the record, and
  `markAwaitingRemote` may now also stamp the remote document id and the document map, which a
  vendor that assigns a number before the document is final needs.

  This changeset is written by the reviewer, not by the branch's author: the branch carried
  none, and `check:release-intent --since` refuses it on two counts —
  `manifest-changed-beyond-version` for the new package's manifest and
  `unattributed-package-change` relaying `changeset status`' own exit 1.

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

## 0.11.0

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

## 0.10.0

### Minor Changes

- 5bfefe0: `invoice_ledger_deliveries` and `invoice_ledger_document_maps` carry their own
  `organization_id` and are `@OrgScoped()`. They were
  `@TransitivelyScoped('Invoice', 'invoiceId')`, copied from `KsefSubmission` —
  and `ksef` declares `invoices` in its manifest `dependencies` while
  `invoice_ledger` is `nonDeactivatable` and may not, so an instance installing
  the locked set without `invoices` loaded both classes with no `Invoice`
  registered and the tenancy reconciliation refused its boot before a single
  migration ran.

  `InvoiceLedgerEnqueueInput` gains a required `organizationId`, resolved by the
  caller through `invoiceCopyHostPort` and frozen on the row beside the
  credential, the environment, the numbering mode and the KSeF routing that were
  already frozen there. One migration adds the column, backfills it through
  `invoices` and `orders` behind a `to_regclass` guard, and foreign-keys it to
  `organizations`. There is still no foreign key to `invoices`.

## 0.9.0

### Minor Changes

- 471defd: A scaffolded instance's `.env.example` declares everything that instance reads,
  and the `.env` beside it is the file a client actually edits.

  `endora new instance` wrote a `.env.example` carrying the **five build inputs**
  and nothing else, while the platform declared 23 runtime inputs and nine module
  packages declared nineteen more. The instance acceptance criterion had been
  reporting the gap in its own output for weeks — _"supplied `DATABASE_URL`,
  `REDIS_URL`, `SESSION_COOKIE_SECRET`, `PUBLIC_API_BASE_URL`, `NODE_ENV` to the
  instance's own processes; its `.env.example` declares none of them, so a client
  who fills in the file the command wrote has nothing to put them in"_.

  The file is now derived, never listed: the **resolved platform's**
  `PLATFORM_ENVIRONMENT_INPUTS`, unioned with the `env` of every module manifest
  the run installed, scoped to the members it wrote, each entry carrying that
  declaration's own `describes` and its `requirement` sentence rather than a
  rewrite. A different `--module` set is a different file with nothing edited.

  Three further changes make the file reach the process that needs it.
  - **A `.env` is written**, holding the secrets the run generated
    (`cli-product.md` R2.5d — the `generable && secret` class, four of them over
    the default module set) and a **commented-out** placeholder for every other
    declared input. Commented, because Node's `--env-file` reads `NAME=` as the
    empty string and the platform's `??` fallbacks treat that as a value: a file
    of blanks turned twenty *unset*s into twenty empty strings and the acceptance
    run's health route answered 503 over a search engine that was running. A
    `.env` the operator placed there first is merged into, never rewritten.
  - **Every `node` script the backend member declares carries
    `--env-file-if-exists=../.env`.** Without it the file was inert: the root
    scripts are `pnpm -C backend run …`, so a `.env` at the root of the tree was
    read by nothing and a client who filled it in still could not start.
  - The next-steps block no longer says `cp .env.example .env`, which would now
    overwrite the generated secrets with empty strings.

  New in `@endora-commerce/contracts`: `unionEnvironmentInputs`, the join over
  several authors' declarations, first author wins. New in
  `@endora-commerce/cli`: `instanceEnvironmentInputs`, `declaredEnvironmentInputs`,
  `generableEnvironmentInputs`, `backendScripts`, and `parseEnvFile` /
  `renderEnvValue` / `writeEnvFile` re-exported from the package root.
  `ModuleCandidate` gains `env`, `PlanInput` gains `declared`, `existingEnv` and
  `generated`, `DeployInput` gains `declared`, and `loadModuleCandidates` returns
  `{ candidates, platformEnv }` instead of the map alone — all four are breaking
  for a caller that constructs one of those shapes, and `major` is refused in a
  `0.x` series (D-225).

- c1d281f: `ModuleManifestSchema` gains `env?: EnvironmentInput[]` — the environment inputs a
  module owns, declared beside `permissions`, `actions`, `errorCodes` and
  `cliCommands`, so the same tree walk carries them into the generated manifest index.

  This is the only way a module's requirements can reach a client. A module package
  ships `dist`, `i18n` and `docs`; `.env.example` is a file in the platform's own
  repository, so a client who installs thirty modules and copies the example gets a
  file that does not mention what those modules read.

  `defineModuleManifest` now throws on an entry whose `owner` is not
  `{ kind: 'module', moduleId: <this module> }`. A module declares only what it
  **owns**: its read of a platform-owned name — `NODE_ENV`, `STOREFRONT_BASE_URL`,
  `REVALIDATE_SECRET` and the rest — is satisfied by the platform's own declaration,
  and declaring it again would be one fact with thirty homes.

  The field is optional and additive: a manifest that declares nothing is unchanged.

- 52c2bfd: `SearchReindexPort` is published: the container name `searchReindexPort`, owned
  by `search`, with the `Container name:` doc block its consumers read.

  It had a registration and no contract, which was invisible while the only
  consumer was a composition root — `check:port-shape`'s population is a module's
  own resolutions, and a root's read is outside it. `catalog` resolves the name
  directly since `specs/117-instance-bring-up/` Phase 6, and the check reported
  it on the first run.

### Patch Changes

- 10a17f0: The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

  `GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
  puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
  `composeTestServer` does the same, so an instance serves the probe because it is an Endora
  instance rather than because a module the scaffolder happened to select is installed. It was
  not: `endora new instance` writes the closure over the modules declaring
  `activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
  manifest named it as a dependency — so a scaffolded instance answered 404 on the route
  `deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
  storefront, which waits on `service_healthy`, never started. Moving the route also closes the
  withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
  `module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
  off a running instance with one command. Owner ruling D-229.

  **What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
  `composeTestServer` — the route arrives with the platform. Remove
  `@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
  route, its path, its payload and its status codes are unchanged.

  `@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
  `platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
  `HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

  `MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
  sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
  declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
  describe a platform input — while continuing to read it and to declare
  `MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
  `optional`, where `search`'s was `required`. Both readers have always defaulted to
  `http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
  declarations will no longer insist on the value.

## 0.8.0

### Minor Changes

- 5394b8f: Add Akeneo PIM transport error codes and `PimErgonodeConnectorActivityPort`.

  `ERROR_CODES` gains `PIM_AKENEO_NOT_CONFIGURED`, `PIM_AKENEO_CONNECTION_DISABLED`,
  `PIM_AKENEO_BOOTSTRAP_INCOMPLETE`, `PIM_AKENEO_DELIVERY_ID_CONFLICT`,
  `PIM_AKENEO_CHANNEL_REQUIRED`, `PIM_AKENEO_SECRET_REQUIRED`, and the shared
  `PIM_CONNECTOR_ALREADY_ACTIVE` used when enabling Akeneo while another PIM
  connector is already on.

  `PimErgonodeConnectorActivityPort` is the gated read Akeneo uses for that
  check (`pimErgonodeConnectorActivityPort`). Additive; existing Ergonode codes
  are unchanged.

- 0c9a799: Add Akeneo HMAC lookup item schemas for every collection in `lookups.md`.

  `akeneoLookupPageSchema` plus attribute-set, category, sales-channel, language
  and price-list item shapes join the existing attribute and product-link-kind
  schemas. Additive.

- e20276c: Add Akeneo field-protection DTOs and `PIM_AKENEO_FIELD_KEY_INVALID`.

  `akeneoFieldProtectionSchema`, the declarative replace request, and
  `akeneoProductProtectionsSchema` (connection flag, identity, protected set)
  are the catalogue editor surface. Additive.

- 9f7591b: Add Akeneo admin run list and detail envelopes.

  `akeneoImportRunListQuerySchema`, `akeneoImportRunListResponseSchema` and
  the expanded `akeneoImportRunDetailSchema` (counters plus `issuesTruncated`)
  are the source of truth for `GET /api/v1/admin/pim-akeneo/runs`. Additive.

- 142fcdd: `AssetReadPort` gains `openAssetBytes(assetId)`, and `assets_library` answers it.

  ```ts
  // new, on the existing `assetReadPort` container name
  openAssetBytes(assetId: string): Promise<AssetBytes | null>;

  // new exported type
  interface AssetBytes { bytes: Uint8Array; mimeType: string }
  ```

  The bytes of one live asset, buffered, with the MIME type they were stored under. It is the
  question a composition root was answering for `invoices` — embedding the operator's logo in
  an invoice PDF, which needs an inline `data:` URI because pdfmake resolves an `image:` by
  fetching it, and fetching `/assets/file/<id>` from the process that is serving the request
  deadlocks for a public asset and 403s for a private one.

  **Absence is the answer, not an exception**, exactly as `resolvePublicUrls` states it. An id
  that names no row, a soft-deleted one, a row on the `legacy` backend (a URL this library can
  resolve and an object it cannot open) and a configured store that would not stream are all
  `null`. The caller cannot tell "this asset is not there" from "the bucket did not answer",
  so it is not the caller's decision to make.

  **Here rather than on `AssetsLibraryPort`, and rather than left at the caller over
  `ObjectStoragePort`.** It is a read, and a consumer that wants a logo must not thereby
  acquire `upload`, `patchAsset` and `softDelete` — which is the argument `ObjectStoragePort`'s
  own doc block makes in the other direction. A caller that opened the store itself would carry
  three facts about this module's storage layout instead: that `legacy` has no `open`, that the
  locator falls back to `storageUrl` when the column is empty, and that the stream has to be
  drained.

  `Uint8Array` and not `Buffer`, for the reason `AssetByteStream` gives: this package is
  compiled by `@endora-commerce/admin-kit` with `types: ["vite/client"]`, so the `Buffer` global
  is not in scope. `Buffer` satisfies the shape, so a Node caller passes one through unchanged.

  **`minor` rather than `major`**, on this interface's own precedent: `resolvePublicUrls` was
  added to it three days ago as a minor, and the reasoning holds here — the port's consumers are
  callers, and its one implementer is the package that ships it, in the same release.

- 4eeb5cd: `cms` publishes `CmsBlockReadPort`, and `megamenu` resolves its own cross-module targets.

  **New on `@endora-commerce/contracts`:** `CmsBlockReadPort`, `CmsBlockRecord` and
  `CmsLocalizedBlockRecord`. Two methods, which is the whole of the demand.
  `findById(id)` answers _does this block exist_ and carries `active` on the record
  rather than filtering on it, because the two callers disagree about a deactivated
  block on purpose. `findLocalizedById(id, language)` answers _what does it render as
  here_ and is the reason the port exists: the per-language envelope —
  `content.languages[<code>]`, a legacy `schema_version` riding along, an absent key
  meaning "nothing authored" — is `cms`' storage layout, and a consumer that had to
  know it would be reading the column with extra steps. `null` covers all three
  absences, because a caller inlining a block has the same thing to do in each.

  **New on `@endora-commerce/mod-cms`:** the port is registered as `cmsBlockReadPort`
  with `ctx.di.providePort`, so it fails closed with 503 `MODULE_DISABLED` when an
  operator switches the CMS off. Nothing else changed in this package.

  **Removed from `@endora-commerce/mod-megamenu/backend`: `TargetValidatorDeps` and
  `StorefrontDeps`.** Both existed so a composition root could write eight closures
  against them — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
  the storefront URL shapes — and this module's own barrel argued they had to stay in
  a root until one of the three owners grew an existence-check port. All three have:
  `catalogCategoryReadPort`, `cmsPageReadPort` and `assetReadPort` came out of feature
  075, and `cmsBlockReadPort` above is the one that was still missing. The module now
  resolves those four plus `assetsLibraryPort` with `lazyPort` and declares the edges
  in its manifest, where `catalog` joins `cms`, `assets_library`, `languages`,
  `sales_channels`, `auth` and `dictionaries`.

  **If you contributed `megamenuValidatorDeps` or `megamenuStorefrontDeps`**, delete
  both contributions: the container names are read by nobody and registering them now
  does nothing. There is no replacement to write, and the interfaces are deleted
  rather than relocated — what replaces them is module-private and holds no closure.
  Make sure the composition registers the five ports, which it does by composing
  `catalog`, `cms` and `assets_library`.

  Two behaviours were divergent between the reference deployment and the test harness
  and are now single-valued, both settling on the deployment's answer: a category
  target resolves to `/c/<slug>` (the harness built `/catalog/<slug>`, which the
  reference storefront serves from nowhere), and a deactivated or soft-deleted
  category drops its menu item and its children (the harness narrowed on neither).
  A CMS page target is deliberately _not_ narrowed on status or `active`, which is
  what both roots did.

- 9eb0cb6: `ModuleDemoManifest` gains an optional `package` field — the demo-data escape hatch of
  `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §6.

  It is a package **name as a string** and must never be written as an `import` specifier
  anywhere in the module's sources. That is measured rather than stylistic: a module
  package's `package.json` is generated, and `peerNamesOf` records every specifier
  `namedSpecifiers` yields with **no filter on kind** — a walk that recognises
  `dynamic-import` — so a literal `await import('@endora-commerce/mod-<id>-demo')` becomes a
  _required_ peer and pnpm installs the demo package for every client, which is the opposite
  of what the field is for.

  ```diff
   const demo: ModuleDemoManifest<ModuleContext> = {
     summary: 'A demo catalogue of 200 products.',
  +  package: '@endora-commerce/mod-catalog-demo',
     seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
     reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
   };
  ```

  **The runner half is not built yet.** `@endora-commerce/platform`'s demo runner does not
  resolve the name — §6.3's three answers (loads / not installed / fails to load) and §6.4's
  probe-before-import are a separate change — so declaring it today records an intent and
  changes no behaviour. Do not take the hatch until the runner answers all three ways.

- ca43192: `EnvironmentInput` gains a required `addressOf`, and the CLI stops guessing which of a
  storefront's variables names a backend from the shape of the value.

  **Why.** Two programs ask _"which of these variables names the backend"_ — `endora new
storefront`, whose next step tells an author to point them at theirs, and that command's
  acceptance criterion, which does the pointing. Both answered it by reading
  `storefront/.env.example` for a value that looked like an absolute `http(s)` URL. That is
  right only while such a file declares no address but the backend's, and the reference
  storefront now declares its **own** public origin (`NEXT_PUBLIC_SITE_URL`) there — so the
  old predicate would have told a client, in a file they own outright and nobody revisits,
  that the shop's canonical origin "names the backend this storefront talks to".

  `addressOf` is a declaration of what a value **is**: which member of the instance it is
  the address of, or `null` where it is the address of none.

  **If you ship a declaration** — an application's `environment-inputs.mjs`, or the
  platform's — every entry needs the field. It is required rather than optional on purpose:
  an optional one is forgotten exactly once, by whoever adds the next address, in silence.
  Zod refuses a declaration without it at `loadTreeDeclaration`, so the failure is a
  sentence naming the entry rather than a variable that quietly stops being configured.

  ```diff
   {
     name: 'NEXT_PUBLIC_API_BASE_URL',
     requirement: { kind: 'required' },
     secret: false,
     generable: false,
     owner: { kind: 'application', application: 'storefront' },
     consumers: ['storefront'],
  +  addressOf: 'backend',
   },
  ```

  `null` is an answer and not an absence. A third party's address is `null` —
  `DATABASE_URL` and `REDIS_URL` are addresses, of a database and a cache, and neither is a
  member of the instance — and so is a value naming _several_ origins, `CORS_ALLOWED_ORIGINS`
  being the worked example: "the address of" is singular.

  **`@endora-commerce/contracts`** adds `addressVariablesFor(inputs, member)`, the one
  derivation both consumers take.

  **`@endora-commerce/cli`** replaces `backendAddressVariables(envExampleText)` with
  `addressVariables(declared, member)`, over a loaded declaration rather than over
  `.env.example` text. `backendAddressVariablesOf(dir)` keeps its name and its meaning and
  is now **async**, because it loads that directory's own declaration; there is a
  `storefrontAddressVariablesOf(dir)` beside it. `envExampleDeclarations` and
  `envExampleDeclarationsOf` are unchanged — the file is still the storefront's worked
  example of its _values_.

  ```diff
  -const names = backendAddressVariables(readFileSync('.env.example', 'utf8'));
  -const names = backendAddressVariablesOf(storefrontDir);
  +const names = await backendAddressVariablesOf(storefrontDir);
  ```

  `STOREFRONT_DOMAIN` also becomes a per-instance build input in
  `@endora-commerce/cli/lib/instance-build-inputs.js`, supplying the storefront build's
  `NEXT_PUBLIC_SITE_URL`. A pipeline rendered from that declaration gains one
  `--build-arg`; one that does not pass it builds a storefront whose canonicals, sitemap and
  `robots.txt` name `http://localhost:3000`.

  **`@endora-commerce/platform`** only annotates its own twenty-one declared inputs; no
  exported behaviour changes.

- fd7db00: Added the environment-input declaration, and the four-tier input resolution every
  scaffolding command now shares.

  **`@endora-commerce/contracts`** publishes the shape:
  `EnvironmentInput`, `EnvironmentInputSchema`, `EnvironmentInputsSchema`,
  `EnvironmentConsumer` / `ENVIRONMENT_CONSUMERS`, `EnvironmentRequirement`,
  `EnvironmentInputOwner`, `LocalizedSentence`, and three predicates —
  `isReadByAnyOf`, `scopeToMembers` and `isRequiredGiven`. One entry per environment
  variable a running platform reads: what it configures, in both shipped languages;
  whether it is `required`, `requiredWhen` another input holds a value, or `optional`
  with a sentence saying **what is lost**; whether it is a secret; whether a command
  may generate it; who owns it; and which trees read it.

  There is deliberately **no `default` field**. A declaration that could carry one
  would become another home for an invented value, which is what the provenance line
  below exists to make impossible.

  **`@endora-commerce/platform`** declares the 21 inputs the host and the platform
  read, on a new `./env` subpath:

  ```ts
  import { PLATFORM_ENVIRONMENT_INPUTS } from '@endora-commerce/platform/env';
  ```

  The subpath is host-internal — declared, resolvable by a CLI and by the host, and
  nameable by no module. A module declares its **own** inputs in its manifest, and the
  shape it does so in is `@endora-commerce/contracts`'.

  **`@endora-commerce/cli`** resolves those inputs, in one fixed order that is not
  configurable: an explicit `--<input>` flag, then a `.env` already placed in the
  target directory, then an interactive prompt, then a refusal. `endora new
storefront` takes it first, and writes the answers into the copy's own `.env`.

  Three properties are contract rather than behaviour:
  - **the tool invents no value.** Every run prints one provenance line —
    `[inputs] resolved: total=5 flags=5 env-file=0 prompted=0 generated=0 defaulted=0`
    — whose `defaulted` count is the _residue_ of the four tiers rather than a counter
    nothing increments, so a value from outside them shows up in the arithmetic
    instead of disappearing;
  - **no command blocks on a question nobody can answer.** A prompt is issued only
    when stdin and stdout are both TTYs, `--non-interactive` and `--dry-run` are
    absent and no CI marker is set. Otherwise a missing required input is exit `1`
    naming **every** missing input and the flag that supplies each, in one refusal;
  - **the one class of value a command may generate is a cryptographic secret** whose
    declaration marks it `generable` — written into the target's `.env` where the
    operator can read it, named in the provenance line, and printed nowhere.

  **If you call `runNewStorefront` directly**, it now resolves inputs and will refuse
  a run that has none and cannot ask:

  ```diff
  -await runNewStorefront({ dir: target, cwd });
  +await runNewStorefront({
  +  dir: target,
  +  cwd,
  +  inputs: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com', /* … */ },
  +});
  ```

  `MissingInputsError` is the refusal; `DeclarationLoadError` is a tree whose
  declaration could not be read, which is exit `2` rather than `1`. A target
  directory holding nothing but a `.env` is now accepted, which is what makes the
  second tier reachable for that command.

- e83be80: Added the `ledger.section.tabs` admin zone so invoice-ledger deliveries, routing, and vendor adapter connection screens share one Sales row.

  `@endora-commerce/contracts` gains the enum member and empty `LedgerSectionTabsZoneProps`. `invoice_ledger` contributes Deliveries and Routing and keeps a single sidebar entry. `infakt` drops its sidebar row and contributes the Infakt tab, hidden when the adapter is off.

- db1ec0b: A module can declare its demo data in `manifest.ts`, and the platform can run it.

  **`@endora-commerce/contracts`** gains one optional field on `ModuleManifest`,
  `demo`, plus `ModuleDemoManifest`, `ModuleDemoContext`, `DemoSeedResult`,
  `DemoResetResult`, `DemoEntityCount`, `DemoCredential`,
  `ModuleDemoManifestSchema` and `ModuleDemoDeclarationSchema`. Three states, and
  they are `docs`': an object — this module ships demo rows for its own tables;
  `false` — it has nothing to demonstrate, deliberately; **absent** — nobody has
  decided. Write the body behind a relative `await import()`, in `cliCommands`'
  shape, so a manifest every composing process loads does not pull a service graph
  with it:

  ```ts
  const demo: ModuleDemoManifest<ModuleContext> = {
    summary: 'A demo warehouse and stock for the seeded products.',
    seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
    reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
  };
  ```

  `defineModuleManifest` refuses a malformed one, and the two `demo.after` entries
  that cannot mean anything: the declaring module itself, and the same id twice.
  `after` is **advisory** — `permissions[].requires`' shape under D-175. It puts no
  module in `dependencies`, creates no lifecycle edge and changes no migration
  order, which is what lets `megamenu`'s demo order itself after `catalog`'s
  without declaring a dependency it does not have.

  **`@endora-commerce/platform`** gains `src/demo/` — the production guard
  (relocated from `backend/src/seeds/dev-seed-guard.ts`, which is now a re-export
  shim), the scope reasons, the plan, the runner and the report. It is reached by
  the host CLI and by nothing else; it is deliberately **not** on the
  `./composition` subpath, whose 27 symbols are D-160.14's ruled set.
  `sortComponentsTopologically` and `orderModulesByDependencies` join
  `stronglyConnectedComponents` on `lifecycle/services/dep-graph.ts`, so the demo
  order and the migration order are one walk rather than two that can disagree.

  Nothing else changes: no module declares demo data yet, `seed:dev` still runs,
  and no package gains a dependency.

- f7147b0: Removed the module licence tier: `ModuleLicenseTierSchema`, the `ModuleLicenseTier` type, the
  optional `license` field on a module manifest, and the required `license` field on
  `ModuleListItem`.

  It was reserved for edition-gating and was read by nothing. D-194 removed the tier
  meta-packages it existed for, and the field survived them: no gate consulted it, no route
  branched on it, the `/platform/modules` screen never rendered it, and `module:status` never
  printed a column for it. The only two references outside its own declaration were the
  orchestrator lines copying it from the manifest onto the list item — a value carried the
  length of the system so that nobody could look at it.

  **If you declared it in a manifest**, delete the line. A Zod object is non-strict, so a
  manifest that still declares one is not refused; the key is dropped on parse. There is no
  replacement, and there is no entitlement axis to move it to — the manifest's one presence
  declaration is `activation`, which is the operator's runtime control and was always a
  different question (Constitution XVII).

  ```diff
   export const manifest = defineModuleManifest({
     id: 'my_module',
     name: 'My Module',
     version: '1.0.0',
     dependencies: [],
  -  license: 'pro',
     activation: { settingCode: 'my_module.enabled', default: true },
   });
  ```

  **If you read `ModuleListItem.license`**, the field is gone from
  `GET /api/v1/admin/modules` and from `ModuleLifecycleOrchestrator.status()`. Nothing
  replaces it. A consumer that rendered it was rendering `null` for every module in this
  repository, no manifest having ever declared a tier.

  ```diff
  -import type { ModuleLicenseTier } from '@endora-commerce/contracts';
  -const tier: ModuleLicenseTier | null = item.license;
  ```

- 72013ed: Published `OrganizationTaxProfilePort`, and moved the error envelope's assembly into the
  platform.

  **`@endora-commerce/contracts` gains `OrganizationTaxProfilePort`.** It described the
  `organizationTaxProfilePort` container name and was declared by
  `@endora-commerce/mod-organizations/backend`, so a consumer resolving that port had to name
  the provider's own package to spell the type — which is the reach a port exists to remove,
  and which `@endora-commerce/platform` may not write at all. The declaration is unchanged
  member for member.

  ```diff
  -import type { OrganizationTaxProfilePort } from '@endora-commerce/mod-organizations/backend';
  +import type { OrganizationTaxProfilePort } from '@endora-commerce/contracts';

   const taxProfile = lazyPort<OrganizationTaxProfilePort>(ctx, 'organizationTaxProfilePort');
  ```

  **`@endora-commerce/mod-organizations/backend` no longer exports it**, and that is the
  breaking half. A re-export was written and withdrawn: a barrel re-exporting a name whose
  source is another package makes _"does this barrel carry an entity class by name"_ unknown
  rather than false, which D-168 may not be wrong about, and two spellings for one type is the
  shape this repository removes rather than adds. Change the specifier; the type is
  unchanged.

  **`@endora-commerce/platform/composition` gains `composeErrorEnvelopeOptions` and loses
  `createRequestLanguageResolver`.** The two callbacks a composition root passes to
  `registerErrorEnvelope` — the language ladder and the translation lookup — were assembled
  by each root itself, identically, in twenty lines apiece. They are one function now, and
  what a root supplies is only what a root knows: its own resolved error-code routing table
  and the two container names the callbacks read.

  ```diff
  -errorEnvelope: {
  -  errorTranslationTargets: routing.targets,
  -  resolvePreferredLanguage: createRequestLanguageResolver({
  -    adminPreferredLanguage: async (id) =>
  -      (await adminUserReadPort().findById(id))?.preferredLanguage ?? null,
  -  }),
  -  translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
  -    const t = await i18n().translate(moduleId, key, language, params);
  -    return t === `${moduleId}.${key}` ? originalMessage : t;
  -  },
  -},
  +errorEnvelope: composeErrorEnvelopeOptions({
  +  errorTranslationTargets: routing.targets,
  +  adminUserReadPort: () => identityPorts().adminUserReadPort,
  +  translate: () => cradle().adminI18nService,
  +}),
  ```

  `createRequestLanguageResolver` is off the barrel because no composition root constructs it
  any more; the ladder it builds is unchanged and is now built inside the assembly. If you
  called it directly, call `composeErrorEnvelopeOptions` instead. Both are on `./composition`,
  which is host-internal — no module may name it — so this affects a host and never a module.

- 5ba2e97: `request.actor` is declared by the platform, and `Actor` no longer carries the session.

  **`@endora-commerce/mod-auth` — breaking, two ways.**

  `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey` are no
  longer exported from `@endora-commerce/mod-auth/backend`. Import them from
  `@endora-commerce/contracts` instead:

  ```ts
  // before
  import type { Actor, ActorAdmin } from '@endora-commerce/mod-auth/backend';

  // after
  import type { Actor, ActorAdmin } from '@endora-commerce/contracts';
  ```

  And the `declare module 'fastify'` block that adds `actor` and `adminActor` to
  `FastifyRequest` is no longer in this package. If you imported from
  `@endora-commerce/mod-auth/backend` only to make `request.actor` compile — a
  type-only import whose real job was to put the ambient declaration in your
  program — the import to write now is a normal one you probably already have:

  ```ts
  // before — erased at build time, and load-bearing anyway
  import type { Actor } from '@endora-commerce/mod-auth/backend';

  // after — any import from this subpath carries the declaration
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **`ActorCustomer.session` and `ActorAdmin.session` are gone.** They were the
  `Session` ORM entity, written onto every authenticated request. If you read one,
  resolve `authSessionPort` or `authSessionReadPort` from the container: both are
  declared in `@endora-commerce/contracts` and both answer with `AuthSessionRecord`,
  a plain shape rather than an entity. Nothing else about the actor changed — the
  same four kinds, the same fields, resolved by the same `onRequest` hook.

  **`@endora-commerce/contracts`** gains `Actor` and its four members, at
  `./actor.js` and on the root barrel. It imports neither Fastify nor the ORM.

  **`@endora-commerce/platform`** gains the Fastify augmentation on its existing
  `./http` subpath — no new subpath and no new export, because the file declares
  the two request properties and exports no symbol. Any import from
  `@endora-commerce/platform/http` brings it.

- 0ab2044: Publish the object store, the availability port and the batched category and
  asset reads `product_feeds` reached through a composition root.

  `@endora-commerce/contracts` gains four exports and one method, all additive:
  - `ObjectStoragePort` (container name `objectStoragePort`, owner
    `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
    `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
    that keeps its own objects under its own locator prefix and creates no `Asset`
    row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
    rows, not a store, so it is not in the code union and a consumer has no arm to
    probe for.
  - `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
    answered. The registration carried no type argument, so there was no name to
    import.
  - `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
    live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
    `listProductIdsInSubtree`: that one is structural by contract and is a
    recursive CTE with no cycle guard.
  - `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
    live, public asset, and nothing for the rest. Absence is the answer rather
    than an exception, because only the owner can tell a stable URL from an
    expiring signed one.

  Breaking, `@endora-commerce/mod-product-feeds`:
  - `ProductFeedsBridge` is **removed**. The module resolves the four ports above
    itself; a composition contributes nothing to it beyond deployment values.
  - `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
    becomes `objectStorage: ObjectStoragePort`. Pass the container's
    `objectStoragePort` instead of an adapter registry.
  - `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
    `services/artefact-store.js`; `ArtefactStorageBackend` is now
    `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
    `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

  Breaking, `@endora-commerce/mod-catalog`:
  - `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
    unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
    on `catalogCategoryReadPort`. It is a category read and it now has one home.

### Patch Changes

- 089d2d4: Expose `remoteDocumentId` on the invoice-ledger delivery list item so invoice admin can show a historical vendor document id from a ledger read after the vendor adapter is switched off.

## 0.7.0

### Major Changes

- 0a08996: Removed `CustomerTotpEnrolmentPort` and `CustomerTotpEnrolmentResult`.

  The `totpEnrolmentService` port they described has no provider any more:
  `customer_accounts` no longer registers it, and the three routes that resolved it —
  `POST /api/v1/me/two-factor/{enable,confirm,disable}` — are gone. They could never
  succeed. `enable` wrote a 682-character `secret|<10 sha256 hashes>` string into
  `customer_accounts.two_factor_secret`, a `varchar(64)`, on which PostgreSQL raises
  `22001` rather than truncating, so the route answered 500 for every customer from the day
  it was written; `confirm` and `disable` refused with 400 and 409 for the same reason, an
  enrolment never being storable.

  **If you named either type**, there is no replacement port and no replacement HTTP path.
  Customer two-factor authentication is the `mfa` module's, over `/api/v1/account/mfa/*` —
  setup, confirm, disable, status and recovery codes — with the secret encrypted at rest,
  a replay guard and single-use recovery-code rows.

  ```diff
  -import type { CustomerTotpEnrolmentPort } from '@endora-commerce/contracts';
  -const totp = lazyPort<CustomerTotpEnrolmentPort>(ctx, 'totpEnrolmentService');
  -await totp.enable(customerAccountId);
  +// No port. Direct the caller at the `mfa` module's own self-service routes:
  +// POST /api/v1/account/mfa/setup, /confirm, /disable.
  ```

  `customer_accounts.two_factor_secret` and `admin_users.two_factor_secret` are dropped with
  them. `two_factor_confirmed_at` stays on both tables, so `CustomerAccountRecord`,
  `AdminUserRecord` and every response carrying `twoFactorEnabled` are unchanged.

- cebad9c: Admin zones are usable: a props contract at both ends, `match`, and a `./zones` renderer.

  **Breaking, `@endora-commerce/contracts`.** `AdminZoneNameSchema` no longer carries
  `order.detail.tabs`, `delivery_method.row.actions`, `payment_method.row.actions` or
  `product.editor.sidebar.after`. All four were rendered by no host and contributed to by
  no module — measured — and the new `check:admin-zones` reports a member nothing renders
  as `unrendered-zone` with no ledger to record it in. The three members that replace them
  are the three places a host actually mounts:

  ```diff
  -AdminZoneNameSchema.parse('product.editor.sidebar.after')
  +AdminZoneNameSchema.parse('product.editor.details.before')
  +AdminZoneNameSchema.parse('product.editor.pricing.before')
  +AdminZoneNameSchema.parse('product.editor.field.after')
  ```

  **If you named one of the four removed members**, there is no drop-in replacement: a zone
  name is a place, and each of the four described a place that either does not exist
  (`product.editor.sidebar.after` — the product editor has no right-hand sidebar) or has no
  mount yet. The batch that renders your place adds the member with the mount, in one merge
  request; that is the rule the removals establish.

  New in `@endora-commerce/contracts`:
  - `AdminZonePropsMap`, `AdminZoneProps<Z>` and the props interfaces
    `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`. The map is declared as
    `Record<AdminZoneName, object>`, so a zone member without a props type is a compile
    error in the package itself.
  - `match` on `AdminZoneContributionSchema` —
    `Record<string, string | readonly string[]>`, optional. The renderer includes a
    contribution when every key agrees with the mount's props, and it decides that
    **before** `React.lazy`, so a contributor that serves two of a zone's mounts is not
    downloaded on the rest.

  New in `@endora-commerce/admin-kit`:
  - A `./zones` subpath — `AdminContributionsProvider`, `useAdminZone(name, props)`,
    `<AdminZone name props />`, `ZoneErrorBoundary`, and the pure
    `selectZoneContributions` / `matchesZoneProps`. Presence, permission and `match` are
    filtered at enumeration, so an operator's activation flip needs no rebuild; each
    contribution gets its own error boundary and `Suspense`.
  - `zoneComponent(zone, load, options?)` and `AdminZoneComponent<Z>` on
    `./contributions` — the contributor's end of the props map, which is what constrains a
    module's default export to the zone it names.

  ```ts
  // host
  <AdminZone name="product.editor.field.after"
             props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />

  // contributor, in src/admin/index.ts
  zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
    weight: 10,
    requiredPermission: 'catalog:write',
  })
  ```

  `./zones` is a separate subpath from `./contributions` on purpose: the second is
  data-only and is what a module's declaration file imports, and one subpath would let a
  declaration file import a component.

- 4ed4b84: `cms-pages.ts` is removed. The barrel no longer exports `cmsPageSchema`, `CmsPage`,
  `cmsPagePathSchema`, `upsertCmsPageRequestSchema`, `UpsertCmsPageRequest` or
  `updateCmsPageRequestSchema`.

  **What those shapes were.** The pre-014 CMS page projection: a page addressed by a single
  globally unique `path`, with `title` and `body` as multilingual string maps. Feature 014
  replaced it with the page-builder page — addressed by a **per-channel** slug, with its content
  in a page-builder tree — and left the old shapes in place with one consumer each.

  **Why they go now.** Neither consumer worked. The storefront's `getCmsPage` fetched
  `GET /api/v1/cms/pages/{path}`, an endpoint no commit in this repository has ever registered, so
  every URL it served resolved to a 404 the caller could not tell from an empty CMS; and the admin
  screen typed against `CmsPage` posted `{ path, title, body }` to a route that parses
  `createCmsPageRequestSchema`, which requires `name`, `slug`, `salesChannelIds` and `languages`.
  The columns behind the shapes are still written and are still `@deprecated`: `path` is
  `` `${slug}-${id.slice(0, 8)}` ``, `title` is a copy of `name` or `meta.title`, and `body` is `''`
  for every page in every language. So an endpoint faithful to the old shape would address pages by
  a URL no operator chose and return an empty document.

  **What to use instead.** `cmsPageSummarySchema` / `CmsPageSummary` and `cmsPageDetailSchema` /
  `CmsPageDetail` for the admin surface, `createCmsPageRequestSchema` and `patchCmsPageRequestSchema`
  to write one, and `cmsResolvedPageSchema` / `CmsResolvedPage` for the storefront — the last is what
  `GET /api/v1/cms/pages/by-slug` returns, with the language already resolved server-side and
  embedded blocks and templates inlined.

  **Two names survive the file and are not part of the break.** `cmsPageStatusSchema` and
  `CmsPageStatus` were declared in _both_ files, identically
  (`'draft' | 'published' | 'archived'`), and `cms-pages.js`' star export won the collision — which
  is why `cms.ts` is re-exported by name rather than with a star. `cms.ts`' pair is now named on
  that list, so both keep resolving, with the same shape, from the same barrel.

- 11fc9f3: Renamed from `@b2b/contracts` to `@endora-commerce/contracts`. Nothing else about the
  package changed — same exports, same schemas, same `dist` layout.

  Update the dependency and every specifier:

  ```diff
  -"@b2b/contracts": "workspace:*"
  +"@endora-commerce/contracts": "workspace:*"
  ```

  ```diff
  -import { productTypeSchema } from '@b2b/contracts';
  -import { cmsContentEnvelopeSchema } from '@b2b/contracts/cms';
  +import { productTypeSchema } from '@endora-commerce/contracts';
  +import { cmsContentEnvelopeSchema } from '@endora-commerce/contracts/cms';
  ```

  `@endora-commerce` is the commerce platform's own npm scope; `@endora` is reserved for
  the company's other packages.

- f66ce9b: `@endora-commerce/contracts` now ships compiled JavaScript and declarations. `main`, `types` and
  every `exports` subpath resolve under `./dist`; `files` is `["dist"]`.

  **What changes for you.** The package no longer hands you TypeScript. Before, resolving
  `@endora-commerce/contracts` gave you `src/index.ts` and you compiled it yourself — which is why a
  consumer needed `transpilePackages`, a `ts-node`/`tsx` loader, or a bundler plugin to use
  it at all. Now it gives you `dist/index.js` with `dist/index.d.ts` beside it, so remove
  that configuration. Nothing about the exported symbols moved: `productTypeSchema`,
  `PERMISSION_CATALOGUE` and every other export keeps its name, its shape and its
  `z.infer` type aliases, which are emitted as written rather than expanded.

  **One specifier stops resolving.** A subpath written with a `.js` extension —

  ```ts
  import type { CmsFieldDescriptor } from '@endora-commerce/contracts/cms.js'; // was: src/cms.ts
  ```

  — went through the old `"./*": "./src/*.ts"` map, where `tsc` substituted the extension.
  The new map is `"./*": "./dist/*.js"`, under which the same specifier asks for
  `dist/cms.js.js` and fails at **runtime only** — a type-check cannot see it. Drop the
  extension:

  ```ts
  import type { CmsFieldDescriptor } from '@endora-commerce/contracts/cms';
  ```

  Every extensionless subpath is unaffected.

  **Every subpath carries a `types` condition.** Without one a consumer on
  `moduleResolution: "Bundler"` falls back to `main` for types while resolving `dist` for
  the runtime — it compiles, it runs, and the two answers come from different files.

- 2f04481: `CustomerAccountRecord.organizationId` is `string` — never `null` (D-178).

  `customer_accounts.organization_id` is `NOT NULL` in the database, an individual
  customer is backed by a single-member personal Organization, and there is no
  "no-organization" scoping path. Every branch a consumer wrote for the absent case
  is dead:

  ```diff
  -const org = account.organizationId === null ? null : await orgs.findById(account.organizationId);
  +const org = await orgs.findById(account.organizationId);
  ```

  Take care with the _other_ `organizationId: string | null` fields — a cart's, a
  `ProductAudience`'s — which stay nullable and mean "an anonymous visitor with no
  account". Only the account's own tenant became total.

  Two port changes travel with it.

  `CustomerAccountLifecycleWritePort.setOrganization` no longer accepts `null`, and
  `detachToPersonalOrganization` is the operation the `null` used to express:

  ```diff
  -await accounts.setOrganization(customerAccountId, null, { actorAdminUserId });
  +const personal = await personalOrganizations.provisionPersonalOrganization(customerAccountId);
  +await accounts.detachToPersonalOrganization(customerAccountId, personal.id, { actorAdminUserId });
  ```

  It records the same audit verb (`customer_account.organization_unassigned`) and
  runs the same authority and org-administrator-depletion guards; what changes is
  that the customer ends up in their own tenant rather than in none.

  `PersonalOrganizationPort` gains `provisionPersonalOrganization(customerAccountId)`
  — the account's **own** personal Organization, whatever it currently belongs to,
  provisioned if it has never existed, and no membership written. It is not
  `ensureForCustomerAccount`, which answers with the account's _current_
  Organization when it has one and would hand a company member their company back.

- ee02c59: The per-deployment declaration is `divergence`, and it is an object (D-205).

  `ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
  are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
  unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
  now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
  deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
  `divergence`.

  Before:

  ```ts
  import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

  export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
    { moduleId: 'blog', reason: '…' },
  ];
  ```

  After:

  ```ts
  import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

  export const divergence: DeploymentDivergenceDeclaration = {
    omittedModules: [{ moduleId: 'blog', reason: '…' }],
    decorationOrder: {},
    reasons: {},
  };
  ```

  The file is renamed with the export, because _reduced_ encodes a direction two
  of the three new contents do not have: `decorationOrder` declares the wrapping
  order for a registration more than one of a deployment's overlay modules
  decorates, and `reasons` carries one sentence per divergence the platform
  derives, keyed by the derived entry's own key. Both parse today and are read by
  nothing yet — they are supplied and checked by later phases of
  `specs/107-override-report-and-ladder/`.

  Three details a consumer will meet:
  - Every field defaults to empty, so a declaration that leaves one out means
    "none of these" — the reading an absent file already gets.
  - The object is **strict**: a fourth field, or a misspelled one, is refused
    rather than stripped, because a stripped field reads as "this deployment
    declares nothing" for a file whose author wrote a declaration.
  - `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
    changed in wording: it names `divergence.ts` and the `omittedModules` inside
    it. `ReducedDeploymentError` keeps its name — all three of its findings are
    about a module set that is genuinely reduced.

- f2fa9ea: Removed `pimcoreInboundEventStatusSchema` and its inferred type
  `PimcoreInboundEventStatus`.

  They described the status column of `pimcore_inbound_events`, the id-only push inbox
  that `pim_pimcore`'s complete-record delivery migration retired: that table became
  `pimcore_delivered_records`, whose statuses are `PimcoreDeliveredRecordStatus` — a
  different set (`applying`, `applied`, `withdrawn`, `retired_legacy`, `superseded`) with
  only `pending`, `failed` and `duplicate` in common. The schema had no reader left
  anywhere in this repository, in either its value or its type spelling:

  ```
  grep -rn --exclude-dir=node_modules --exclude-dir=dist \
    'pimcoreInboundEventStatusSchema\|PimcoreInboundEventStatus' .
  ```

  returned the two declarations and nothing else.

  There is no drop-in replacement to point at: the successor vocabulary is
  `PimcoreDeliveredRecordStatus`, declared beside the `PimcoreDeliveredRecord` entity in
  `@endora-commerce/mod-pim-pimcore` and published on none of that package's subpaths
  today, and its members are not interchangeable with these — re-map rather than
  re-point. Its neighbour `pimcoreInboundEventTypeSchema` is unaffected and still
  published: that one is the _action_ vocabulary and is still read here.

- 30a5475: Cut the unreachable half of the Pimcore run-outcome vocabulary.

  **Removed from `@endora-commerce/contracts`**, all breaking by removal and none of
  them consumed by anything in this repository:
  - `pimcoreImportFailureCodeSchema` loses `delivery_protocol_error`, `apply_failed`
    and `other_pim_enabled`; it is now `['worker_lost', 'internal_error',
'superseded']`. `PimcoreImportFailureCode` narrows with it.
  - `pimcoreImportSkipReasonSchema` and `PimcoreImportSkipReason` are gone
    entirely.
  - `pimcoreImportRunSchema` (and therefore `PimcoreImportRunDto` and
    `PimcoreImportRunDetailDto`) loses its `skipReason` field.

  Nothing wrote any of them. Each removed failure code was structurally unreachable
  rather than merely unimplemented: a delivery protocol fault is refused to the
  sender as an HTTP status before the Command that would create a run commits, so
  there is no run to stamp; an apply fault is isolated to its record and rolls the
  run up as `completed_with_issues` with no failure code at all (FR-105, FR-108),
  so a run-wide `apply_failed` contradicted the requirement above it; and
  `other_pim_enabled` is a skip reason, which by its own definition means the run
  never started and therefore cannot also be why a started run stopped. The skip
  reasons are the pull-era refusal path retired with FR-005, FR-007 and FR-008 —
  `PimcoreImportRun.skipReason` was written nowhere and `run.status` was never
  `'skipped'`.

  `'skipped'` **stays** in `pimcoreImportRunStatusSchema`: it costs nothing and is
  the natural status if a skip path is ever added. `internal_error` stays too — it
  is the notifier's defensive default over a nullable column, which is the one
  member of the three with a live reader.

  **A consumer reading a run DTO needs no change**: a narrowed response union is
  the safe direction, and the removed members were never emitted. A consumer that
  _wrote_ one of these codes into a `PimcoreImportFailureCode`-typed value has no
  replacement and should not have compiled — no such consumer exists.

  `@endora-commerce/mod-pim-pimcore` drops `PimcoreImportRun.skipReason`, the run
  DTO field, the two admin screens' skip-reason rendering and the nine now-dead
  `runs.failureCode.*` / `runs.skipReason.*` labels in both shipped languages. The
  `skip_reason` column is left on `pimcore_import_runs`, unwritten; no migration.

  See `specs/092-pimcore-pim-sync/research.md` §18.3 and `data-model.md` §7.

- aab5273: **Removed: the storefront theme catalogue.** `STOREFRONT_THEME_CODES`,
  `StorefrontThemeCodeSchema`, `StorefrontThemeCode`, `DEFAULT_STOREFRONT_THEME_CODE`
  and `isStorefrontThemeCode` no longer exist. Nothing on the wire changed:
  `PublicSalesChannelSchema.themeCode` is the same `z.string().nullable()`, and the
  create/update schemas still validate `^[a-z][a-z0-9_-]*$` — they never used the
  enum.

  **Why.** A storefront theme is a token set, and a token set can be published by
  anyone: an ordinary npm package with a CSS file and an `endora: { themes: [...] }`
  block. No set this package can compile is the whole set, so the list here was
  always the list of _our_ themes wearing the platform's name. The question moved
  from "is this one of our themes" to "does this storefront have this theme", and
  only a storefront instance can answer it — from the theme packages it has
  installed and the token blocks its own stylesheet declares.

  **What to do instead, per symbol.**
  - `isStorefrontThemeCode` — ask _your_ storefront, not this package. The
    reference instance generates a registry at build time and asks that:
    `storefront/lib/theme/instance-themes.ts`, over
    `storefront/lib/theme/themes.generated.ts`. Copy that shape; do not
    reintroduce a hand-written list, and in particular **do not** substitute an
    open predicate over the code regex — that makes every well-formed string a
    known theme, which deletes the unknown-code fallback and renders a typo'd
    channel unbranded.
  - `DEFAULT_STOREFRONT_THEME_CODE` — an instance constant now. It is your
    storefront's choice, not the platform's, and it must be a member of your own
    registry.
  - `StorefrontThemeCode` — `string`. The closed union is unrecoverable: no
    compiler can close a set a stranger extends after the compile. Replace the
    import with `string`, and replace the guarantee with a build check over your
    **emitted** stylesheet (`storefront/scripts/check-themes.mjs` is the reference
    one).
  - `StorefrontThemeCodeSchema` — no replacement. Validate the shape, which is
    what the sales-channel write schemas in this package already do; do not
    validate membership server-side, or the field stops working for exactly the
    deployments it exists for.
  - `STOREFRONT_THEME_CODES` — no replacement. An admin surface should render a
    free-text control: it is in a different deployment from the storefront, so any
    list it shows is advisory, and the storefront already answers a wrong value
    correctly.

  Background: `specs/102-storefront-theme-discovery/`, owner ruling D-199.
  `contracts/theme-package.md` is what a theme author reads.

### Minor Changes

- 73d0887: Publish `MfaEnrolmentStatePort`, and make `twoFactorEnabled` the live enrolment.

  `activeSubjectIds(subjectType: MfaSubjectType, subjectIds: readonly string[]):
Promise<string[]>` answers which of the given subjects hold an active second
  factor, on the `mfaEnrolmentStatePort` container. Batched rather than per row,
  because every caller is a list surface; the answer is plain ids, because
  `MfaEnrolment` carries the encrypted TOTP secret and no consumer has business
  holding it.

  New surface on `mfa` — nothing is removed there. A consumer resolves it with
  `lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort')` and declares the
  edge; both consumers in this repository declare it `degrades-without`, because
  `mfa` is deactivatable and a locked consumer binding it would make the operator's
  MFA switch a dead one.

  **Two mappers gained a required parameter, and that is a breaking change to a
  call, not to a wire shape.** `toAdminUserRecord(admin, twoFactorEnabled)` and
  `toCustomerAccountRecord(account, twoFactorEnabled)` no longer derive the field
  themselves; each package also exports a batching helper
  (`toAdminUserRecords` / `toCustomerAccountRecords`, plus
  `toOneCustomerAccountRecord`) that takes the reader and does one `mfa` read per
  response. The parameter has no default deliberately: it replaces a derivation
  that was silently wrong, and a default would let the next call site reintroduce
  it. Two service constructors take the reader as a new argument —
  `CustomerAccountReadService(emFactory, twoFactorEnrolments)` and
  `AdminUserReadService(emFactory, twoFactorEnrolments)`, with the same addition on
  `CustomerAccountMemberWriteService`, `CustomerAccountLifecycleWriteService` and
  `CustomerAccountAdminSearchService`.

  `twoFactorEnabled: boolean` is unchanged on every response and on both published
  records; what changed is where the value comes from. It was
  `Boolean(x.twoFactorConfirmedAt)` — a column with no writer on either identity
  table, whose last non-null writer was the superseded customer TOTP path deleted
  on 2026-08-25 — so the field was a provably constant `false`. `/admin-users`
  reported no second factor for an administrator who had enrolled an hour earlier,
  and `GET /api/v1/me/customer` told a buyer their own account was unprotected
  while it was not.

  `two_factor_confirmed_at` is now read by nothing on either table. Dropping the
  two columns is a separate migration and is not in this change.

- 93a300c: Publish the admin contribution declarations, and the package a module's admin
  layer is written against.

  **`@endora-commerce/contracts`** gains `admin-contributions.ts`, re-exported
  from the barrel. It is additive and breaks nothing:
  - `AdminRouteDeclarationSchema`, `AdminNavDeclarationSchema` and
    `AdminZoneContributionSchema` — the data half of what a module package's
    `./admin` layer exports, so a generator, a check or a server can enumerate a
    contribution without evaluating any of the module's UI code.
  - `AdminNavSectionNameSchema` — the closed set of sidebar sections a module may
    join, derived from the twelve `admin/src/components/AppShell.tsx` already
    declares. A module may not invent a section: an invented section is a heading
    nobody else can join.
  - `AdminZoneNameSchema` — the closed, hierarchical set of places in one
    module's screen where another module's contribution may appear. The four
    opening members are exactly the places measured module additions reached into
    by editing another module's file.
  - `PermissionRequirementSchema` — a permission code, or a set any one of which
    suffices; the shape `admin/src/lib/surface-visibility.ts` already defines,
    published so a module package declares it without reaching into the admin for
    the type.
  - `AdminContributions`, `AdminRouteDeclaration`, `AdminZoneContribution` and
    `AdminComponentFactory` — the interfaces that carry the dynamic-import
    factory, which is the only function-valued field a contribution has. It is a
    TypeScript type rather than a Zod schema deliberately: a function value
    carries nothing to validate beyond its arity, and a `z.function()` here would
    tell a reader it had been checked.

  **`@endora-commerce/admin-kit`** is new, private, and publishes one subpath:

  ```ts
  import {
    AdminNavSectionNameSchema,
    type AdminContributions,
  } from '@endora-commerce/admin-kit/contributions';
  ```

  Every export is the identical binding rather than a copy —
  `@endora-commerce/contracts` is a peer dependency, so a consumer resolves one
  copy and a schema compared across the seam is the same object.

  The four design-system subpaths the feature derives (`./ui`, `./components`,
  `./lib`, `./i18n`) are **not** in this release. The package's README records the
  measurement: a `tsc`-emitted façade re-exporting `admin/src` is TS6059 —
  verified on a two-file probe — and dropping `rootDir` to make it compile emits a
  second copy of every component into the kit's `dist`, which is a duplicated
  module-scope value in a tree full of React context. Publishing them takes the
  shape feature 080 used for the platform relocation: the implementations move
  into the package and `admin/src` keeps re-export shims at their old paths.

- b2552d5: Published the three data-fetching pickers, and the Organization picker's row shape.

  `@endora-commerce/admin-kit/components` gains `SalesChannelPicker`, `CmsBlockPicker`,
  `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti`,
  `OrganizationStatusBadge` and `useOrganizationsQuery`. Each of them was previously
  unreachable from a package: it lived in the admin application and imported another
  module's admin API client, so publishing it would have put module code in the kit.

  **A kit component gets its data by building the request itself**, from the published
  `apiClient` and the owner's schema in `@endora-commerce/contracts`. Five kit components
  already did that before this release (`CustomerPicker`, `AdminUserPicker`,
  `CustomerGroupPicker`, `CategorySelect`, `useCountriesQuery`); the rule was simply never
  written down. An HTTP path plus a schema out of a package the kit already depends on is
  not module knowledge — a module's _code_ is, and that is what these seven files no longer
  name.

  **If you render one of these,** nothing changes: every prop is the same, and
  `admin/src` keeps a re-export shim at each old path. **If you test one,** the seam moved:
  mock `@endora-commerce/admin-kit/lib`'s `apiClient`, not the module client.

  ```diff
  -vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
  -  organizationsPickerClient: { list: listSpy },
  -}));
  +vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  +  ...(await vi.importActual('@endora-commerce/admin-kit/lib')),
  +  apiClient: { get: getSpy, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  +}));
  ```

  `@endora-commerce/contracts` gains `organizationPickerListItemSchema` /
  `OrganizationPickerListItem` and `organizationPickerPageSchema` /
  `OrganizationPickerPage` — the picker's projection over
  `GET /api/v1/admin/organizations`, which now crosses a package boundary and so belongs
  here under Principle II. **There is no `OrganizationStatusPickerFilter`**: its four
  members are exactly `organizationStatusSchema`'s, measured, so the picker takes the
  published `OrganizationStatus` rather than acquiring a second name for one set.

  ```diff
  -import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
  +import type { OrganizationStatus } from '@endora-commerce/contracts';
  ```

  `admin/src/modules/organizations/api/organizations-picker-client.ts` is deleted; it
  existed only to serve this picker and nothing else imported it.

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

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

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

- f11ccdb: `customers`, `organizations` and `sales_channels` ship their admin screens, and two icon names
  join the allowlist.

  **Three packages' `./admin` subpath gains `routes` and `nav`, and two of them gain the subpath
  itself.** `@endora-commerce/mod-sales-channels/admin` already exported `contributions` with a
  `zones` array and nothing else; it now declares its screens there too. `@endora-commerce/mod-customers`
  and `@endora-commerce/mod-organizations` had no `./admin` subpath at all and now declare one.
  Eight routes and six sidebar entries between them, at the paths and codes the hand-written host
  registrations carried. The exported symbol is the same one every other module package uses —
  `contributions`, an `AdminContributions` object, and nothing else — so a consumer already
  reading `sales_channels`' zones needs no edit.
  - `@endora-commerce/mod-customers` — **new `./admin` subpath**, exporting `contributions`.
    `/customers` (the landing route), `/customers/online` and `/customers/:id`, all on
    `customers:read`, which is the code every `GET` behind them enforces; the detail screen keeps
    gating its block, unblock, impersonate, delete and restore controls on `customers:manage`
    inside itself. Two sidebar rows, in the `customers` section at weights 100 and 200. The detail
    screen is reached from the roster and has no row of its own. `CustomerDetail` renders the
    `customer.detail.after` zone, which is unchanged.
  - `@endora-commerce/mod-organizations` — **new `./admin` subpath**, exporting `contributions`.
    `/organizations` and `/organizations/:id`, both on the **any-of pair**
    `['customers:read', 'customers:manage']`, which is what
    `requireAdminAny(['customers:read', 'customers:manage'])` enforces on every organization
    endpoint. `AdminNavDeclaration.requiredPermission` and `AdminRouteDeclaration.requiredPermission`
    both take a `PermissionRequirement`, so the pair is declared rather than collapsed: naming only
    the read code hides the screen from a role holding just `customers:manage`. One sidebar row, in
    the `customers` section at weight 300. `OrganizationDetail` renders the
    `organization.detail.after` zone — four modules contribute there — and that is unchanged.
  - `@endora-commerce/mod-sales-channels` — `/sales-channels` and `/sales-channels/:code` on
    `sales_channels:read`, and `/sales-channels/new` on `sales_channels:write`. **That last one is a
    behaviour change for a consumer rendering these routes**: the create form is a screen whose only
    purpose is a write, `POST /api/v1/admin/sales-channels` enforces `sales_channels:write`, and the
    module's own `new-sales-channel` palette action already advertised that code. It was ungated
    while the route was the admin application's, so an operator holding only `sales_channels:read`
    could open a form whose save then refused; the roster's _+ New channel_ button is gated on the
    same code in this release, so the dead end is closed at both ends. `credentials` ships the
    identical split for `/credentials/new`. One sidebar row, in the `channels` section at weight 100.
    `SalesChannelEditPage` renders the `sales_channel.editor.after` zone, which is unchanged.

  **`@endora-commerce/contracts` — two members join `KnownIconNameSchema`: `Building2` and
  `Store`.** They are the glyphs the admin application drew for `/organizations` and
  `/sales-channels` by hand. A contribution names its icon rather than importing it, so a name that
  is not on the allowlist degrades to the fallback; adding them is what keeps the two rows looking
  as they did. Widening an enum is additive for a consumer validating against it and breaking for
  one exhaustively switching over `KnownIconName` — there is no such consumer in this repository.

  **`@endora-commerce/admin-kit` — `resolveIcon` answers for both new names.** `ICON_MAP` gains
  `Building2` and `Store`; the function's signature is unchanged and every existing name resolves
  exactly as before.

  **`@endora-commerce/mod-customers`, `@endora-commerce/mod-organizations` and
  `@endora-commerce/mod-sales-channels` ship new i18n keys, and `@endora-commerce/mod-i18n` loses
  six.** `nav.customers.label`, `nav.customersOnline.label`, `nav.organizations.label`,
  `nav.salesChannels.label` and the two new actions' `label`/`description` pairs are in the three
  modules' own `i18n/{en,pl}.json`; `appShell.nav.customers`, `appShell.nav.customersOnline`,
  `appShell.nav.organizations`, `appShell.nav.salesChannels`,
  `appShell.palette.sub.customerAccounts` and `appShell.palette.sub.storefrontChannels` are removed
  from the shared bundle in both shipped languages, nothing rendering them any more. **A consumer
  resolving one of those six keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **`organizations` and `sales_channels` declare a new palette action each.**
  `open-organizations` (`/organizations`, `customers:read`) and `open-sales-channels`
  (`/sales-channels`, `sales_channels:read`) replace hand-written rows in the admin's own palette
  table — copies the server was never asked about, which went on advertising the screens whatever
  the effective enabled-set said. One narrowing comes with `open-organizations`:
  `ModuleActionSchema.requiredPermission` is a single string, so it names `customers:read` and a
  role holding only `customers:manage` loses the palette entry while keeping the sidebar one.

- 21dac4f: `dictionaries`, `settings` and `credentials` ship their admin surfaces, and a module can
  publish a React component to another module for the first time.

  **New `./admin` subpath on four packages.** `@endora-commerce/mod-dictionaries`,
  `@endora-commerce/mod-settings` and `@endora-commerce/mod-credentials` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`,
  and nothing else. `@endora-commerce/mod-pwa` already exported one and it grows a `routes`
  entry. Nine routes and ten nav entries in total, all at the paths and codes the
  hand-written host registrations carried:
  - `mod-dictionaries` — `/dictionary`, `/dictionaries/audit` and `/admin/dictionaries/audit`,
    all `dictionary.write`; sidebar rows for `/dictionary` and `/admin/dictionaries/audit`.
  - `mod-settings` — `/settings` and `/settings/groups` on `settings:read`, `/settings/cache`
    on `settings:write`; a sidebar row for each.
  - `mod-credentials` — `/credentials` on `credentials:read` and `/credentials/new` on
    `credentials:write`; one sidebar row.
  - `mod-pwa` — `/settings/pwa` on `pwa:read`, beside the sidebar row it has declared since
    the previous wave. `PwaPage`, `PushAudienceRuleBuilder` and the `pwa` admin API client
    moved into this package from `mod-settings`' directory, where they had been since before
    either was a package.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **New `./admin-ui` subpath on `@endora-commerce/mod-credentials`, and it is a new kind of
  subpath.** It exports `ConfigurationPreviewModal` and its `ConfigurationPreviewModalProps` —
  a read-only view of one credential configuration with every secret masked, taking
  `{ open, configuration, onClose }`. This is the first package in the repository to publish a
  React component to another package rather than to the admin application, and three things
  about it are contract rather than convenience:
  - **It is not the kit.** A component whose rendering is generic over its data belongs in
    `@endora-commerce/admin-kit`; this one calls `useTranslation('credentials')`, so every
    string it shows is the owner's vocabulary and the kit refuses it.
  - **A consumer gates presence itself.** `credentials` carries an operator activation
    control, and a statically imported component is filtered by nothing — so the consumer
    wraps the render in `useSurfaceVisibility()({ module: 'credentials' })`. With the module
    switched off the caller must render nothing rather than a modal over an API that answers 503.
  - **`@endora-commerce/mod-credentials` becomes a peer dependency of
    `@endora-commerce/mod-settings`.** The reach survives into emitted JavaScript, so a
    consumer that bundles `mod-settings`' admin layer has to resolve the owner.

  **`@endora-commerce/admin-kit`:** `toAbsoluteAssetUrl` now trims its argument and returns a
  protocol-relative URL (`//cdn.example.com/x.png`) unchanged. It previously prefixed such a
  URL with the API origin, producing `https://api.example.com//cdn.example.com/x.png`, which
  loads nothing. Existing callers passing an absolute, `data:`, `blob:` or host-relative URL
  are unaffected. `resolveIcon` answers for two more names, `Languages` and `Eraser`.

  **`@endora-commerce/contracts`:** `KnownIconNameSchema` gains `'Languages'` and `'Eraser'`.
  Additive — no previously valid icon name is rejected.

  **`@endora-commerce/mod-i18n`:** ten `appShell.*` keys are **removed** from the shared
  bundle — `appShell.nav.{cache,credentials,dictionary,dictionaryAudit,settingGroups,settings}`
  and `appShell.palette.sub.{credentials,dictionary,dictionaryAudit,platformConfiguration}`.
  Their replacements are `nav.*.label` keys in the three modules' own bundles, resolved in each
  module's own namespace. **A consumer rendering one of those ten keys by hand will render the
  raw key**; there is no compatibility alias, because a key with one consumer in two bundles is
  the duplication this feature removes.

  **Both shipped languages, everywhere.** Every new key — the six `nav.*.label`s,
  `mod-settings`' `editor.credentialRef.preview` and `mod-dictionaries`' four
  `actions.openDictionary*` strings — ships in `en` and `pl`.

  **`mod-dictionaries` declares two command-palette actions**, `open-dictionary` and
  `open-dictionary-audit`, both on `dictionary.write`. They replace hand-written rows in the
  admin's own palette table, so what an operator sees is unchanged; what changes is that the
  server now filters them against the effective enabled-set, which the hand-written rows were
  never asked about.

  **Build.** `./admin` resolves at `dist/admin/index.js` and `./admin-ui` at
  `dist/admin-ui/index.js`, both emitted by each package's `tsconfig.ui.json`. A checkout that
  has not run `pnpm run build:packages` cannot resolve either. All four packages' `build` and
  `typecheck` scripts now run two `tsc` invocations, and `@endora-commerce/admin-kit`, `react`,
  `react-router-dom` and `lucide-react` become peer dependencies where a screen names them.

- 43e1968: `price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
  four icon names join the allowlist.

  **Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
  `contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
  each now declares its screens there too, at the paths and codes the hand-written host
  registrations carried. Sixteen routes and nine sidebar entries between them. The exported
  symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
  consumer already reading the zones needs no edit; what is new is that the same object now
  answers for the screens.
  - `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
    `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
    code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
    gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
    section at weight 100. The display-mode screen is reached from a button on the roster and the
    detail screen from the roster itself, so neither has a row of its own.
  - `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
    `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
    all. **No sidebar row**, which is the host table's own decision kept: quick order is the
    other way of getting lines into one order, reached from the `order.entry.tabs` strip this
    package already contributes into.
  - `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
    `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
    `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
    code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
    the order the host table had. Both of this module's admin surface directories moved: the
    warehouse screens and their client are here too, the sidebar having always attributed
    `/warehouses` to this module.
  - `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
    `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
    and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
    weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
    `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
    declarations already describe. Its admin client moved with the screens and is now
    `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
  `TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
  `KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
  compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
  from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
  them four rows would have had to degrade to names already on the allowlist.

  **`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
  of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

  **`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
  targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
  shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
  unchanged; what changes is that the advertisement is now resolved from the manifest against the
  effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
  hand-written row was a second copy of `open-inventory` and is simply gone.

  **`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
  four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
  `appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
  bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
  `nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
  `nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
  breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
  shared bundle gets nothing; resolve it in the owning module's namespace instead.

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- 727cbf5: A module can declare the Page Builder blocks it owns.

  `BlockDefinitionSchema` / `BlockDefinition` and `BlockCategorySchema` /
  `BlockCategory` are new, beside `cmsPageBuilderDescriptorSchema` in `cms.ts`.
  `ModuleManifestSchema` gains two optional arrays, `blocks` and `blockCategories`,
  beside `permissions`, `actions` and `errorCodes`:

  ```ts
  export const manifest = defineModuleManifest({
    id: 'catalog',
    // …
    blocks: [
      {
        name: 'catalog.ProductGrid', // persisted — see below
        labelKey: 'blocks.productGrid.label', // module-relative, never 'catalog.blocks.…'
        category: 'catalog',
        contexts: ['cms'],
        fields: { columns: { type: 'number' } },
        defaultProps: { columns: 4 },
        responsiveFields: ['columns'],
        previewIcon: 'LayoutGrid',
        weight: 10,
      },
    ],
    blockCategories: [
      { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms'], weight: 40 },
    ],
  });
  ```

  **`name` is persisted and permanent.** It is written into the `type` position of
  a Puck node in a `jsonb` column and is the only link between a stored node and
  the module that can render it. `blockNameRe` —
  `/^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/` — is exported as the one authored copy
  of that grammar, and `blockCategoryKeyRe` as the category key's. **There is no
  `ownerModule` field**: the owner is the segment before the `.`, so ownership is
  stated once rather than twice.

  **`defineModuleManifest` refuses three things**, each naming the module: a `name`
  whose owner segment is not the declaring module's own `id`; an empty `contexts`;
  and a `category` the same manifest does not declare in `blockCategories` for at
  least one of the block's contexts. A malformed name is refused before the owner
  comparison, because a name with no separator has no segment to compare. Nothing
  about a _second_ manifest is decided here — a duplicate name across two modules
  is composition's question, as it is for `errorCodes`.

  `cmsPageBuilderDescriptorSchema` is extended **additively**: each component entry
  may now carry `labelKey`, `descriptionKey`, `category`, `defaultProps`,
  `responsiveFields` and `weight`, and the descriptor may carry `categories`. All
  of them are optional and `name` deliberately keeps no grammar, so a consumer
  reading only the five fields that were there before is unaffected and the
  response is unchanged until a module declares a block.

  This is vocabulary only. No module declares a block yet, the registry is not
  populated from these declarations yet, and no stored content is touched — the
  migration that namespaces the 74 names already in the database is a later
  change, and until it lands nothing may write a namespaced name into a document.

- f66359f: Page Builder block names are namespaced. **Every renderer map is re-keyed.**

  `defaultPageBuilderConfig` and `defaultEmailBuilderConfig` stop being `Config` objects
  keyed by bare names (`Row`, `EmailHeading`) and become renderer maps keyed by the
  persisted, namespaced name (`cms.Row`, `transactional_emails.EmailHeading`). The
  `categories` block is **deleted** from both: a palette section is declared by the module
  whose blocks occupy it and is served, merged across the effectively present modules, by
  `GET /api/v1/admin/cms/page-builder/config`.

  ```diff
  -import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
  -const row = defaultPageBuilderConfig.components?.Row;
  -const layout = defaultPageBuilderConfig.categories?.layout;
  +import { defaultPageBuilderConfig, buildPaletteCategories } from '…';
  +const row = defaultPageBuilderConfig.components?.['cms.Row'];
  +// Sections come from the descriptor, merged per (key, context):
  +const layout = buildPaletteCategories(descriptor.components, descriptor.categories, 'cms', {
  +  title: (section) => t(section.ownerModule, section.titleKey),
  +  renderable: new Set(Object.keys(config.components ?? {})),
  +});
  ```

  `@endora-commerce/email-components` additionally re-keys `EMAIL_SAFE_COMPONENT_NAMES`,
  `EMAIL_COMPONENT_REQUIRED_VARIABLES` and `EMAIL_ORDER_LABELED_FIELDS`, and its 28 renderer
  `case` labels in `render-email-html` / `render-email-text`. `emailContexts` is gone: every
  entry now declares `contexts: ['email']`, and the newsletter palette is served by the
  `email → newsletter` admission rather than by a widened declaration.

  `@endora-commerce/page-builder-core` gains two things and breaks nothing:
  - `buildPaletteCategories(blocks, sections, context, options)` — the one implementation of
    "which sections does the palette for this context have, and what is in them". It applies
    `contextAdmits` to blocks **and** to sections, which is what keeps the newsletter palette
    sectioned rather than 28 entries in Puck's _Other_ drawer.
  - a `./migration` subpath exporting `FROZEN_BLOCK_RENAMES`, its inverse, the structural
    walk (`renameBlockNames`, `countBlockNames`, `mapBlockNames`) and the SQL builders the
    five rename migrations use. **It is not a runtime path** — the map is a frozen historical
    constant, not an alias table, and the difference is only real while nothing resolves
    through it.

  `@endora-commerce/contracts` extends `cmsPageBuilderDescriptorSchema.categories` additively
  with `ownerModule`: the module whose declaration won the merge, derived and never declared.

- 81726cf: `defineModuleManifest` refuses two more block declarations.

  **Rule 2 is now per context.** A block's `category` must be declared by the same
  manifest for **every** one of the block's `contexts`, not for at least one of
  them:

  ```ts
  // Accepted before this release, refused now:
  blocks: [{ name: 'catalog.ProductGrid', category: 'catalog', contexts: ['cms', 'email'], … }],
  blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms'] }],
  //                                                            ^ 'email' is missing

  // The fix is one word, because one entry may list every context it serves:
  blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms', 'email'] }],
  ```

  Under the old reading that manifest was legal and `catalog.ProductGrid` was
  uninsertable in the e-mail palette with **no error anywhere** — the section it
  names does not exist there, and a palette renders no section for a category
  nothing declares. The message names the first context that is missing.

  **Rule 4 is new**: no two of one manifest's `blockCategories` entries may cover
  the same `(key, context)` pair. A section is one record — `titleKey`, `weight`
  and `visible` resolve together, never field by field — so a manifest that states
  one twice has stated a presentation for nobody to reconcile. Two entries under
  one key are still legal when their `contexts` are disjoint, which is how one
  module declares `layout` in the CMS palette and `layout` in the e-mail one.

  Note that a duplicate `(key, context)` across **two** modules is the opposite: it
  is normal, expected and merges. `contracts/block-definition.md` §1.1 of
  `specs/096-page-builder-block-ownership/` is normative for that merge, and the
  doc blocks on `assertBlockRules` and `BlockCategorySchema` cite it rather than
  restating it.

  The bump is a minor rather than a major because the surface it tightens —
  `blocks` and `blockCategories` on `ModuleManifestSchema` — was added in the
  immediately preceding minor and has no consumer outside this repository yet. If
  you are reading this having already shipped a manifest that declares blocks,
  treat it as breaking and check your `contexts` lists.

- 1ba52e1: `sales_channels.theme_code` is read. It had not been, since 2026-04-30.

  **`@endora-commerce/mod-sales-channels`** registers `GET
/api/v1/storefront/sales-channel`, the public read `PublicSalesChannelSchema`
  has described since feature `005-sales-channels` and that no route implemented.
  It answers `{ data: PublicSalesChannel }` for the channel the resolver picked
  for the request — code, display name, language and currency scopes, `themeCode`,
  `logoUrl` — and drops `id`, `active`, `systemDefault` and `version`. The channel
  comes from `getResolvedChannel()`, so the endpoint re-resolves nothing and
  writes no query of its own. `logoUrl` is `null`, as it is on the admin detail
  shape; resolving an asset id to a URL is a separate change.

  **`@endora-commerce/contracts`** adds, to `sales-channels.ts`:
  - `PublicSalesChannelResponseSchema` / `PublicSalesChannelResponse` — the
    envelope of the route above.
  - `STOREFRONT_THEME_CODES`, `StorefrontThemeCodeSchema`, `StorefrontThemeCode`,
    `DEFAULT_STOREFRONT_THEME_CODE` and `isStorefrontThemeCode` — the storefront
    themes that exist (`industria`, `nordic`). The admin's channel form renders a
    list from this instead of a free-text box, because a free-text box could store
    a code nothing implements, which is what it had been doing.

  Nothing is removed and no existing shape changes. **`SalesChannelCreateBodySchema`
  and `SalesChannelEditBodySchema` still validate `themeCode` against the
  `^[a-z][a-z0-9_-]*$` regex and not against the new enum**, deliberately: a
  deployment that forks the storefront owns its own theme codes, and a backend that
  refused them would make the field unusable for exactly those deployments. A code
  this storefront does not implement renders in the default theme and is reported
  in the storefront's log; it is never guessed at and never silently rewritten.

- 86359f8: Publish `CmsBlockSeedPort` — the idempotent seeding seam for a predefined CMS
  block, on the `cmsBlockSeedPort` container, owned by `cms`.

  `ensureSeededBlock(block: CmsSeededBlock)` inserts the block where no block
  carries its code, then binds it to every sales channel it is not already bound
  to. Both halves are idempotent, so a re-run inserts nothing and binds nothing —
  which is what lets a module call it on every boot and lets an operator's edit of
  the seeded text survive every restart. `CmsSeededBlock` is published with it and
  carries `code`, `name`, `languages` and a `CmsContentEnvelope`: the block's text
  is the asking module's business, its storage is the CMS's, and the descriptor
  deliberately carries no channel list, block id or version.

  It exists because a module that ships a predefined block had no seam to ask for
  one and wrote `cms_blocks` and `cms_block_sales_channels` directly instead. Two
  did.

  Additive: no existing export changed shape.

  Calling it before the first request — which is where a boot seed runs — needs a
  presence decision first, `effectiveState.isPresent('cms')`, because the port is
  gated and a gate's "no" at route registration stops the next start rather than
  one request. The interface's own doc block states that, and states what an
  absent `cms` costs (nothing that the first boot after it returns does not
  recover).

- b0df9c1: A shop can tell crawlers its CMS pages exist, and an operator is told where a page will live.

  **`@endora-commerce/contracts`** gains four names, all additive:
  - `cmsPageIndexEntrySchema` / `CmsPageIndexEntry` and `cmsPageIndexResponseSchema` /
    `CmsPageIndexResponse` — `{ pages: [{ slug, updatedAt }] }`, the shape of
    `GET /api/v1/cms/pages/by-channel`. `slug` is the **per-channel** slug from
    `cms_page_sales_channels`, never `cms_pages.slug`: the address is per channel
    (Constitution XII) and the page row's own column is one value shared by all of them.
  - `cmsReservedSegmentsResponseSchema` / `CmsReservedSegmentsResponse` — the deployment's
    reserved first path segments, normalised.
  - `firstSlugSegment(slug)` — the first path segment of a CMS page slug, lowercased.
    `cmsSlugRe` permits `/`, so `pomoc/dostawa` is one page and its first segment is `pomoc`.
    It is published because **two** programs ask that question and must agree: the backend
    refusing a save, and the page editor warning while an operator types.
  - `ERROR_CODES.CMS_SLUG_RESERVED`.

  **`@endora-commerce/mod-cms`** gains two endpoints, a Setting and a refusal:

  ```
  GET /api/v1/cms/pages/by-channel            # storefront, channel-scoped, published-only
  GET /api/v1/admin/cms/pages/reserved-segments   # admin, `cms.read`
  ```

  The first is what a sitemap is built from. Until now the reference storefront advertised **no
  CMS URL to any crawler at all** — its `SITEMAP_DYNAMIC_ROUTES` named the route _pattern_, which
  is a declaration for the indexability check's reconciliation and says nothing about the rows
  behind it. Both routes are registered inside the module's existing `ctx.routes` seam, so both
  answer `503 MODULE_DISABLED` while `cms` is switched off and the storefront's sitemap then
  advertises no CMS URL and still serves.

  The Setting is `cms.reserved_slug_segments` — `valueType: 'json'`, `defaultValue: []`, in the
  existing `cms` group. A CMS page is served at the storefront root, `/{slug}`, so a page slugged
  `cart` saves, publishes and is never shown: a root catch-all is Next's lowest-priority match and
  the storefront's own `/cart` wins. **Nothing in this change creates that precedence**; what it
  removes is the silence. `CmsPageService.create` and `.patch` refuse a slug whose first segment
  the deployment reserves, with `409 CMS_SLUG_RESERVED` carrying `details.segment`, and the page
  editor reads the same value and warns inline while the operator types. A patch that writes no
  slug is not refused, so a page whose slug predates the reserved set stays editable.

  **The default is empty and that is not a gap.** The set is a fact about a _storefront's route
  table_; a headless backend serves storefronts it did not build, so a list shipped inside `cms`
  would be a derived fact about a consumer written into the owner. The reference storefront
  publishes its own as `RESERVED_TOP_LEVEL_SEGMENTS` in `storefront/app/reserved-segments.ts`,
  reconciled against its route tree in both directions by `check:storefront-indexability`; a
  deployment copies its value from there.

  Nothing is removed and no existing shape changes.

- a80e2bb: Publish `CreditLimitReadPort` — the membership read on `credit_limits`' surface,
  on the `creditLimitReadPort` container.

  `organizationsWithLimit(organizationIds: readonly string[]): Promise<string[]>`
  answers which of the given organisations hold a credit-limit row, in no
  particular order. The caller supplies an ancestor chain and decides which hit is
  nearest.

  New surface only — nothing is removed and no existing call changes. Consumers on
  an older version keep compiling; a consumer that wants the port resolves it with
  `lazyPort<CreditLimitReadPort>(ctx, 'creditLimitReadPort')` and declares the edge
  in its manifest.

  Two properties of the implementation are contract rather than detail, and both
  are stated on the interface. The read crosses organisation scope deliberately —
  the holder is by definition an ancestor outside the caller's tenant filter, so a
  provider that let `@OrgScoped` narrow it would answer the empty set for every
  descendant. And the answer is plain ids: a `CreditLimit` handed across this seam
  would be a managed entity the consumer could mutate and flush outside the
  transaction that loaded it.

  It replaces a raw `select "organization_id" from "credit_limits" where
"organization_id" in (…)` that `organizations` ran against this module's table
  (feature 077, D-87). That statement named no import specifier, so the boundary it
  crossed compiled and returned rows whatever state this module was in; the port is
  gated, so an absent owner now refuses instead of reporting an empty chain, which
  downstream reads as "no limit applies".

- d23bce2: `CustomFieldDefinitionReadPort` gains `getById(id)`, the committed-state read of a single
  custom-field definition:

  ```ts
  getById(id: string): Promise<CustomFieldDefinitionWithOptions | null>;
  ```

  Consumers resolving the port under the container name `customFieldDefinitionReadPort` need no
  change; the method is additive for them. It is the read `custom_fields`' **transactional apply
  seam** used to answer, which was wrong twice over: an apply seam exists to take the caller's
  `EntityManager`, and a read handed one is a write seam re-opened to serve a read; and the seam
  returned the owner's two managed ORM entities, typed at the call site as records. `getById`
  returns the published records.

  `minor` rather than `major` because the only party that has to change is the port's **provider**,
  and a port in this package has exactly one — the module that publishes it. If you implement
  `CustomFieldDefinitionReadPort` yourself, add the method: it takes a definition id and answers
  `null` when there is no such definition.

- 7e71642: Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

  **`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
  `DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
  the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
  deployment can use, each entry naming what was changed, the module that changed it, the module
  that owns what was changed, the rung of the customisation ladder it sits on, and the
  deployment's own sentence.

  Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
  for `registration`, `worker` and `omission`: the ladder ranks ways of changing what _core_ does,
  and those three are a module contributing its own surface or a declaration. `detail.depth` is
  `null` on every `decoration` in a committed report, because depth is a fact about a composition
  rather than about a tree — the runtime half of the report fills it in.

  **`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
  this repository's composition roots for the first time. Nothing about the field's type or its
  semantics changed — it is still _checked, never applied_ — but a composition that passes it now
  gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
  it: it names the deployment's own declaration file and the field, and suggests the order
  composition would apply, instead of telling its reader that there is no way to declare one.

  `ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
  each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
  assert on any of these four messages, they have moved.** `error.name` and the constructor
  arguments are unchanged.

  **`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
  a rule's subject there is a deployment, and a module package is not one.

- cb44af0: Publish two credential-verification ports, so a caller can ask "is this the
  right password for this subject" without holding the hash.

  New exports:
  - `AdminPasswordVerificationPort` — container name `adminPasswordVerificationPort`,
    owner `admin_users`. `verifyPassword(adminUserId, password): Promise<boolean>`.
  - `CustomerPasswordVerificationPort` — container name
    `customerPasswordVerificationPort`, owner `customer_accounts`.
    `verifyPassword(customerAccountId, password): Promise<boolean>`.

  Both answer `false` for an unknown id rather than throwing, and both are a
  lookup by id alone: whether the caller may act as that subject at all is the
  session layer's question, asked before this one.

  Additive — nothing existing changes shape. `AdminUserRecord` and
  `CustomerAccountRecord` still carry no `passwordHash`, and that is what these
  ports exist to keep true: the previous caller (a composition root) read the
  column off the ORM entity and ran the comparison itself.

  `CustomerPasswordVerificationPort` is deliberately neither
  `CustomerAuthPort.login` (which mints a session and runs the login side
  effects) nor `CustomerPasswordStatePort.passwordSetAt` (which takes no secret).

- eeb6a47: Four zone members for the category editor, the product editor and the sales-channel editor.

  `@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
  entry in `AdminZonePropsMap`:

  | Member                         | Props                                       | Rendered by                                           |
  | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
  | `category.editor.after`        | `CategoryEditorZoneProps { categoryId }`    | the category editor's form, after its save/cancel row |
  | `product.editor.pricing.after` | `ProductEditorZoneProps` (reused)           | the end of the product editor's Pricing tab           |
  | `product.editor.channels`      | `ProductEditorZoneProps` (reused)           | the body of the product editor's Channels tab         |
  | `sales_channel.editor.after`   | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form        |

  `CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
  `ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
  type is the shape the mount carries, and two places in one editor that both carry a product
  id carry the same shape.

  ```tsx
  import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

  // A tab whose body is a zone shows its button by counting the zone, never by
  // naming the module that fills it.
  const contributions = useAdminZone('product.editor.channels', { productId });
  // …
  <AdminZone name="product.editor.channels" props={{ productId }} />;
  ```

  `@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
  contributions — `category.editor.after` and `product.editor.pricing.after`, both at
  `price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

  **`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
  change an operator will see. A host cannot hand its own wording to a contributor it does not
  know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
  Two screens read different words than before: the category editor, which passed `catalog`'s
  `categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
  bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
  module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
  keys are now read by nothing; they are left in place because the same props are still passed
  by `organizations`' detail screen, whose conversion is a separate merge request.

  `@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
  `product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
  it. Its four calls are rebuilt from the published `apiClient` rather than moving
  `sales-channels-client`, so the package reaches nothing in the admin application.

  `@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
  `sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
  `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
  `isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
  the zone renderer applies presence and that code before the chunk is fetched — while the
  `inventory:write` half stays, because a contribution declares one code and the panel offers
  a read view and write actions behind two.

  No contribution declares a `match`: each names a member exactly one host mounts, and `match`
  narrows the mounts of one place.

- cd013dd: `CatalogGalleryPort` gains two batch reads, and `CatalogGalleryBatchItem` is
  exported beside it.

  `listForProducts(productIds)` answers the gallery of a **batch** of products —
  `{ productId, assetId, position }` per item, ordered by product and then by the
  operator's position — in one statement. `list(productId)` remains for the single
  product; it verifies the product exists and runs two further queries, so a page
  of 500 products costs 1500 round-trips through it against one here. It carries
  no labels and no timestamps deliberately: the callers that walk a page read
  neither, and fetching them costs a second statement per batch.

  `baseImageUrls(productIds)` answers `Map<string, string | null>` — the
  `base_image` url of each product, with **no** fallback to `thumbnail` or to the
  first gallery item. The map holds one entry per requested id, so a caller can
  index it without re-checking membership.

  Both treat an id that resolves to nothing as **data**: no row comes back and
  nothing throws, because a caller holding an id whose product has since been
  removed is asking about the batch it has. `baseImageUrls` therefore answers
  `null` for all three of "no `base_image` label", "no such product" and "the
  asset row behind the label is gone"; the three are not distinguished, as a
  caller that renders a placeholder reads one branch either way.

  Additive for a **caller** — an existing `list` / `create` / `delete` / `reorder`
  call is unchanged. An **implementer** of `CatalogGalleryPort` (a test double, an
  alternative provider) must add the two methods: D-97.3 forbids optional methods
  on a published port, since `lazyPort`'s proxy answers every property with a
  function and feature detection through it is impossible by construction.

- 3c8102e: `LineChart` joins the admin icon allowlist.

  `KnownIconNameSchema` gains `'LineChart'` and `resolveIcon` maps it to the lucide component
  of that name — the pair AGENTS.md's command-palette checklist requires in one merge request,
  because a name on the allowlist with no entry in the map renders the generic `Sparkles`
  fallback.

  It is added rather than substituted because a module's sidebar entry now declares its icon
  by name (`AdminNavDeclarationSchema.icon` is this same enum). `analytics`' entry was a
  direct `lucide-react` import in `admin/src/components/AppShell.tsx`; picking a name already
  on the list would have changed the glyph an operator sees, which is a visible regression
  bought for nothing.

- dc5c19d: Publish `ModuleLifecycleParticipant` — a third lifecycle export a module's
  `manifest.ts` may declare, beside `installHook` and `uninstallHook`, carried on
  `ModuleManifestExports.lifecycleParticipant`.

  An install hook fires for **its own** module. A participant fires for **every**
  module: `onModuleInstalled(event)` runs on any module's install, after that
  module's settings are reconciled and before its own install hook, and
  `onModuleHardUninstalled(event)` runs on any module's `uninstall --hard` and
  never on a soft one. It is for a module whose table is a projection of what the
  manifest set declares — the platform's own two are the translation bundles and
  the command-palette actions — and it exists because such a module could reach
  the lifecycle no other way: the orchestrator also serves the `module:*` CLI, and
  a platform command composes no container, so a port could not be resolved.

  `ModuleInstalledEvent` carries `{ moduleId, manifest, modulePath, em, log }` and
  `ModuleHardUninstalledEvent` carries `{ moduleId, manifest, em, log }` — with
  `manifest` nullable on the second, for a registration row whose module the
  instance no longer has. Write through the supplied `em`; a participant that
  forks its own commits beside the operation rather than inside it. Both methods
  are required, deliberately: feature detection through an optional method is what
  D-97.3 refuses on a published port, and a participant with nothing to do on one
  edge writes an empty body, which a reader can see.

  Additive: no existing export changed shape, and a `manifest.ts` that declares no
  participant is unaffected.

- c94c52d: `api_keys`, `webhooks` and `comparisons` ship their admin surfaces, on a new `./admin` subpath
  each; `KnownIconNameSchema` gains two members and the kit's icon map the glyphs behind them.

  Each of the three module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. The routes are unchanged — `/api-keys`,
  `/webhooks`, `/comparisons` and `/comparisons/:id` — and each package contributes a sidebar
  entry as well.

  Five things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of all
    three, and `react-router-dom` of `comparisons`.** They were backend-only packages before
    this. The kit is where every screen's design-system import now resolves, and React is peered
    rather than depended on so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.**
    `integrations:manage` for `/api-keys` and `/webhooks`, `comparisons:read` for both comparison
    routes — in each case the code the screen's own API enforces. A host `<Route>` was ungated,
    so a consumer who deep-links one of these paths for an operator without the code now gets the
    admin's not-found treatment where the screen used to render and its API answered 403.
  - **`KnownIconNameSchema` gains `Webhook` and `Scale`.** A nav entry and a palette action name
    their icon; both glyphs were `lucide-react` imports inside the admin's own `AppShell.tsx`
    until this change, so keeping the sidebar looking the same meant adding the names rather than
    substituting two already on the allowlist. `@endora-commerce/admin-kit`'s `resolveIcon` maps
    both. Widening a `z.enum` is additive for a producer and narrowing for a consumer that
    exhaustively switches on `KnownIconName`; nothing in this repository does.
  - **Each of the three declares its first command-palette action** — `open-api-keys`,
    `open-webhooks` and `open-comparisons` — with both labels in the package's own `i18n/` bundle.
    A consumer resolving palette entries from the manifests will see one more per module.

  Nothing is removed and no existing export changes shape, so a consumer of any of the three
  `./backend`, `./migrations` or root subpaths is unaffected.

- 4013a8b: `promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
  surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
  icon map the glyph behind it.

  Each of the four module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
  and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
  `/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
  ten `/product-feeds*` paths.

  Six things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
    dependencies of all four.** They were backend-only packages before this. The kit is where
    every screen's design-system import now resolves, and React is peered rather than depended on
    so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
    for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
    `product_feeds:read` — in each case the code the screen's own API enforces on its entry
    handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
    operator without the code now gets the admin's not-found treatment where the screen used to
    render and its API answered 403. The write codes each of these modules also owns
    (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
    `product_feeds:write`) gate controls **inside** a screen and are unchanged.
  - **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
    `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
    `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
    name rather than substituting one already on the allowlist.
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
    producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
    in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
    `Rss` are already on the list, each added by an earlier palette action of that same module.
  - **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
    `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
    `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
    own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
    `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
    deliberate, because the only place two modules could share it is the admin kit and the kit
    holds no module knowledge.
  - **`product_feeds`' download anchors now read the API origin from
    `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
    directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
    and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
    variable is set the two are identical, so this is a repair to the unset case and not a change
    to any configured one.

  Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
  own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
  `nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
  key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
  breadcrumb trails the admin holds for the payment-gateway settings screens.

  Nothing is removed and no existing export changes shape, so a consumer of any of the four
  `./backend`, `./migrations`, `./ports` or root subpaths is unaffected.

- fc34995: `pwa` ships an admin surface that is a sidebar entry and nothing else.

  `@endora-commerce/mod-pwa/admin` is a new subpath exporting `contributions` — an
  `AdminContributions` object with **one `nav` entry and no `routes`**. That combination is
  legal and was, until now, unexercised: the type's own documentation says _"a module shipping
  only a nav entry pointing at a host route is legal"_, and every conversion before this one
  moved a route. The entry advertises `/settings/pwa`, labelled `nav.pwa.label` in this
  package's own `i18n/{en,pl}.json` rather than in the shared bundle, in section `system` at
  weight 1400, gated on `pwa:read`.

  Two things a consumer has to know:
  - **The screen at that path is not in this package.** `PwaPage` lives in the admin
    application, under a directory `settings` owns, so the route is still declared by the host.
    A consumer that renders the registry's nav without the admin's own route table will show an
    entry pointing at a path it does not serve. That resolves when `settings` ships its own
    admin layer.
  - **`Smartphone` joins the icon allowlist.** `KnownIconNameSchema` gains the name and the
    kit's `resolveIcon` maps it to the lucide component of that name — the pair AGENTS.md's
    command-palette checklist requires in one merge request, because a name on the allowlist
    with no entry in the map renders the generic `Sparkles` fallback. It is added rather than
    substituted so the sidebar keeps the glyph it already drew.

- 1050b9a: Publish `ModuleCliCommand` — a fourth export a module's `manifest.ts` may
  declare, beside `installHook`, `uninstallHook` and `lifecycleParticipant`,
  carried on `ModuleManifestExports.cliCommands`.

  A module's operator command is now a **declaration the host runs**, never a
  script that bootstraps the host. That is one-to-one with Magento 2, where a
  module ships a command class plus a declaration under `CommandListInterface` and
  `bin/magento` bootstraps the application and constructs the command with its
  dependencies injected. It is what a packaged module needs: a file under
  `node_modules` can name no specifier that resolves to the instance's
  composition root, so a package could otherwise ship no operator command at all.

  ```ts
  // <module>/manifest.ts
  export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
    {
      name: 'reindex',
      summary: "Rebuild every sales channel's index.",
      help: 'usage: search reindex',
      run: async (context) => (await import('./cli/reindex.js')).reindex(context),
    },
  ];
  ```

  `ModuleCliCommandContext<Ctx>` carries `{ ctx, argv, out, err }`. `ctx` is the
  module's own `ModuleContext`, generic for the same reason `EntityManager` is
  generic on the lifecycle hooks — this package does not import kernel types — and
  a handler resolves from it exactly as `backend.ts` does. `out` and `err` are
  injected rather than reached for, so a command is drivable from a test without
  capturing the process's streams. `run` returns the exit code; it is required to
  return one, because a command that means "1" and returns nothing is
  indistinguishable from one that succeeded.

  `name` must match `MODULE_CLI_COMMAND_NAME_RE` (lowercase, hyphen-separated),
  which is also exported: a command is addressed as `<module id> <command name>`,
  so a name the grammar cannot express is unreachable and the host refuses it
  rather than advertising it. `help` is an optional **data** property, answered by
  the host before it composes — a tool has to be able to say what it does before
  it can do it, and one of the shipped commands has that as a ruled condition
  rather than a nicety. An optional data property is outside what D-97.3 refuses,
  which is about optional **methods** on a published port.

  The field is spelled `cliCommands`, not `commands`, so it cannot be read as a
  Command Bus Command: `commands/` is already a module's directory of audited
  domain writes. A CLI command that performs one runs it, resolved from `ctx`.

  Additive: no existing export changed shape, `ModuleManifestExports` gained a
  third optional generic parameter defaulting to `unknown`, and a `manifest.ts`
  that declares no command is unaffected.

- 32cc6e4: A module can declare where its documentation lives, and the tooling can find it.

  `@endora-commerce/contracts` gains `ModuleDocsManifestSchema`,
  `ModuleDocsDeclarationSchema` and an optional `docs` field on `ModuleManifestSchema`.
  Its shape is `i18n`'s and it is located the same way — a directory at the **package
  root**, in the package's `files` list, with **no `exports` subpath**, found by joining
  `docs.dir` to `dirname(manifestPath)`. The anchor is the platform's, so nothing in a
  module names a package, a repository root or a build directory in order to find its own
  pages.

  ```ts
  export const manifest = defineModuleManifest({
    id: 'inpost',
    i18n: { bundlesDir: 'i18n' },
    docs: { dir: 'docs' }, // ships pages
    // docs: false,          // ships none, deliberately
  });
  ```

  **`false` and absent are not the same state**, and consumers must not collapse them:
  absent is a module nobody has decided about, `false` is a decision. A universal
  obligation over a population where some members legitimately owe nothing is repaired by
  empty files whose only effect is to make a check pass, which is why the decision has a
  spelling of its own.

  `@endora-commerce/cli` gains `lib/module-docs.js`: `resolveDocsLayout` (the Docusaurus
  site, from the workspace member declaring a configuration), `collectDocPages`,
  `parseFrontMatter`, `attributeDocs` and `moduleOfSlug`. It is the one derivation behind
  both the generated documentation navigation and the check that refuses its population
  defects — a second derivation of one population is two answers waiting to disagree, which
  is the state it replaces: three hand-maintained lists described the modules this platform
  composes and all three disagreed with it and with each other.

  No existing symbol changed, and a manifest that declares no `docs` is unaffected.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 9ce0b40: Publish `ModuleRecentActivity` — a fifth export a module's `manifest.ts` may
  declare, beside `installHook`, `uninstallHook`, `lifecycleParticipant` and
  `cliCommands`, carried on `ModuleManifestExports.recentActivity`.

  A module **declares** that its activity is eligible for the admin home
  dashboard's Recent Activity card; the operator **decides** whether it appears,
  and the default is that it does. That is Constitution XVII's two-axis shape
  applied to a narrower object: a module author cannot put entries on somebody's
  home screen by fiat, and an operator cannot be surprised by a card they did not
  configure.

  ```ts
  // <module>/manifest.ts
  export const recentActivity = defineModuleRecentActivity({
    entries: [{ action: 'product.create', icon: 'Plus', labelKey: 'activity.verb.product.create' }],
  });
  ```

  `action` is the `audit_log_entries.action` token, matched against the exported
  `auditActionRe`. `icon` comes from the existing `KnownIconNameSchema`, so the
  Admin SPA maps it through the one icon map it already has and a package cannot
  name a component the app does not bundle. `labelKey` is **relative to the
  declaring module's i18n namespace**, exactly as a command-palette action's
  `labelKey` is, which is what lets a third-party package's verb render in the
  operator's language from the package's own bundle.

  The operator's half needs no declaration and takes none. Three new functions
  derive it:
  - `recentActivityVisibilitySettingCode(moduleId)` → `<moduleId>.recent_activity_visible`,
    throwing `RecentActivitySettingCodeInvalid` for a module id that cannot carry
    a setting code (a platform-internal, underscore-prefixed one). Derived rather
    than declared because the ruling fixes the default, so there is nothing left
    for a declaration to carry — and a declared code would be one more place a
    module could disagree with the platform about its own name.
  - `settingsManifestWithRecentActivity(manifest, recentActivity)` merges that
    Setting into the module's own settings manifest, `hidden: true` and defaulting
    to `true`. One derivation, two callers — the boot reconcile and the lifecycle
    orchestrator's `install`, which is a package's only settings author.
  - `defineModuleRecentActivity` is the identity-with-validation helper, the twin
    of `defineModuleManifest`.

  `KnownIconNameSchema` gains six names — `Edit`, `Archive`, `Box`, `Truck`,
  `CircleDollarSign`, `Activity` — the icons the dashboard's renderings used while
  they were a hand-maintained table in the Admin SPA.

  Additive: no existing export changed shape, and a `manifest.ts` that declares no
  recent-activity eligibility is unaffected.

- 07b2715: `ModuleNonBindingDependencySchema.kind` gains a third member,
  `'refuses-without'` — a module declaring that a cross-module read has no
  fallback, without binding the owner's lifecycle.

  The two existing kinds cover "an inert push" (`contributes-to`) and "I keep
  working with less" (`degrades-without`). There was no spelling for "this
  operation stops", and the two arrays that carried that meaning —
  `dependencies` and `acknowledgedDependencies` — both bind: an operator may not
  switch the owner off while the dependent is present. A dependent that is itself
  `activation.nonDeactivatable` therefore turned the _owner's_ activation control
  into a control that does nothing when flipped.

  ```ts
  nonBindingDependencies: [
    {
      moduleId: 'payments',
      name: 'orderPlacementPaymentApplyPort',
      kind: 'refuses-without',
      whenAbsent: 'checkout cannot take an order, because no payment method is available',
      reason: 'The placement seam has no fallback; binding would leave payments.enabled inert.',
    },
  ];
  ```

  `whenAbsent` is **required** for the new kind and `defineModuleManifest` throws
  without it: the deactivation-consequence ledger classifies such an edge
  `fails-closed`, which is what an undeclared gated port already classifies as, so
  the sentence is the whole of what the declaration adds. It is what the operator's
  confirmation dialog renders in place of a translated default.

  Additive: `'contributes-to'` and `'degrades-without'` are unchanged, no existing
  field changed shape, and `defineModuleManifest` refuses nothing today that it
  accepted before. Consumers exhausting `ModuleNonBindingDependency['kind']` in a
  `switch` or a mapped type gain a case; a `Record<kind, …>` over it stops
  type-checking until the third key is added.

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

- c4703f9: `OrderReadPort` gains `salesChannelIdsForCustomer(customerAccountId)`, the distinct sales
  channels one customer has ordered on:

  ```ts
  salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]>;
  ```

  The ids come back already distinct, most recently ordered-on first, and a customer with no
  orders answers `[]`. Consumers resolving the port under the container name `orderReadPort`
  need no change; the method is additive for them.

  It is the read the admin customer-detail header used to answer with `em.find(Order, {
placedByCustomerAccountId }, { fields: ['salesChannelId'] })` from inside the `customers`
  module — a plain read of another module's table, so it becomes a **read-port method** and not
  an `EntityManager`-taking apply port: handing a read a transaction handle re-opens a write seam
  to serve it. It is deliberately not `OrderListPort.list` with a `placedByCustomerAccountId`,
  which is paginated: the channels that read yields are the channels on one page, and a detail
  header that silently narrowed with the page size would be a different fact under the same
  label.

  `minor` rather than `major` because the only party that has to change is the port's
  **provider**, and a port in this package has exactly one — the module that publishes it. If you
  implement `OrderReadPort` yourself, add the method: it takes a customer account id and answers
  the distinct channel ids of that customer's orders, newest first.

- 49164fb: `OrderRecord` gains `shippingAdapterData?: Record<string, unknown> | null`, and
  `orderReadPort` projects it.

  The adapter-specific shipping envelope captured at placement (feature 068). Opaque on the
  record on purpose: only the delivery method's own `ShippingAdapter` knows its shape, and
  the reader that needs it is that same adapter reading back what it wrote. It is published
  so a carrier module can read the order it is shipping over `OrderReadPort` instead of
  importing `orders`' entity.

  Additive: no existing field moves and no caller has to change.

- 284276b: `receivePaymentRequestSchema` and `operatorProviderDetailsSchema` are new, and they bound what an
  **operator** may write into `payments.provider_details`:

  ```ts
  export const operatorProviderDetailsSchema: z.ZodType<
    Record<string, string | number | boolean | null>
  >;
  export const receivePaymentRequestSchema: z.ZodType<ReceivePaymentRequest>;
  ```

  `receivePaymentRequestSchema` is `receivePaymentSchema` with `providerDetails` narrowed from
  `z.record(z.string(), z.unknown())` to that flat scalar map — at most 50 entries, keys up to 64
  characters, string values up to 1000. It is the body of `POST /api/v1/payments/receive`, whose
  `providerDetails` was persisted verbatim into a JSON column that
  `GET /api/v1/admin/orders/:id/payments` echoes back in full: any document, of any depth and any
  size, chosen by the caller rather than by the schema.

  A flat map rather than a named field set because the column has several authors — the key
  vocabulary belongs to whichever adapter wrote the row — so enumerating keys here would claim an
  ownership this route does not have. What it refuses is the part that makes an unbounded bag
  dangerous.

  `receivePaymentSchema` and `ReceivePayment` are **unchanged**. If you build a `ReceivePayment` in
  code — every gateway integration does, with its own nested provider shapes — nothing about your
  call changes. The bound applies to the HTTP body only, and `ReceivePaymentRequest` is assignable
  to `ReceivePayment`, so a handler typed on the latter needs no edit.

  `minor`: both exports are additive and no existing symbol changed shape.

- d59f846: `ERROR_CODES` gains `PAYMENT_NOT_DUE`, `PAYMENT_ORDER_CLOSED` and
  `PAYMENT_ADAPTER_UNAVAILABLE`, the three codes `@endora-commerce/mod-payments`
  declares for the buyer's payment-retry refusals.

  Additive: no existing member changes and no consumer breaks. A consumer that
  switches exhaustively over `ErrorCode` gains three members to handle.

- 566f233: Add PayPal payment gateway contracts (feature 086): config (incl. webhook URL for admin), method rules, storefront config, and inline create/capture response schemas.
- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- 28c7f22: `pimcoreImportFailureCodeSchema` gains a sixth member, `superseded`.

  A Pimcore full delivery is a complete snapshot, so when one arrives while another full
  delivery is still applying, the arriving one takes the connection's apply claim and the
  incumbent stops where it is (owner ruling, 2026-09-01). Until now that takeover was
  silent: the superseded run stayed `running` for ever, and nothing on the runs screen
  distinguished it from a run that was simply still going.

  `superseded` is the code that run now carries. It is the one member of the enum that is
  **not a fault** — the delivery did not break, the sender replaced it — so a consumer that
  maps failure codes onto an error presentation should give this one a neutral tone:

  ```ts
  const tone: Record<PimcoreImportFailureCode, 'danger' | 'neutral'> = {
    delivery_protocol_error: 'danger',
    apply_failed: 'danger',
    worker_lost: 'danger',
    internal_error: 'danger',
    other_pim_enabled: 'danger',
    superseded: 'neutral',
  };
  ```

  A `minor` rather than a `patch`, and which direction breaks is the point: a consumer
  _producing_ a `PimcoreImportFailureCode` is unaffected, while a consumer _exhausting_ one
  — a `Record<PimcoreImportFailureCode, …>`, or a `switch` with no `default` — stops
  compiling until it names the new member. That is the intended failure: rendering a code
  the operator cannot read is what this member exists to prevent.

  The value is also the i18n key suffix. `@endora-commerce/mod-pim-pimcore` ships
  `runs.failureCode.superseded` in `en` and `pl`; a consumer with a bundle of its own needs
  the same key.

- 31975ca: `KnownIconNameSchema` gains `'PlugZap'`, with the matching entry in the kit's
  `resolveIcon` map. A module declaring a sidebar entry or a palette action names its icon as a
  string rather than importing the component, so a glyph the allowlist does not carry cannot be
  declared at all.

  `@endora-commerce/contracts` also publishes the Pimcore connector's own surface — the
  `Pimcore*` DTOs, the delivered-record envelope, `PIM_PIMCORE_SETTING_CODES` and seventeen
  `PIM_PIMCORE_*` members of `ERROR_CODES` — and three catalogue shapes the connector's ports
  need.

  No existing export changes shape.

- e1465e0: These three packages stop being `"private": true` and can be published.

  They are the set a scaffolded storefront resolves (D-195), derived rather than chosen:
  `storefront/package.json` declares exactly these three `@endora-commerce/*` ranges, and their
  closure over `dependencies` and `peerDependencies` adds nothing.

  Each now declares `repository` — a consumer's path back to the code, and npm's prerequisite for
  provenance — and `publishConfig.access: "public"`, which is a property of the package rather than
  of the registry it happens to reach. **No `publishConfig.registry` in any of them**: the registry
  is CI configuration and the client's `.npmrc`, so moving from the private rehearsal to npmjs is
  one variable rather than three manifest edits.

  Nothing about the packages' own API changes in this release. What changes is that there is one:
  a consumer can install them by version instead of by tarball path.

  Two consequences worth knowing before the first `changeset version` run. `page-builder-core` and
  `cms-components` are in the `linked` group with `email-components` and `page-builder-admin`
  (D-108), and at `0.0.0` a `workspace:^` peer range is out of range after any bump — so those two
  will have their `version` fields advanced while staying private and unpublished. That is correct
  and needs no repair. And the private registry's version history is independent of npmjs': a
  version published privately is not thereby taken on the public registry, and
  `changeset publish` replays no history — it publishes the current version of each package or
  nothing.

- a47dcc8: Three additions, all for the same reason: a composition root may no longer be the place a
  module's rule lives.

  **`CustomerRollupScopePort`** (container name `customerRollupScopePort`, owner
  `customer_accounts`) — whether a customer login widens from single-org to its
  organization's subtree, and the widened id set when it does.

  ```ts
  const rollup = await customerRollupScopePort.resolveSubtreeIds(
    customerAccountId,
    organizationId,
    (id) => organizationTree.subtreeIds(id),
  );
  ```

  The traversal arrives as an argument rather than being resolved inside the owner: the caller
  already holds it, and `organizations` publishes no contract for it.

  **`SettingsManifestCollectionPort`** and **`SettingsManifestSource`** (container name
  `settingsManifestCollectionPort`, owner `settings`) — how a module registry becomes the
  boot-time reconcile's list of settings manifests: the settings module first, each module
  code once. The registry stays the caller's argument, because which modules a deployment
  ships is a composition-root input.

  **`FeedDeliveryError`** — moved here from `product_feeds`' delivery SPI, beside
  `feedDeliveryFailureReasonSchema`, the closed reason set it carries. It is re-exported from
  its old location, so no import breaks.

  It moved because a delivery adapter is a **contribution** and its author is not always the
  module: `DeliveryService` classifies a transport refusal with `instanceof FeedDeliveryError`,
  so a thrower that reached the class through a second copy of the module's sources would have
  had every declared refusal silently reclassified as a retryable `internal_error`. This
  package is resolved once, so the comparison holds.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

- 49164fb: `StartShipmentResult` lets an adapter name the carrier reference it just obtained.

  `{ kind: 'pending' }` and `{ kind: 'generated' }` both accept `externalReference?: string | null`
  and `providerDetails?: Record<string, unknown>`, and `ShipmentService.createShipment` applies
  them on the **open create transaction** — a forked EntityManager inside an adapter cannot see
  the uncommitted row, so an adapter that wrote there wrote nothing.

  `OrderCreatedContext` gains `shippingAdapterData`, `deliveryPhone` and `customerEmail`, all
  from the in-transaction order snapshot, for the same reason: an adapter must not re-fetch the
  order to validate a checkout that has not committed.

  `ShippingAdapter.shouldAutoCreateOnPaid?()` is new and optional: when it answers true,
  `shipments` opens a shipment on `payment.received.v1`. Absent or false for every built-in
  offline adapter, so nothing changes for an adapter that does not implement it.

  **Not a breaking change for an existing adapter**: a `{ kind: 'generated', trackingNumber }`
  result still deposits that tracking number, which is what `@endora-commerce/mod-dhl-parcel`'s
  two adapters return. `externalReference` wins where both are named.

- 49164fb: `shipments` publishes `shipmentReadPort`, and `@endora-commerce/contracts` gains
  `ShipmentReadPort` and `ShipmentRecord`.

  ```ts
  interface ShipmentReadPort {
    findById(id: string): Promise<ShipmentRecord | null>;
    findByExternalReference(reference: string): Promise<ShipmentRecord | null>;
  }
  ```

  For a carrier module, which asks about a shipment twice and could previously only do it
  by loading `shipments`' entity: when an inbound webhook names only the carrier's own id,
  and when an admin asks for the label of an attempt. `findByExternalReference` is not a
  duplicate of `findById` — a carrier that signs nothing and names only its own id has to be
  correlated, and until the first `receive_shipment` lands, `externalReference` is where the
  adapter put that id.

  Resolve it as `lazyPort<ShipmentReadPort>(ctx, 'shipmentReadPort')` with `shipments` in
  your manifest `dependencies`. Nothing is removed; `shipmentService` and `shipmentUsagePort`
  are unchanged.

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

- e3a6a02: Order and filter a product listing by the viewer's own price.

  `productListQuerySchema` accepts two further orderings — `price` (cheapest
  first) and `-price` — and two optional bounds, `minPrice` and `maxPrice`, on the
  viewer's own resolved unit price. A minimum above a maximum is refused by the
  schema rather than answered with an empty page. The sort union is exported on
  its own as `productListSortSchema` / `ProductListSort`, with an `isPriceSort`
  narrowing, so a consumer no longer has to spell the four members inline.

  The listing response gains `capabilities: { priceOrdering }`, which says whether
  this page may be ordered by price for this viewer at all — a non-public sales
  channel publishes no prices, and `pricing.unauthenticated_display_mode = none`
  hides them until login. A storefront should gate its price controls on that flag
  rather than guessing.

  `ListingPriceOrderPort` is published beside `ListingPricePort` on the
  `pricingService` container: the catalogue in resolved-unit-price order, one
  chunk at a time, for one viewer. Two new error codes,
  `PRICE_ORDERING_UNAVAILABLE` and `PRICE_RANGE_INVALID`.

  All additive: an existing request that omits the new fields behaves as it did,
  and no existing enum member or field changed shape.

- 184fa9f: Two detail-screen zone members, four contributors, and the end of two live component
  duplications.

  `@endora-commerce/contracts` adds two members to `AdminZoneNameSchema`, each with its entry
  in `AdminZonePropsMap`:

  | Member                      | Props                                            | Rendered by                                         |
  | --------------------------- | ------------------------------------------------ | --------------------------------------------------- |
  | `organization.detail.after` | `OrganizationDetailZoneProps { organizationId }` | the end of the organization detail screen, **once** |
  | `customer.detail.after`     | `CustomerDetailZoneProps { customerId }`         | the end of the customer detail screen, **once**     |

  `OrganizationDetailZoneProps` and `CustomerDetailZoneProps` are new exported interfaces. The
  second is not an alias of the first: the prop is named for the entity the mount carries, and
  the two members are two places.

  **One mount per screen is a rule, not a layout choice.** Neither member carries a prop that
  could tell two mounts apart, so a second mount of either renders every contribution twice
  and nothing in the renderer can distinguish them.

  `@endora-commerce/mod-quick-order` gains an `./admin` subpath — its first — with two zone
  contributions and `DefaultPreferencesPanel`, which moves into the package. The panel's two
  preference calls are rebuilt from the published `apiClient`; `quick-order-client.ts` stays in
  the admin application, where the on-behalf-of screen still uses it.

  ```tsx
  // Both contributions declare `orders:write`, which is the code every admin
  // route this module owns enforces. There is no `quick_order:*` permission.
  zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
    weight: 300,
    requiredPermission: 'orders:write',
  });
  ```

  `@endora-commerce/mod-carts` gains its first zone contribution and a new route,
  `GET /api/v1/admin/organizations/:id/cart-approval-policy`, gated on `customers:manage` and
  answering `cartApprovalPolicyResponseSchema` — the same code and the same shape as the
  `PATCH` that has been there since feature 027. `CartApprovalService` gains `getPolicyByAdmin`.
  The contribution reads its own initial state through that route instead of taking the
  `initialRequiresCartApproval` prop the old panel took, because a zone's props cannot carry a
  value only one of four contributors wants.

  That panel had been imported by nothing, and the copy it rendered was in no bundle under any
  spelling — `t('carts.policy.title')` under the `carts` namespace resolves to
  `bundle['carts']['carts.policy.title']`, which never existed. Ten `policy.*` keys are added to
  this package's own bundle in both shipped languages, and the capability reaches an operator
  for the first time.

  `@endora-commerce/mod-price-lists` and `@endora-commerce/mod-sales-channels` each gain a
  second contribution over a component they already ship, and each loses its duplicate:
  `DisplayModeOverrideRow` and `EntityChannelMembership` existed twice in the tree for the
  length of the previous release, because the organization detail screen still imported the
  `admin/src` copy. Both copies are gone and nothing imports them.

  **Operator-visible copy change.** The organization detail's pricing card is now
  `price_lists`' own: the screen used to pass `organizations.detail.pricingLabel` and
  `organizations.detail.pricingHint` into a control it does not own and wrap it in a card
  titled `organizations.detail.pricingCard`. A host cannot hand copy to a contributor it does
  not know, so the control renders `priceLists.displayMode.rowLabel` and its own hint, and all
  three host keys are removed from the `core` bundle in both languages. Two further `core` keys
  go with them — `priceLists.linked.displayModeLabel` and `priceLists.linked.displayModeHint`,
  which the previous release left unread.

  No contribution declares a `match`, and each says why in its own file: `match` narrows the
  mounts of one place, and each of these members has one host and one mount. Every zone test
  asserts it absent.

### Patch Changes

- 04cba90: Close D-129's sweep: the platform error-code block is 21 codes with a reason each, and a gate
  that says so.

  **`@endora-commerce/contracts`** — `errorCodeTokenRe`'s doc block said the envelope "falls back
  to `errors.<CODE>`" when a token key is missing. It does not, and it never did:
  `localizeErrorEnvelope` composes one key — `errors.<CODE>.<token>` when the raise carries a
  `details.code`, `errors.<CODE>` when it does not — asks for it once and never re-asks. The
  correction matters to anyone declaring `tokens`, because it decides whether a code whose every
  raise is tokened needs its base sentence at all. It does, but for the check rather than for the
  operator (D-190). No shape changes; this is the published `.d.ts` telling the truth.

  **`@endora-commerce/mod-i18n`** — the same 21 declarations, regrouped by the ground that put each
  one there, with the block's doc comment rewritten to read as the platform block's home rather
  than as what a migration left behind. Nothing a consumer resolves moves: the codes, their
  `tokens` and every `errors.*` key in the bundle are unchanged.

  D-129's sweep is now complete — 79 codes moved into 20 modules over seven merge requests, 21
  stayed. Each of the 21 is annotated with its D-121 tier and the sentence that argues it, and
  `_i18n`'s declarations are held equal to those annotations in both directions, with the
  annotations' own membership held against the frozen chain capture plus the re-homing and minting
  ledgers. A twenty-second code cannot reach the platform block by nobody deciding.

- c53fef3: **`WorkerLogger` is gone; the type is `PlatformLogger`.** One structured-logger shape had
  three exported names, and two of them were the same word.

  `@endora-commerce/platform/kernel` no longer exports `WorkerLogger`. The identical interface —
  `info(obj, msg)` / `warn(obj, msg)` / `error(obj, msg)` — is exported as `PlatformLogger`,
  from the file that documents and produces it. It is the type of `ModuleContext.log`, of
  `DefineModuleWorkerOptions.logger`, and of every `log` a module is handed or holds.

  ```ts
  // before
  import type { WorkerLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: WorkerLogger) {}
  }

  // after
  import type { PlatformLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: PlatformLogger) {}
  }
  ```

  The rename is the whole migration: the shape is byte-identical, so nothing but the imported
  name changes. A `type WorkerLogger = PlatformLogger` shim in your own code compiles, but it
  re-creates the second name this release exists to remove.

  Also removed: `ModuleLifecycleLogger` from `kernel/module-context.ts`, an alias of the same
  interface that no barrel published — a module could not name it, only meet it by hovering
  `ctx.log`. Nothing importable is lost.

  **Why it was a defect and not untidiness.** `@endora-commerce/contracts` exports a
  `ModuleLifecycleLogger` of its own, and it is a _different_ shape: the install/uninstall hook
  logger, `info(msg: string)`, one argument. The platform's alias claimed the same name for the
  two-argument shape. An author who read the published contracts package — the package whose job
  is to be the published shape — and wrote `ctx.log.info('…')` got `TS2554: Expected 2
arguments, but got 1`, with two names resolving and both of them ours.

  `@endora-commerce/contracts` keeps `ModuleLifecycleLogger` unchanged. Its name was the accurate
  one: it is the logger of `ModuleLifecycleContext` and of the two lifecycle-participant events,
  all called by the orchestrator, which tags the module id so the hook author writes plain
  messages. Its doc block now says what it is not.

- 13e12bd: `PimConnectorRegistryPort` names its container binding

  The interface carried no `Container name:` line, so nothing tied it to the
  `pimConnectorRegistryPort` registration `@endora-commerce/mod-pim-connector` makes. That
  name is the whole of the promise the port makes: `lazyPort<T>` is `new Proxy({} as T, …)`,
  so `T` is asserted and compared to nothing that is registered, and a consumer copying the
  owner's class registration instead would compile and receive the service with no
  `MODULE_DISABLED` gate on it. Documentation only — no type, no member and no runtime
  behaviour changes.

- 7f02d62: `CartReadPort`'s doc block no longer says the port has no consumer.

  No exported symbol changes. The block asserted that `orders`' basket read could
  not be served by this port and that the boundary question behind it was open;
  feature 080's T048 settles it by splitting the seam in two, so the sentence a
  consumer reads in their editor was describing a state of the tree that no longer
  exists. `orders`' storefront total preview is the consumer, named in the block.

  The transactional half — the basket read that belongs with the completion order
  placement performs — is `CartPlacementApplyPort`, and it is deliberately not in
  this package: both of its methods take a MikroORM `EntityManager`, which
  `packages/contracts` may not name because `admin` and `storefront` both compile
  it (FR-034). It lives on its owner's own `ports/` surface.

- 2c8635b: Fix UnoPim media downloads: a stored media path now resolves to `<baseUrl>/storage/<path>`, the address Laravel's public disk actually serves, instead of `<baseUrl>/media/<path>`, which answered 404 for every file. An absolute `http://` media address is also left as-is rather than being appended to the base URL.

  Allow local development instances to fetch UnoPim media over HTTP when the development-only environment override is enabled.

  Import UnoPim attribute and option labels per locale, split comma-separated multiselect values, and map boolean source values onto the auto-created yes/no options. `CatalogProductWritePort` now exposes `patchAttributeOption` so a later import can refresh option labels.

  The UnoPim import-run detail now includes the recorded per-record issues so the operator can see why a run finished with issues.

  Import now reads UnoPim 3 `GET /configurable-products` in addition to `GET /products`, and maps `super_attributes` / `variants` onto Endora configurable products. Previously only the simple-product list was walked, so configurable parents were created as simple products.
