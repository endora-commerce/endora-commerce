# @endora-commerce/demo-composition

## 0.104.0

### Minor Changes

- 22e2cea: The demo sales pipeline plans Events. The step `sales opportunities for the demo organisation`
  now writes eight Events on six of the eight open demo opportunities — site visits, calls and two
  all-day deadlines — so the CRM Calendar and an opportunity's Events tab have something to show
  on a freshly seeded shop.

  - They are dated from the day of the seed: seven in the coming two weeks and one five days back.
  - **None has a reminder.** A seeded demo writes no notification and sends no e-mail.
  - The closed opportunities have none: the Calendar shows active opportunities only.
  - An all-day demo Event is a whole UTC day (`timeZone: 'UTC'`); a timed one is planned in
    `Europe/Warsaw`, inside the working day.

  Nothing the package exports changes: the pipeline's declarations are not on its barrel.

  `pnpm run cli demo reset` removes the Events with their opportunities. An opportunity that was
  already seeded before this change is left exactly as it is, as every re-seed leaves it — it
  gains no Event; reset and seed again to get them.

- 11ae65b: The demo shop gains a sales pipeline. A new step, `sales opportunities for the demo
organisation`, creates twelve CRM opportunities for the demo organisation — two in each status of
  the default workflow (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) — assigned
  across the two demo sales representatives with one left unassigned, with status history dated
  over the three months before the seed, the `crm` module's demo tags, the demo buyer as contact
  person on four of them, six notes and internal messages, and references to a demo product and to
  a person. Eleven carry a value entered by hand and one is set to be calculated from its linked
  documents. None is linked to an order or a quote request: the demo shop has neither.

  `pnpm run cli demo seed` adds the pipeline to a shop that is already seeded and leaves an
  opportunity that is already there untouched; `pnpm run cli demo reset` removes exactly these
  twelve, by id. The step runs only when `crm`, `organizations`, `admin_users`,
  `customer_accounts` and `catalog` are all installed and switched on, and is reported as skipped
  otherwise. The rows are written directly rather than through CRM's commands, so a seeded
  opportunity's History tab is empty.

  **Run `demo reset` with CRM switched on.** While `crm` is off the step is skipped in both
  directions, the opportunities keep referencing the demo organisation, and the reset stops at
  `organizations` with a foreign-key refusal.

  Two peers are new: `@endora-commerce/mod-crm` (optional, like every module this package wires)
  and `@endora-commerce/contracts`, which an instance already installs for its modules.

### Patch Changes

- 2d39d97: A product attribute carries a new flag, **`isPriceRule`** — whether the attribute may be used as a
  price-building rule in a Price List. It is the pricing sibling of `isPromoRule` and travels the
  same way: `false` by default, set on create, hot-toggled through
  `PATCH /api/v1/admin/catalog/attributes/:key`, and shown as a column and a checkbox on the admin
  Attributes screen.

  - **`@endora-commerce/contracts`** — `createAttributeRequestSchema` and
    `updateAttributeRequestSchema` accept an optional `isPriceRule`;
    `adminAttributeResponseSchema` and `CatalogAttributeView` always carry it; `CatalogAttributeFlag`
    and `CatalogAdminAttributeFlag` gain `'isPriceRule'`, so
    `catalogAttributeReadPort.listByFlag('isPriceRule')` answers the attributes a price rule may name.
    **If you build a `CatalogAttributeView` yourself** — a test double of `CatalogAttributeReadPort`
    is the usual case — add `isPriceRule: false`; the field is required, which is why this is a
    minor in a `0.x` series.
  - **`@endora-commerce/mod-catalog`** — a migration adds `product_attributes.is_price_rule`
    (`boolean not null default false`), and `GET /api/v1/admin/catalog/attributes/by-flag` accepts
    `flag=isPriceRule`.
  - **`@endora-commerce/demo-composition`** — `createAttributeFixture` accepts `isPriceRule`.

  Nothing prices from the flag yet: a Price List's application rule still matches on sales channel,
  customer group, organization, category and currency only. This release records the flag and
  publishes it for the price-rule work to consume.

