# @endora-commerce/mod-invoice-ledger

## 0.12.1

### Patch Changes

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
  - @endora-commerce/platform@0.13.1

## 0.12.0

### Minor Changes

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
  not this repository's to make.** Feature 134's wave 4 took that package out of this workspace
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

### Patch Changes

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

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.11.1

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.11.0

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

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.0

### Minor Changes

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

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
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

## 0.8.0

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

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.7.2

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
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.7.1

### Patch Changes

- 089d2d4: Expose `remoteDocumentId` on the invoice-ledger delivery list item so invoice admin can show a historical vendor document id from a ledger read after the vendor adapter is switched off.
- e83be80: Added the `ledger.section.tabs` admin zone so invoice-ledger deliveries, routing, and vendor adapter connection screens share one Sales row.

  `@endora-commerce/contracts` gains the enum member and empty `LedgerSectionTabsZoneProps`. `invoice_ledger` contributes Deliveries and Routing and keeps a single sidebar entry. `infakt` drops its sidebar row and contributes the Infakt tab, hidden when the adapter is off.

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

## 0.7.0

### Patch Changes

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
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
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
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
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
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
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
  - @endora-commerce/platform@0.7.0
