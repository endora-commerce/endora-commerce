# @endora-commerce/demo-composition

## 0.105.0

### Minor Changes

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

### Patch Changes

- Updated dependencies [1ba6b26]
- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [fcab32c]
- Updated dependencies [8ee69de]
- Updated dependencies [8d4440f]
- Updated dependencies [34fe84f]
- Updated dependencies [e308af9]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [fd3f055]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/mod-admin-users@0.105.0
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/mod-admin-roles@0.105.0
  - @endora-commerce/mod-price-lists@0.105.0
  - @endora-commerce/mod-catalog@0.105.0
  - @endora-commerce/mod-crm@0.105.0
  - @endora-commerce/mod-inventory@0.105.0
  - @endora-commerce/mod-organizations@0.105.0
  - @endora-commerce/mod-customer-accounts@0.105.0
  - @endora-commerce/mod-custom-fields@0.105.0
  - @endora-commerce/mod-credit-limits@0.105.0
  - @endora-commerce/mod-megamenu@0.105.0

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