- Updated dependencies [dbf6778]
- Updated dependencies [44d35a6]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [eb04e42]
- Updated dependencies [ce0471f]
- Updated dependencies [bcd577c]
- Updated dependencies [32775d5]
- Updated dependencies [7af6470]
- Updated dependencies [fd640a0]
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/mod-admin-roles@0.104.0
  - @endora-commerce/mod-catalog@0.104.0
  - @endora-commerce/mod-megamenu@0.104.0
  - @endora-commerce/mod-crm@0.104.0
  - @endora-commerce/mod-custom-fields@0.104.0
  - @endora-commerce/mod-admin-users@0.104.0
  - @endora-commerce/mod-credit-limits@0.104.0
  - @endora-commerce/mod-customer-accounts@0.104.0
  - @endora-commerce/mod-inventory@0.104.0
  - @endora-commerce/mod-organizations@0.104.0
  - @endora-commerce/mod-price-lists@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- Updated dependencies [7f6a4ba]
  - @endora-commerce/mod-inventory@0.103.1
  - @endora-commerce/mod-admin-roles@0.103.1
  - @endora-commerce/mod-admin-users@0.103.1
  - @endora-commerce/mod-catalog@0.103.1
  - @endora-commerce/mod-credit-limits@0.103.1
  - @endora-commerce/mod-custom-fields@0.103.1
  - @endora-commerce/mod-customer-accounts@0.103.1
  - @endora-commerce/mod-megamenu@0.103.1
  - @endora-commerce/mod-organizations@0.103.1
  - @endora-commerce/mod-price-lists@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- 7f579d2: **A demo seed or reset that stops part-way no longer leaves the demo administrators without a
  role.** An administrator without a role is refused, and a demo run is not one transaction, so the
  pairing of the three demo accounts with their roles can no longer wait for a late step:
  - `demo seed` creates each demo administrator already holding its role. An account that an
    earlier, interrupted run left without a role is given it on the next `demo seed`; a role
    somebody chose for one of these accounts is never replaced.
  - The composition step "demo administrators take their roles" now runs first and only fills in a
    missing role. Its withdrawal no longer unassigns anything.
  - `demo reset` deletes the demo accounts with their role still on them, then the demo's own
    `sales_representative` role. The `platform_admin` role stays.

  `demo seed` now fails, naming the role, if a role a demo administrator needs does not exist,
  rather than creating the account without one.

  **Several processes can start at once on a database that does not hold the
  platform-administrator role yet.** Each process ensures the role at boot; the ones that lose the
  race now find the role the winner created instead of failing to start.

- Updated dependencies [08192f0]
- Updated dependencies [a609ce3]
- Updated dependencies [7f579d2]
- Updated dependencies [f052b7f]
- Updated dependencies [9eb7ed9]
- Updated dependencies [9eb7ed9]
- Updated dependencies [f2a2dca]
- Updated dependencies [11c0962]
  - @endora-commerce/mod-admin-roles@0.103.0
  - @endora-commerce/mod-admin-users@0.103.0
  - @endora-commerce/mod-organizations@0.103.0
  - @endora-commerce/mod-catalog@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/mod-credit-limits@0.103.0
  - @endora-commerce/mod-inventory@0.103.0
  - @endora-commerce/mod-custom-fields@0.103.0
  - @endora-commerce/mod-customer-accounts@0.103.0
  - @endora-commerce/mod-megamenu@0.103.0
  - @endora-commerce/mod-price-lists@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/mod-inventory@0.102.0
  - @endora-commerce/mod-catalog@0.102.0
  - @endora-commerce/mod-megamenu@0.102.0
  - @endora-commerce/mod-organizations@0.102.0
  - @endora-commerce/mod-price-lists@0.102.0
  - @endora-commerce/mod-admin-roles@0.102.0
  - @endora-commerce/mod-admin-users@0.102.0
  - @endora-commerce/mod-credit-limits@0.102.0
  - @endora-commerce/mod-custom-fields@0.102.0
  - @endora-commerce/mod-customer-accounts@0.102.0

