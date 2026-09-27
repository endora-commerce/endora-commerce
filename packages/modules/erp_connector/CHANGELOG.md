# @endora-commerce/mod-erp-connector

## 0.11.3

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/platform@0.13.2

## 0.11.2

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
  - @endora-commerce/platform@0.13.1

## 0.11.1

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0

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

## 0.10.0

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

### Patch Changes

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/platform@0.11.1