## 0.101.1

### Patch Changes

- Updated dependencies [69a3717]
  - @endora-commerce/mod-admin-users@0.101.1
  - @endora-commerce/mod-catalog@0.101.1
  - @endora-commerce/mod-credit-limits@0.101.1
  - @endora-commerce/mod-customer-accounts@0.101.1
  - @endora-commerce/mod-custom-fields@0.101.1
  - @endora-commerce/mod-inventory@0.101.1
  - @endora-commerce/mod-megamenu@0.101.1
  - @endora-commerce/mod-organizations@0.101.1
  - @endora-commerce/mod-price-lists@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/mod-admin-roles@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [be758bb]
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [5749604]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/mod-admin-users@0.101.0
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-catalog@0.101.0
  - @endora-commerce/mod-admin-roles@0.101.0
  - @endora-commerce/mod-credit-limits@0.101.0
  - @endora-commerce/mod-custom-fields@0.101.0
  - @endora-commerce/mod-customer-accounts@0.101.0
  - @endora-commerce/mod-inventory@0.101.0
  - @endora-commerce/mod-megamenu@0.101.0
  - @endora-commerce/mod-organizations@0.101.0
  - @endora-commerce/mod-price-lists@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: `demo seed` on an instance scaffolded by the CLI now builds a working demo shop. Before, it created every module's own demo rows and nothing that joins them: `admin@demo.local` and both sales representatives had no admin role (`/admin/me` answered `permissions: []`, so the admin sidebar was empty), and the 203 demo products were sold on no sales channel, so the storefront listed none. The wiring — roles, channel and category bindings, the menu, prices, stock, the demo buyer, attributes, images, attachments and the credit limit — was a file in the platform repository's own host, which no instance had.

  It is now the new package `@endora-commerce/demo-composition`. The platform's operator CLI finds an installed package declaring `"endora": { "type": "demo-composition" }` when the instance's `cli.ts` passes no `demoComposition` loader, and runs it; with none installed, `demo seed` behaves as before and its notice now names the package to add. `endora install --demo` and the new `endora new instance --demo` add the package to the instance's module list and write no file into the tree.

  The demo adopts the instance's system-default sales channel as its retail channel and keeps that channel's code when the operator chose one (`DEFAULT_SALES_CHANNEL_CODE`); only the platform's fallback code, `default`, is renamed `pl_retail`, as before. It used to rename any code, which would have moved the demo off the channel a storefront is built against.

  `@endora-commerce/platform/demo` — the host-internal subpath no module may name — no longer exports `NO_DEMO_COMPOSITION_NOTICE` or the `DemoCompositionLookup` type; their only consumer outside the platform was the loader this change removes. `DemoCompositionInput` stays, as the argument `createDemoComposition` takes.

  To fix an existing instance: `pnpm add -w @endora-commerce/demo-composition` at the instance root (it is a pnpm workspace, so plain `pnpm add` refuses), then `pnpm run cli demo seed` again. The seed is idempotent, so the rows already there are joined rather than duplicated.

- Updated dependencies [54c7417]
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-admin-roles@0.100.2
  - @endora-commerce/mod-admin-users@0.100.2
  - @endora-commerce/mod-catalog@0.100.2
  - @endora-commerce/mod-credit-limits@0.100.2
  - @endora-commerce/mod-custom-fields@0.100.2
  - @endora-commerce/mod-customer-accounts@0.100.2
  - @endora-commerce/mod-megamenu@0.100.2
  - @endora-commerce/mod-organizations@0.100.2
  - @endora-commerce/mod-price-lists@0.100.2
  - @endora-commerce/mod-inventory@0.100.2
