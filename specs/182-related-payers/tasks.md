---
description: "Task list for feature 182 — related payers"
---

# Tasks: Related payers

**Input**: `specs/182-related-payers/` — [spec.md](./spec.md) (RP-1 to RP-13), [plan.md](./plan.md),
[research.md](./research.md) (R-1 to R-13), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)
**Delivery**: **one merge request** (RP-6), branch `feat/182-related-payers`. Phases run in the plan's
delivery order; each phase is green (its targeted tests, `typecheck`, `lint`) before the next starts.
**Tests**: required (Principle III, NN). Every implementation task is preceded by the failing test task
that names it in *Makes green*. Module tests are **co-located** `*.test.ts` beside their subject under
`packages/modules/<id>/src/` (no `test/` directory in a module package); complete-suite tests go under
`backend/test/{contract,integration}/<module>/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — parallelisable: different files, no dependency on an unfinished task in the same phase.
- **[Story]** — `US1`…`US9`, or `—` for shared work. FR / SC ids in brackets after the description.
- `RP` = `packages/modules/related_payers`. `MIG(<id>, <slug>)` = scaffold with
  `pnpm --filter backend run migration:new -- --module <id> --name <slug>` — never pick a number.

---

## Phase 0 — Setup, contracts and the pricing gate

**Purpose**: the module composes, every shape exists as a Zod contract (Principle II), and the one
design assumption with an open technical question (research R-4) is proven before anything depends
on it.

- [x] T001 [—] Scaffold `RP/`: `package.json` (workspace package `@endora-commerce/mod-related-payers`,
  `files` incl. `i18n`, `docs`), `tsconfig.json`, `src/manifest.ts` (id `related_payers`, activation
  declared, default **off**, `i18n: { bundlesDir: 'i18n' }`, `docs: { dir: 'docs' }`),
  `src/backend/index.ts` (`registerModule` registering nothing yet), `i18n/en.json` + `i18n/pl.json`
  (flat, empty objects), `docs/related-payers.md` (front matter only), `src/test-support/index.ts`
  (`volatileTables: []`). Run `pnpm --filter backend run composer:generate`,
  `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`,
  `pnpm run build:packages`. [FR-001]
  *Done 2026-11-18.* The activation control needs a declared setting, so the manifest carries one,
  `related_payers.module_enabled` (default `false`; `related_payers.enabled` stays the per-channel
  capability switch of T017), and the bundles carry its group and label keys — not empty objects.
  `src/backend/index.ts` also exports `entities: []` (D-168, read by `test/entities.generated.ts`).
- [x] T002 [P] [—] Failing contract tests `packages/contracts/src/related-payers.test.ts`: request body
  bounds (`taxId`, `contactEmail`, `comment`); the **sender** request DTO has no `counterpartyOrganizationId`,
  `routing`, `operatorReason`; link schema (`state`, `addressScope` ↔ `billingAddressId` pairing,
  `commercialTerms` enum, window dates); the six setting enums/ranges; `AddPayerInput.source` regex
  `^[a-z0-9_.-]{1,64}$`; customer-facing link update schemas carry **no** `commercialTerms`.
  [FR-003, FR-011, FR-030, FR-041, FR-119]
- [x] T003 [P] [—] Failing contract tests in `packages/contracts/src/orders.test.ts`:
  `placeOrderRequestSchema` accepts optional `payerOrganizationId`; refuses it together with a
  non-empty `billingCompanyName` or `billingTaxId` with `details.code = "payer_billing_override_conflict"`;
  accepts the override alone (unchanged); order shapes carry `payer`; `OrderReturnContext` carries
  `payerOrganizationId`; `PaidOrderDetail` has no delivery phone, customer note or comments.
  [FR-062, FR-067, FR-071, FR-082]
- [x] T004 [P] [—] Failing contract tests in `packages/contracts/src/carts.test.ts`: cart `buyingFor`,
  `setCartBuyingForRequestSchema`, `cartRepricingSummarySchema` (per-line before/after/unpriced,
  promotions added/removed), `buyingForReset`. [FR-110, FR-113, FR-116]
- [x] T005 [—] Implement the contracts (makes T002–T004 green): `packages/contracts/src/related-payers.ts`
  (schemas, DTOs, `RelatedPayerPolicyPort`, `RelatedPayerWritePort`, settings codes), extend
  `orders.ts` (`payerOrganizationId`, payer block, `PaidOrderReadPort` + DTOs, return context),
  `carts.ts`, `catalog.ts` (`ProductAudience.pricingOrganizationId?`, doc comment: visibility never
  reads it), `errors.ts` (`RELATED_PAYER_NOT_USABLE`, `RELATED_PAYER_REQUEST_LIMIT`,
  `RELATED_PAYER_REQUEST_DECIDED`, `RELATED_PAYER_LINK_EXISTS`, `RELATED_PAYER_INVALID_PAIR`); export
  from the package index; `pnpm run build:packages`. Per contracts/ports.md §1–§5.
  *Done 2026-11-18, with two deviations.* (1) **The five error codes are not in `errors.ts` yet**:
  `check:error-translations` P7 refuses a declared code nothing raises and forbids ledgering it
  (`UNRAISED_ERROR_CODES` "may only shrink"), so each code lands — in `ERROR_CODES`, the manifest's
  `errorCodes`, both bundles and `MINTED_ERROR_CODES` (`backend/test/fixtures/error-code-routing/
  reference-ledgers.ts`), with `related_payers` on the roster of
  `test/unit/_i18n/error-code-migration-progress.test.ts` — in the task that first raises it
  (`LINK_EXISTS`, `INVALID_PAIR`: T018ff; `NOT_USABLE`: Phase 2; `REQUEST_LIMIT`, `REQUEST_DECIDED`:
  Phase 5). (2) **The port doc blocks do not carry the `Container name:` marker yet**:
  `check:port-shape` reds on a published name nothing registers, so each marker is added with its
  registration (`relatedPayerWritePort` Phase 1, `relatedPayerPolicyPort` Phase 2,
  `paidOrderReadPort` Phase 3). The new fields on `orderSchema.payer` and
  `cartFullPayloadSchema.buyingFor`/`buyingForReset` default to `null`, so the `orders` and `carts`
  serialisers answer `null` explicitly until their columns land; `OrderReturnContext.payerOrganizationId`
  is `null` in `order-return-context.ts` likewise.
- [x] T006 [—] **GATE — pricing spike (research R-4, "Verify in implementation").** On a scratch
  branch, never committed: make `catalog-query.service.ts`'s price walk and the price surface read
  price for Organization Y while visibility is evaluated for X (the `ProductAudience` split), and run
  `backend/test/integration/price_lists/price-surface-identity.test.ts` and a listing sorted by price
  with such a viewer. Record the result as a dated *Spike result* paragraph under R-4 in
  `specs/182-related-payers/research.md`, then delete the spike.
  **Decision point**: *separable* → Phase 4 proceeds as planned. *Not separable* → stop Phase 4 and
  return to `endora-commerce-architect` to amend R-4 before T060; Phases 1–3 continue unaffected.
  *Done 2026-11-18 — **separable**; see R-4 "Spike result". Open for T063: more consumers derive the
  priced organisation than T063 lists (catalog display mode and VAT rate in `routes.public.ts`,
  `product-link.service.ts`, search's suggestion enricher, cart upsells), and whether listing VAT
  rates follow the payer needs a decision before T060.*

**Checkpoint**: contracts built; module composes switched off; R-4 decided.

---

## Phase 1 — US1 + US8: links, operator surface, automation port (P1 / P2)

**Goal**: an operator links a payer on the buyer's card; an overlay links one through the port.
**Independent test**: quickstart §2; `backend/test/integration/related_payers/admin-links.test.ts`.

### Tests first

- [x] T007 [P] [US1] Failing unit test `RP/src/backend/services/link-usability.test.ts`: table over
  module/channel enabled, `state`, window (inclusive instants per RP-15, open ends), payer status
  `active`/blocked/pending/archived, personal payer, address scope `all`/`one`, address deleted,
  no billing address. [FR-012, FR-002]
- [x] T008 [P] [US1] Failing unit test `RP/src/backend/services/link-state.test.ts`: `active ⇄ inactive`,
  `→ revoked` terminal, reactivation refused after revoke; pair rules (X ≠ Y, both company, one
  non-revoked link per pair). [FR-010, FR-013]
- [x] T009 [P] [US1] Failing audit sentinel test `RP/src/backend/commands/link-commands.audit.test.ts`
  over `link.create`, `link.update`, `link.set_state`, `link.revoke` through the real `CommandBus` with a
  recording audit port and `expectNoAuditValues` (sentinels: payer name, tax id, address line, e-mail);
  asserts `changedFields` (incl. `commercialTerms`), actor kinds operator / automation + `source`; and
  `RELATED_PAYERS_AUDIT_KEYS` ⊇ every recorded key. [FR-100, FR-118, SC-006]
- [x] T010 [P] [US1] Failing manifest test `RP/src/manifest.test.ts`: activation default off; six
  settings with defaults and channel override; operator codes `related_payers:read`/`:manage`;
  organization permissions `related_payers.manage|approve|order_with_payer|view_paid_orders`, none
  member-default; palette action `open-payer-requests` → `/related-payers/requests` with
  `related_payers:read`; `dependencies` and `nonBindingDependencies` as research R-6.
  [FR-001, FR-003, FR-024, FR-090]
- [x] T011 [US1] Failing integration test `backend/test/integration/related_payers/admin-links.test.ts`:
  US1 scenarios 1–4; list `asBuyer` / `asPayer`; add existing; create new Organization (status
  `active`, channel bindings as the admin create form, link active) with the first-user invitation
  through the existing members-invite route; PATCH scope/window/terms/notify with `If-Match`;
  activate/deactivate/revoke; operator without `related_payers:manage` gets 403, without `:read` the
  panel's API 403; pair refusals 422; audit actor = admin user. [FR-020, FR-021, FR-022, FR-010, FR-011, FR-013, FR-119]
- [x] T012 [P] [US8] Failing integration test `backend/test/integration/related_payers/write-port.test.ts`
  with a test-only overlay module resolving `relatedPayerWritePort` via `lazyPort`: add (with scope,
  window, terms), repeat add idempotent `{ created: false }`, revoke, pair refusals, audit actor
  `automation` with `source`; module deactivated → `503 MODULE_DISABLED`, nothing written.
  [FR-030, FR-031, FR-032, SC-006]
- [x] T013 [P] [US1] Failing integration test `backend/test/integration/related_payers/cross-tenant-links.test.ts`:
  payer-side link reads (`listAsPayer`) constrained to `payer_organization_id`; a scoped admin without
  reach to X gets 404 on X's links indistinguishable from a missing Organization. [FR-020, Principle XI]
- [x] T014 [US1] Failing off-state test `backend/test/integration/related_payers/off-state.test.ts`
  (base case; later phases extend it): deactivated-while-platform-available ⇒ every module route
  `503`, port `503`, no palette action, no settings group, settings not editable, organization
  permissions absent from the role editor and existing grants preserved; reactivation restores links,
  settings and grants unchanged. [FR-001, FR-004, FR-091, SC-004]
- [x] T015 [P] [US1] Failing admin test `admin/test/modules/related_payers/PayersPanel.test.tsx`:
  panel renders in `organization.detail.after`, both lists, `ImmediateBadge` on the heading, no save
  participant registered, actions hidden without `related_payers:manage`, enum labels from
  `RP/src/admin/lib/labels.ts`, no hard-coded strings. [FR-020, FR-022, FR-101]

### Implementation

- [x] T016 [US1] `MIG(related_payers, links_and_requests)`: `related_payer_links` and
  `related_payer_requests` with every column, check constraint, partial unique index and index of
  data-model §1–§2; entities `RP/src/backend/entities/related-payer-link.entity.ts` and
  `related-payer-request.entity.ts`, both `@OrgScoped()`; add both tables to `volatileTables`;
  `composer:generate` (migrations registry). [FR-010, FR-011]
- [x] T017 [US1] Complete `RP/src/manifest.ts`: settings, `permissions` (with `requires:
  ['customers:manage']` on `:manage` for the create-organization path), `organizationPermissions`,
  `actions`, `dependencies` (`organizations`, `addresses`, `orders`, `settings`, `sales_channels`),
  `nonBindingDependencies` (`invoices`, `customer_notifications`, `admin_notifications`,
  `transactional_emails` — `degrades-without`, each with its `whenAbsent` sentence). Labels en + pl
  in `RP/i18n/*.json` (`adminRoles.permission.*`, palette keys, organization-permission labels and
  descriptions). Makes T010 green. [FR-003, FR-024, FR-090, FR-101]
- [x] T018 [US1] Services `RP/src/backend/services/link-usability.ts`, `link-service.ts`
  (`listAsBuyer`; `listAsPayer`/`findAsPayer` under `withSystemScope('related_payers: links naming us
  as payer', …)` constrained by `payer_organization_id`). Makes T007, T013 green. [FR-012]
- [x] T019 [US1] `RP/src/backend/services/link-cache.ts`: per-process cache by buyer Organization,
  60 s TTL, publish/drop on `b2b:related_payers:links-changed` after every link Command's commit,
  drop on `organization.status_changed.v1` via `ctx.subscribe` (research R-9); unit test
  `link-cache.test.ts` beside it first (drop on publish, drop on status change, TTL).
- [x] T020 [US1] Commands `RP/src/backend/commands/link-create.command.ts`, `link-update.command.ts`,
  `link-set-state.command.ts`, `link-revoke.command.ts`, audit-state helper
  `RP/src/backend/commands/audit-state.ts` exporting `RELATED_PAYERS_AUDIT_KEYS`; events
  `related_payers.link.created|changed|revoked.v1` (names-only). Makes T008, T009 green.
  [FR-013, FR-100, FR-118]
- [x] T021 [US8] `RP/src/backend/services/related-payer-write-port.ts`, registered with
  `ctx.di.providePort('relatedPayerWritePort', …)`. Makes T012 green. [FR-030, FR-031, FR-032]
- [x] T022 [US1] `RP/src/backend/routes.admin.ts` (contracts/admin-api.md link rows) through
  `ctx.routes`, `requireAdmin` as `preHandler`; create-organization via `organizationWritePort.create`
  (`status: 'active'`) then `link.create`. Makes T011 green. [FR-020, FR-021, FR-119]
- [x] T023 [US1] Admin panel `RP/src/admin/panels/PayersPanel.tsx`, contribution in
  `RP/src/admin/index.ts` to `organization.detail.after` (RP-12), forms using admin-kit primitives,
  registry-lookup prefill through the existing lookup endpoint, `RP/src/admin/lib/labels.ts`
  (`defineEnumLabels`). Makes T015 green. [FR-020, FR-021, FR-022, FR-101] *(The billing address
  restriction and the payer e-mails control, missing until then, were added 2026-11-19 — Phase 7 notes,
  second pass.)*
- [x] T024 [US1] Register the settings group (admin settings screen, channel overrides) and the module
  composition in `RP/src/backend/index.ts`; make T014 green; run
  `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts` and
  `test/unit/_i18n/registered-bundles-shape.test.ts`. [FR-001, FR-002, FR-003, FR-004, FR-091]

*Phase 1 done 2026-11-18 — notes on what differs from the task text:*
- *T010/T017 — the four **organization permissions** are not declared yet: the permission inventory
  (`test/contract/admin_users/permission-inventory.test.ts`) refuses a grantable code no guard names
  (`unchecked-declaration`). Each is declared, labelled (en + pl) and off-state-tested with its first
  guard: `order_with_payer` Phase 2, `view_paid_orders` Phase 3, `manage` and `approve` Phase 5. The same
  rule as the error codes (T005).*
- *T010/T017 — the **palette action** `open-payer-requests` and the queue screen it opens arrive together
  in Phase 5: its target route and API do not exist before, and `check:action-route-permissions` reads the
  target's gate. A module contributing only a zone owes no action (palette-coverage rule).*
- *T017 — `dependencies` are what Phase 1 resolves (`organizations`, `addresses`, `settings`);
  `orders`, `sales_channels` and the `nonBindingDependencies` join with the phase that first resolves
  them (`check:port-dependencies` refuses an edge nothing uses).*
- *T012 — the port is resolved from the composed container by its published name (the registration
  `lazyPort` reads), as `organization-write-port.contract.test.ts` does, rather than through a test-only
  overlay module.*
- *T019 — the Redis subscription is armed on the cache's first read, not in `ctx.onBoot`
  (`check:entry-presence`: a boot hook of a module that ships off); its `on('message')` drop is ledgered in
  `check-entry-scope.ts` like the three other EntityManager-free cache drops.*
- *T020 — the four Commands are in one file, `commands/link-commands.ts`.*
- *Open: the store time zone FR-012's window is evaluated in has no platform source yet
  (`calendarDateIn(now, timeZone)` takes it as input); Phase 2 has to name one.*
- *`check:docs-translations` is red (Polish module page, module reference, sidebar message) since T001;
  it is Phase 7's documentation work.*

- *RP-15 (owner, 2026-11-18) — `valid_from` / `valid_to` are `timestamptz` instants; the usability rule
  compares the current instant (no store time zone); the panel converts the operator's dates to start /
  end of day in the browser's zone. Applied to the Phase 1 migration (uncommitted, edited in place),
  entity, contracts, `link-usability.ts`, panel and tests. The "store time zone" open point above is
  retired.*

**Checkpoint**: US1 and US8 pass on their own; the module is invisible while off.

---

## Phase 2 — US2: checkout and placement with a payer (P1)

**Goal**: a permitted X user orders with Y as payer; billing follows Y.
**Independent test**: quickstart §3 steps 1–3; `placement.test.ts`.

### Tests first

- [x] T025 [P] [US2] Failing unit test `RP/src/backend/services/related-payer-policy.test.ts`:
  `usablePayers` empty when channel disabled or person lacks `related_payers.order_with_payer`;
  `assertUsable` refuses an address outside the link scope; `payerBillingAddresses` returns only
  allowed live billing addresses; `hasPayerTermsLinks` answers from cache only. [FR-012, FR-060, FR-063]
- [x] T026 [US2] Failing integration test `backend/test/integration/related_payers/placement.test.ts`:
  US2 scenarios 1–8; SC-001 matrix (Y VAT payer / exempt × domestic / foreign billing country)
  with preview = placement; credit reserved on Y (and on Y's credit owner when inherited), X's
  untouched; insufficient Y credit refused like Y's own; payment methods = Y's allow-list only
  (FR-066 / RP-9); delivery methods and address stay X's; order keeps `organizationId = X`, carries
  `payer`, `payer_snapshot`, `payer_terms = 'buyer'`, billing snapshot = Y; every FR-068 refusal
  (module off, channel off, no permission, link inactive/revoked/outside window, Y blocked) writes,
  reserves and emits nothing; override + payer → 400 `VALIDATION_FAILED`, issue
  `payer_billing_override_conflict` (RP-16). [FR-060–FR-068, SC-001, SC-007]
- [x] T027 [P] [US2] Failing integration test `backend/test/integration/related_payers/placement-fail-open.test.ts`:
  **the payment-method allow-list read for Y must not fail open** — Y allows only method A, X allows
  A and B; placement with payer Y and method B is refused; the same request with the system-scope
  wrapper removed (test seam) would pass, proving the test bites. Also Y's billing address under X's
  ambient context resolves only through the policy port. [FR-063, FR-066, Principle XI]
- [x] T028 [P] [US2] Failing test `packages/modules/orders/src/backend/services/billing-company-data.test.ts`
  (extend): with a payer, company name and tax id come from the payer snapshot; the override is never
  consulted. [FR-061, FR-067]
- [x] T029 [P] [US2] Failing storefront tests `storefront/test/checkout/payer-selector.test.tsx`:
  selector shown only when `/api/v1/checkout/payers` answers payers; choosing Y lists Y's addresses
  only and renders company fields read-only (`AddressSection`); no payer ⇒ the existing override and
  B2C company-invoice opt-in unchanged. [FR-060, FR-061, SC-007]
- [x] T030 [P] [US2] Extend `backend/test/integration/related_payers/off-state.test.ts`: module off ⇒
  `/api/v1/checkout/payers` 503, placement naming a payer refused, placement without a payer
  unchanged. [FR-001, FR-068]

### Implementation

- [x] T031 [US2] `MIG(orders, payer_on_order)`: `payer_organization_id` (idx), `payer_link_id`,
  `payer_terms`, `payer_snapshot` on `orders`; `Order` entity fields; audit state of the order
  records ids/codes only (never `payer_snapshot`). [FR-067]
- [x] T032 [US2] `RP/src/backend/services/related-payer-policy.ts` registered with
  `ctx.di.providePort('relatedPayerPolicyPort', …)`; address read under
  `withSystemScope('related_payers: payer billing address for a linked buyer', …)`. Makes T025 green.
  [FR-012, FR-063]
- [x] T033 [US2] `orders` placement and preview (`packages/modules/orders/src/backend/services/order-service.ts`):
  resolve the policy port with `lazyPort` (no bare `catch`); when `payerOrganizationId` is present —
  `assertUsable` inside the transaction, billing address via the port instead of
  `addressRead.findById(ctx.organizationId, …)` (both `placeOrder` and `previewTotal`), tax from Y's
  `vatStatus` + Y address country, `assertMethodsAllowedForOrganization` and `creditLimit.reserve` for
  Y under `withSystemScope` with Y's id from the validated link, `billingCompanyData` from Y, payer
  columns and snapshot. Manifest: `nonBindingDependencies` `refuses-without` on
  `relatedPayerPolicyPort` with its `whenAbsent` sentence. Makes T026–T028 green.
  [FR-062–FR-068]
- [x] T034 [US2] `GET /api/v1/checkout/payers` in `RP/src/backend/routes.customer.ts`; `?payerOrganizationId=`
  on the existing checkout payment-method catalogue in `orders`. [FR-060, FR-066]
- [x] T035 [US2] Storefront: payer selector in `storefront/components/checkout/CheckoutForm.tsx`,
  read-only company fields in `storefront/components/checkout/AddressSection.tsx`, payment methods
  reloaded for the payer in `PaymentMethods.tsx`; strings en + pl in the storefront catalogues.
  Makes T029 green. [FR-060, FR-061, FR-101]
- [x] T036 [US2] Make T030 green; run the existing checkout and order placement suites unchanged
  (`backend/test/integration/orders/`, `backend/test/integration/carts/`). [SC-007]

*Phase 2 done 2026-11-18 — notes on what differs from the task text:*
- *T034 — the payer's payment-method catalogue is `payment_methods`' `GET /api/v1/payment-methods?payerOrganizationId=`
  (the catalogue lives there, not in `orders`): it vouches for the payer through `relatedPayerPolicyPort` and reads the
  payer's allow-list under a system scope; a new `refuses-without` edge `payment_methods → related_payers`.
  `checkoutPayerSchema.paymentMethodIds` is nullable (`null` = the payer is unrestricted).*
- *T027 — no test seam in production code: the "seam removed" half is proven on the real port (the payer's allow-list
  read under the buyer's context answers "unrestricted"), and the placement case was mutation-checked by hand —
  removing the system scope around the payer's allow-list read made it place the order with method B (201).*
- *T026 — FR-062's conflict is refused by the request schema as `400 VALIDATION_FAILED` whose issue carries
  `payer_billing_override_conflict`, not a 422 (accepted as RP-16). The reservation on Y's **inherited** credit owner
  (Y's parent, `shared_pool`) was added after RP-16 and passed on its first run: placement already resolved the
  owner from the payer.*
- *T033 — a link on the payer's terms is refused at checkout (`RELATED_PAYER_NOT_USABLE`, `details.reason:
  payer_terms_need_cart`) until Phase 4 lets the cart choose it (FR-060). `OrderReturnContext.payerOrganizationId` now
  reads the order column (Phase 3 consumes it). Storefront placement records no audit entry today, so there is no
  order audit state to extend.*
- *T035 — RP-16 follow-up: switching *Paid by* now recomputes net, VAT and gross through the order preview with the
  payer (`PayerTotals` in `CheckoutPayer.tsx`, `storefront/test/checkout/payer-totals.test.tsx`, seen red first); a
  refused preview says the totals could not be computed rather than showing the buyer's. The credit method follows
  the buyer's rule against Y's credit: `checkoutPayerSchema.creditAvailable` is read through `credit_limits`' new
  `creditAvailabilityReadPort` under a system scope (`degrades-without`), and the storefront lists the method only
  when it covers the total (`payer-credit-method.test.ts`, red first). The backend `creditAvailable` assertion in
  `placement.test.ts` was not run red first.*
- *T030 passed on its first run: the route existed before the probe was added.*

**Checkpoint**: an order can be placed with a payer; nothing changes without one.

---

## Phase 3 — US3: payer visibility, invoices, refunds (P1)

**Goal**: Y sees what it pays for; invoice, ledger and refunds follow Y.
**Independent test**: quickstart §3 steps 4–5; `paid-orders.test.ts`.

### Tests first

- [x] T037 [P] [US3] Failing unit test `packages/modules/orders/src/backend/services/paid-order-read-port.test.ts`:
  the port constrains by `payer_organization_id`, answers `null` for an order not naming the payer,
  and projects no delivery phone, note or comments. [FR-070, FR-071]
- [x] T038 [US3] Failing integration test `backend/test/integration/related_payers/paid-orders.test.ts`:
  US3 scenarios 1–5; invoice PDF download by Y through the paid-order route; cancel/reorder/quote/
  return/comment on that order by Y answer 404; revoked link keeps past orders listed. [FR-070, FR-071, FR-051]
- [x] T039 [P] [US3] Failing integration test `backend/test/integration/related_payers/cross-tenant-orders.test.ts`:
  for list, detail and invoice PDF — Y user without `view_paid_orders`, unrelated Organization Z, X
  user on the paid-order route, module off: each answer byte-identical to a missing order (status,
  code, body). [FR-072, SC-003]
- [x] T040 [P] [US3] Failing tests `packages/modules/invoices/src/backend/services/invoice-copy-host.service.test.ts`
  (new, beside its subject): ledger `organizationId` = `payerOrganizationId ?? organizationId`; and an
  extension of `packages/modules/invoices/src/backend/routes.admin.test.ts` (create beside
  `routes.admin.ts` if absent): admin invoice reach and organization filter use the same expression;
  the invoice is not listed under X. [FR-080, FR-081, SC-010]
- [x] T041 [P] [US3] Failing test `packages/modules/returns/src/backend/services/return-settlement-service.test.ts`
  (extend): a credit resolution on a paid order tops up the **payer**; and
  `packages/modules/orders/src/backend/services/order-return-context.test.ts` (extend) publishes
  `payerOrganizationId`. [FR-082, SC-010]
- [x] T042 [P] [US3] Failing admin test `admin/test/modules/orders/order-payer.test.tsx`: order detail
  *Paid by* line; orders list payer filter. [FR-073]
- [x] T043 [P] [US3] Failing storefront tests `storefront/test/account/paid-orders.test.tsx`: list and
  detail pages, invoice download link, no buyer actions; X's order detail shows *Paid by*. [FR-070, FR-071, FR-073]
- [x] T044 [P] [US3] Failing integration test `backend/test/integration/related_payers/payer-order-email.test.ts`:
  `notify_payer_on_orders` on ⇒ Y's `view_paid_orders` holders get `related_payer_order_placed` in
  their language; off ⇒ none. [FR-074]

### Implementation

- [x] T045 [US3] `packages/modules/orders/src/backend/services/paid-order-read-port.ts` under
  `withSystemScope('orders: orders billed to a related payer', …)`, `ctx.di.providePort('paidOrderReadPort', …)`.
  Makes T037 green. [FR-070]
- [x] T046 [US3] Paid-order routes in `RP/src/backend/routes.customer.ts` (list, detail, invoice PDF via
  `invoices`' read port by order id), permission `related_payers.view_paid_orders`. Makes T038, T039
  green. [FR-070–FR-072]
- [x] T047 [US3] `invoice-copy-host.service.ts` ledger key; admin invoice reach/filter in
  `packages/modules/invoices/src/backend/routes.admin.ts`. Makes T040 green. [FR-080, FR-081]
- [x] T048 [US3] `order-return-context.ts` publishes `payerOrganizationId`; `return-settlement-service.ts`
  credits `payerOrganizationId ?? organizationId`. Makes T041 green. [FR-082]
- [x] T049 [US3] `orders` admin: *Paid by* in `packages/modules/orders/src/admin/pages/OrderDetail.tsx`,
  payer filter in `OrdersList.tsx` and the list API. Makes T042 green. [FR-073]
- [x] T050 [US3] Storefront: `storefront/app/(account)/paid-orders/page.tsx` and `[id]/page.tsx`, account
  navigation entry shown from the module's effective presence, *Paid by* on
  `storefront/app/(account)/orders/[id]`. Makes T043 green. [FR-070, FR-073, FR-101]
- [x] T051 [US3] Transactional e-mail `related_payer_order_placed` (manifest declaration, en + pl
  defaults) sent by a `ctx.subscribe` handler on the order-placed event when the link's flag is on.
  Makes T044 green. [FR-074]
- [x] T052 [US3] Extend `off-state.test.ts`: paid-order routes 503 / account entry absent while off;
  orders keep `payer` data; reactivation restores Y's view. [FR-001, FR-004]

Phase 3 notes:

- *T037, T038, T039, T040 (both halves), T042, T043, T044 were each seen red before their implementation. T041's
  `order-return-context` extension passed on its first run (Phase 2 already published `payerOrganizationId`); its
  `return-settlement-service` half was red first. T052's extension passed once its fixture was right (the
  permission catalogue is the Administrator's read): the behaviour came with T046.*
- *T039 / FR-072 — every out-of-scope reader with the module **on** gets a body identical to a missing order's
  `404`. With the module **off**, the platform's `503 MODULE_DISABLED` answers first — accepted as RP-17 (a), FR-072
  amended.*
- *T040 — the admin half is an integration test (`paid-order-invoices.test.ts`), not `routes.admin.test.ts`: the
  reach needs the composed scope. RP-17 (e): the invoice list screen gained an *organization* filter control
  (`OrganizationPicker`, en/pl `invoices.filters.organization`); `invoice-list-path.test.ts` and
  `admin/test/modules/invoices/invoice-organization-filter.test.tsx` were each seen red first.*
- *T046 — `GET /api/v1/account/paid-orders` without `view_paid_orders` answers `404`, as the detail does (accepted,
  RP-17 c).*
- *T051 — two e-mails (RP-17 b): `related_payer_order_placed` on `order.created.v1` and
  `related_payer_order_cancelled` on `order.cancelled.v1`, both behind the link's flag; the cancellation case of
  `payer-order-email.test.ts` was seen red first. Recipients are the payer's active members whose role holds
  `view_paid_orders` (the Administrator among them), in the store's default language (RP-17 d); `related_payers` now
  depends on `customer_accounts` and `transactional_emails` (both `nonDeactivatable`).*
- *T050 — the account entry is shown to an Administrator or a holder of `view_paid_orders` while the module is
  present; the pages answer not-found when the API does.*

**Checkpoint**: Y reads paid orders through one port; invoice, ledger and refunds name Y.

---

## Phase 4 — US9: the payer's commercial terms on the cart (P1)

**Prerequisite**: T006 decided *separable*.
**Goal**: *Buying for Y* reprices the cart and the catalogue for Y on the channel's price lists.
**Independent test**: quickstart §4; `commercial-terms.test.ts`.

### Tests first

- [x] T053 [P] [US9] Failing test `packages/platform/src/http/product-audience.test.ts` (extend):
  `pricedAudienceOf` without a contributor equals `productAudienceOf`; with one, adds
  `pricingOrganizationId`; contributor absent/off ⇒ no subject; anonymous and admin actors never call
  the resolver. [FR-111, FR-115]
- [x] T054 [P] [US9] Failing unit test `packages/modules/carts/src/backend/services/cart-buying-for.test.ts`:
  set/clear, terms copied from the link, repricing summary (per line before/after, unpriced lines,
  promotions added/removed, removed code not re-applied), engine named with `organization = Y`,
  `customerAccountId = null`. [FR-110–FR-114, A-18]
- [x] T055 [US9] Failing integration test `backend/test/integration/related_payers/commercial-terms.test.ts`:
  US9 scenarios 1–9; price lists not bound to the channel never apply (Principle XII); X's
  visibility kept; minimum order value checked in the cart's context; link revoked / deactivated /
  out of window / terms switched to buyer ⇒ next cart read resets and reprices with a reason, a racing
  placement refused with nothing written; buyer's-terms link on the cart changes no price; customer
  API cannot change terms (403/404). [FR-110–FR-119]
- [x] T056 [P] [US9] Extend `backend/test/integration/carts/cart-read-equals-placement.test.ts`,
  `backend/test/integration/price_lists/price-surface-identity.test.ts` and
  `backend/test/integration/price_lists/pricing-surfaces-agree.test.ts` with a payer-context viewer:
  listing = search = PDP = cart = preview = order = Y's own price; switch and back restores every
  price. [SC-008, SC-009, FR-115, FR-117]
- [x] T056a [P] [US9] Failing integration test `backend/test/integration/related_payers/payer-terms-surfaces.test.ts`
  (RP-14): X is `vat_payer` in PL, Y `reverse_charge` abroad (and a second case Y `vat_exempt`); X's
  organization display mode `gross_only`, Y's `none`. In Y's context, **one case per call site**:
  catalogue listing (`vatRate` and price = Y's) and price sort offered (X's mode; Y's `none` hides
  nothing); with X's mode `none` price sort refused `400 PRICE_ORDERING_UNAVAILABLE` and prices
  withheld, as today; product page; cross-sell tiles; search hits; search type-ahead; comparisons
  (owner and shared view); `GET /api/v1/storefront/products/:id/resolved-price` and
  `/pricing/display-mode/:productId`; cart upsells; cart lines (`taxRate`, `lineGross`, `vat`).
  Product- and category-level display-mode overrides still win over X's. [FR-120, RP-14, SC-008]
- [x] T056b [P] [US9] Failing unit test `packages/modules/price_lists/src/backend/services/book-pricing.display-mode-organization.test.ts`:
  a viewer whose `displayModeOrganization` differs from `organization` resolves the display-mode
  tail (withheld arm, `orderable`, `pageDisplayMode`) for the display organisation and the price for
  the priced one; absent ⇒ unchanged behaviour; profile key and answer-cache key unchanged.
  [FR-120, research R-4.7]
- [x] T057 [P] [US9] Failing perf assertion in `backend/test/perf/price_lists/` (beside the existing pricing perf
  test): a catalogue page for an Organization with no payer's-terms link issues no additional
  database query compared with master. [plan Performance Goals]
- [x] T058 [P] [US9] Failing storefront test `storefront/test/cart/buying-for.test.tsx`: selector
  shown only with usable payers; change summary rendered; reset notice; checkout shows the payer fixed.
  [FR-110, FR-113, FR-116, FR-060]
- [x] T059 [P] [US9] Extend `off-state.test.ts`: module off ⇒ `PUT /cart/buying-for` 404, a cart that
  was in Y's context is priced for X on its next read, catalogue prices are X's. [FR-001, Principle XVII]

### Implementation

- [x] T060 [US9] *(RP-14 settled the VAT-rate question raised by T006; no other prerequisite.)*
  `MIG(carts, buying_for)`: `buying_for_organization_id`, `buying_for_terms` on
  `carts`; `Cart` entity fields; cleared on completion. [FR-110]
- [x] T061 [US9] Platform: `pricedAudienceOf` and the pricing-subject resolver slot in
  `packages/platform/src/http/product-audience.ts`, exported from `packages/platform/src/http/index.ts`;
  host filters by contributor presence. Makes T053 green. [FR-111, FR-115]
- [x] T062 [US9] `carts`: `PUT /api/v1/cart/buying-for` in `packages/modules/carts/src/backend/routes.ts`,
  `cart-buying-for.ts` service, repricing through `cart-pricing-recompute.ts` / `cart-line-pricing.ts`
  naming Y, cart-read reset (FR-116), resolver contribution reading the active cart and
  `relatedPayerPolicyPort.pricingContext`, manifest `nonBindingDependencies` `degrades-without`.
  The cart's own line VAT rate, line grosses and `vat` block use Y's VAT status and country in a
  payer's-terms context (RP-14). Makes T054 green. [FR-110–FR-114, FR-116, FR-120]
- [x] T063a [US9] `price_lists`: optional `displayModeOrganization` on `ListingPriceViewerContext`
  (contracts) and on the engine viewer; `#viewerMode` (`book-pricing.ts`), `orderable`
  (`price-surface.ts`) and `pageDisplayMode` read it when present, `organization` otherwise. No new
  cache key. Makes T056b green. [FR-120, research R-4.7]
- [x] T063 [US9] Consumers switch to `pricedAudienceOf`, each pricing and grossing for
  `pricingOrganizationId ?? organizationId` (Y) and resolving the display mode for `organizationId`
  (X) (RP-14, research R-4.8):
  - `catalog/src/backend/routes.public.ts` — the read context, `priceControlsAvailable` (display
    mode → X), `withVatRates` (`productTaxRates` → Y);
  - `catalog/src/backend/services/viewer-organization.ts` (`pricingOrganizationId ?? organizationId`),
    `catalog-query.service.ts` `#viewerPricingContext` (`displayModeOrganization` = X;
    `customerAccountId` only when the priced organisation is X) and `#refusePriceControlsWherePricesHidden`;
  - `catalog/src/backend/services/product-link.service.ts` (cross-sell tiles);
  - `search/src/backend/routes.public.ts`, `search-query.service.ts` `#viewerOrganization` (hits) and
    `suggestion-pricing-enricher.ts` (type-ahead);
  - `comparisons/src/backend/routes.public.ts`, `buyer-viewer.ts`, `comparison-service.ts`
    `#viewerOrganization`;
  - `price_lists/src/backend/routes.storefront.ts` `pricingViewerOf` (resolved-price and display-mode
    endpoints);
  - `carts/src/backend/routes.ts` cart upsells.
  Makes T056, T056a, T057 green. [FR-115, FR-120, SC-008]
- [x] T064 [US9] `orders` placement: with a payer's-terms cart, `payerOrganizationId` must equal the
  cart's `buyingFor`; prices from the cart's context; minimum order value resolved in that context;
  `payer_terms = 'payer'`. Makes T055 green. [FR-112, FR-116, FR-117]
- [x] T065 [US9] Storefront: *Buying for* selector and change summary on `storefront/app/(commerce)/cart/page.tsx`
  (new `storefront/components/CartBuyingFor.tsx`), reset notice, checkout payer fixed. Makes T058,
  T059 green. [FR-110, FR-113, FR-116, FR-101]

Phase 4 notes:

- *RP-18 (owner, after the first Phase 4 report): the http publication, the `carts.create` guard and the absence of
  an audit entry are accepted; FR-112 (promotions, minimum order value) is finished in this merge request.*
- *Seen red first: T053 (`pricedAudienceOf is not a function`), T056b (1 of 3 — the display organisation's mode; the
  absent case and the unchanged profile key held already), T054 (module missing), T058 (module missing); after
  RP-18 the sign-in merge into a payer's-terms basket (`buying-for-cart-paths.test.ts`: 19.99 instead of the payer's
  11), the switch summary's promotions (`buying-for-promotions.test.ts`: `promotionsAdded` empty) and a terms change
  racing the placement (`commercial-terms-lifecycle.test.ts`: the order was **placed** at the payer's price with
  `payer.terms = 'buyer'` — a real defect, now refused `payer_terms_changed`).*
- *Written after the implementation they guard, and each **mutation-checked** (the guarded line broken in the working
  tree, the package rebuilt, the test seen red, the file restored from a scratchpad copy and rebuilt — no git):
  M1 the resolver's no-link short-circuit removed ⇒ the T057 statement count red; M2 the catalogue ignoring
  `pricingOrganizationId` ⇒ `commercial-terms` FR-115 and three `payer-terms-surfaces` cases red; M3 no reset on read
  ⇒ `commercial-terms` US9-5, the T059 off-state case and the three lifecycle link cases red; M4 placement not checking
  the cart context ⇒ `commercial-terms` FR-117 red; M5 `PUT /cart/buying-for` not refused while the module is off ⇒
  the T059 case red; M6 listing VAT from the buyer ⇒ two surfaces cases red; M7 cart VAT from the buyer ⇒ two surfaces
  cases red; M8 the storefront display mode resolved for the payer ⇒ the display-mode case red; M9 placement promotions
  for the buyer ⇒ the promotion-use case red; M10 cart promotions for the buyer ⇒ the switch-summary case red; M11
  comparisons priced for the buyer ⇒ the tiles/comparison case red. M6 first **survived**: the test environment has
  no tax rule, so every rate read 0; the surfaces test now seeds a 23 % rule for simple products (removed after, the
  `cart-vat-equals-placement` precedent) with an own-context control, and M6 is caught.*
- *The add path: every add goes through `addItems`, whose orderability pre-check runs only when a new **working**
  basket is created (one-click, admin creation, API intake) — a basket that never carries *Buying for*. The active
  basket's add prices each line in `#writeLine` in the cart's context; `buying-for-cart-paths.test.ts` proves a product
  only the payer prices is refused in the buyer's context and added at the payer's price in the payer's.*
- *FR-112 — promotions: the cart (`cart-coupon-service.ts`), the preview and the placement (`order-service.ts`
  `#promotionBuyer`) evaluate for the payer and its group on the payer's terms, and the promotion use is recorded for
  the payer (RP-19 c). The switch summary names the promotions added and removed as the cart read's own answer
  before and after the switch (RP-19 b: same totals basis, line VAT included); the threshold case in
  `buying-for-promotions.test.ts` — a minimum spend between the net 19.99 and the gross 24.59 — was red first against
  the earlier net-only evaluation, which is removed. The minimum order value is a per-channel setting, not an
  Organization's: on the payer's terms it is judged on the subtotal at the payer's prices
  (`commercial-terms-lifecycle.test.ts`).*
- *T055 covers US9 1, 5, FR-115, FR-116 (terms changed; revoked, deactivated and out-of-window links, each with a
  refused in-flight placement and nothing written), FR-117, FR-110, FR-119, Principle XII, X's own visibility kept,
  the racing terms change and the minimum order value.*
- *T056 — the payer case is in `pricing-surfaces-agree.test.ts` (listing, price sort, product page, resolved price,
  cart and the placement drift check all quote the payer; switching back restores every buyer price).
  `price-surface-identity.test.ts` and `cart-read-equals-placement.test.ts` were not edited: their payer obligations
  (sort equals cards, read equals the drift check) are asserted in that case.*
- *T056a — `payer-terms-surfaces.test.ts`: its own buyer (`vat_payer`, `gross_only`), payers `reverse_charge` (DE, own
  mode `none`) and `vat_exempt`; listing, product page, resolved price, display-mode endpoint, price sort offered /
  refused under X's `none`, cross-sell tiles, comparison, cart lines (`taxRate`), product- and category-level
  overrides. Search hits and type-ahead (RP-19 a): `backend/test/integration/search/payer-terms-search.test.ts` — it
  typechecks and lints; locally it stops in `beforeAll` on `MeilisearchApiError: The provided API key is invalid`, as
  every file in that directory does here, and on nothing of its own. It runs in the nightly suite on `master`; it has
  **not** been seen green.*
- *T057 — `backend/test/perf/price_lists/payer-terms-statement-count.perf.test.ts` (runs with `PERF_RUN=true`): a warm
  page for a buyer holding only a buyer's-terms link costs what it costs with the module off.*
- *T060 — `MIG(carts, buying_for)` = `20261119T090000_carts_buying_for.ts`; cleared on completion.*
- *T063 — switched: catalogue listing / detail / URL-key resolution (`pricedContext`), `withVatRates`,
  `#viewerPricingContext`, cross-sell tiles, search hits and type-ahead, comparisons, `price_lists`' `resolved-price`
  and `display-mode`. Cart upsells carry no price (`unitPrice: null`).*
- *T065 — the checkout fixes the payer of a payer's-terms cart and previews naming it.*

**Checkpoint**: payer's-terms carts price as Y everywhere, with no new cache key.

---

## Phase 5 — US4 + US7: requests, approval, revocation (P2)

**Goal**: buyers request payers without the operator; either side can revoke.
**Independent test**: quickstart §5 steps 1–2; `requests.test.ts`, `revocation.test.ts`.

### Tests first

- [x] T066 [P] [US4] Failing unit test `RP/src/backend/services/request-routing.test.ts`: matrix approval
  mode (`payer`, `admin`, `payer_then_admin`) × match (one eligible, ineligible, several, none) ×
  eligible approver present/absent → `routing` + `operatorReason`; captured modes used, not current
  settings. [FR-043, FR-044]
- [x] T067 [P] [US4] Failing unit test `RP/src/backend/services/request-state.test.ts`: `pending →
  active | rejected | expired | withdrawn`, terminal states, version-guarded single decision.
  [FR-045]
- [x] T068 [P] [US4] Failing unit test `RP/src/backend/services/daily-limit.test.ts`: window from local
  midnight in the store time zone, counts requests + invitations of the sender. [FR-046]
- [x] T069 [P] [US4] Failing audit sentinel test `RP/src/backend/commands/request-commands.audit.test.ts`:
  every request Command records no tax id, contact e-mail, comment, rejection reason or names.
  [FR-100, SC-006]
- [x] T070 [US4] Failing integration test `backend/test/integration/related_payers/request-enumeration.test.ts`:
  replies byte-identical (status, headers that vary by outcome, body shape) across eligible,
  ineligible, ambiguous, unknown tax IDs, and across the 429 path; the sender's list never exposes
  counterparty or routing. [FR-041, FR-046, SC-002]
- [x] T071 [US4] Failing integration test `backend/test/integration/related_payers/requests.test.ts`:
  US4 scenarios 1–8; approvers found through `rolesHolding`; e-mail + in-account notification to Y's
  approvers, none to the contact e-mail; acceptance creates the link on buyer's terms; concurrent
  accept → one wins, the other `409 RELATED_PAYER_REQUEST_DECIDED`; withdraw; X ↔ Y lists by
  permission. [FR-040–FR-047, FR-119]
- [x] T072 [P] [US4] Failing integration test `backend/test/integration/related_payers/cross-tenant-requests.test.ts`:
  incoming requests visible only to the counterparty's permitted users; others get 404. [FR-047, Principle XI]
- [x] T073 [P] [US4] Failing integration test `backend/test/integration/related_payers/operator-queue.test.ts`:
  queue lists reasons; approve / reject with reason shown to sender; second step of
  `payer_then_admin`; admin notification on new entry. [FR-023, FR-025]
- [x] T074 [P] [US4] Failing unit test `RP/src/backend/workers/request-expiry-sweep-worker.test.ts`:
  expires overdue pending requests as system actor; does nothing while the module is off; resumes and
  expires overdue ones on reactivation. [FR-102, FR-045]
- [x] T075 [US7] Failing integration test `backend/test/integration/related_payers/revocation.test.ts`:
  US7 scenarios 1–3 from X, Y, operator and port; other side notified; earlier orders still visible to
  Y with Y's invoices and reservations untouched; new placement refused. [FR-050, FR-051]
- [x] T076 [P] [US4] Failing storefront tests `storefront/test/account/payers.test.tsx`: Payers page
  (links, requests, request form, incoming requests, revoke), permission-driven visibility.
  [FR-047, FR-040, FR-050]
- [x] T077 [P] [US4] Failing admin test `admin/test/modules/related_payers/RequestsQueue.test.tsx` and
  run `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts`. [FR-023, FR-024]

### Implementation

- [x] T078 [US4] Services `request-routing.ts`, `request-state.ts`, `daily-limit.ts`,
  `approver-resolver.ts` (`rolesHolding` precedent: `carts/src/backend/services/cart-approval-emails.ts`)
  in `RP/src/backend/services/`. Makes T066–T068 green. [FR-043–FR-046]
- [x] T079 [US4] Request Commands `RP/src/backend/commands/request-*.command.ts` (create, accept, reject,
  withdraw, expire, route) with `afterCommit` dispatch; events `related_payers.request.created|decided.v1`.
  Makes T069 green. [FR-045, FR-100]
- [x] T080 [US4] Customer routes in `RP/src/backend/routes.customer.ts` per contracts/storefront-api.md
  (requests, incoming, accept/reject, withdraw, link revoke both sides) with the always-202 contract.
  Makes T070–T072, T075 green. [FR-040–FR-042, FR-047, FR-050]
- [x] T081 [US4] Notifications: manifest `transactionalEmails` (`related_payer_request_received`,
  `related_payer_request_decided`, `related_payer_link_revoked`) with en + pl defaults;
  `customerNotificationRecordPort` and `adminNotificationRecordPort` writes from the outbox handlers.
  [FR-042, FR-025, FR-050, FR-101]
- [x] T082 [US4] Admin queue page `RP/src/admin/pages/RequestsQueue.tsx` at `/related-payers/requests`
  (landing, sidebar entry with `requiredPermission`) and admin queue routes. Makes T073, T077 green.
  [FR-023, FR-024]
- [x] T083 [US4] `RP/src/backend/workers/request-expiry-sweep-worker.ts` via `ctx.worker`, repeatable job
  on the `quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` pattern. Makes T074 green. [FR-102]
- [x] T084 [US4] Storefront account pages `storefront/app/(account)/payers/page.tsx` (+ components).
  Makes T076 green. [FR-047, FR-101]
- [x] T085 [US4] Extend `off-state.test.ts`: request routes 503, worker does not run, queue/sidebar
  absent. [FR-001, FR-102]

Phase 5 notes (done 2026-11-19):

- *Seen red first: T066 / T067 / T068 (modules missing; now 27 cases), the manifest test for `manage` + `approve` (2 of
  6 red), T071 `requests.test.ts` (5 of 5 red: no routes; its notification cases US4-2 / US4-3 and the expiry case
  US4-8 red again on 2026-11-19: nothing sent, no `relatedPayerRequestExpiry`), T073 `operator-queue.test.ts` (7 of 7:
  no queue routes), T074 `workers/request-expiry-sweep-worker.test.ts` (module missing), T075 `revocation.test.ts`
  (the payer's revoke answered `404` — the link is the buyer's row and Y's tenant filter hid it from the Command — and
  no e-mail), T076 `storefront/test/account/payers.test.tsx` (module missing), T077 `RequestsQueue.test.tsx` (page
  missing), the T085 off-state probes for `GET /account/related-payers`, `GET /account/payees` and the queue routes
  (`404` instead of `503`) and its expiry case (worker missing), and the enumeration test's outbox case (no rows).
  Written after their subject and **mutation-checked**: T069 (the tax ID put into `request.create`'s audit state ⇒
  red); T070 (`routing` leaked into the sender's list ⇒ red, the daily-limit check skipped ⇒ red); T072's first three
  cases, whose first red was a defect of the test (it compared the error envelope's `requestId`) — the incoming list
  without its counterparty constraint, `#incoming` without it, and the accept route without the `approve` guard ⇒ each
  red; the withdraw case — dropping the sender constraint from the lookup alone **survived** (the Command reloads the
  row under the caller's tenant filter, the structural guard), and running the whole withdraw under a system scope ⇒
  red; the two contract cases added to `related-payers.test.ts` (a hookable phase changed, the queue query not strict ⇒
  each red). Every mutation was made in the working tree, the package rebuilt, the test seen red, the file restored
  from a scratchpad copy and rebuilt — no git.
- *T070 — "several matches" is not reachable over HTTP here: in the default (global) tax-ID scope a tax ID is unique, and
  the per-tree-root scope is installation-wide (`specs/177-tax-id-scope/`). Its routing is asserted in T066.*
- *T078 — the approver resolution (`rolesHolding` ∧ active, not blocked, not anonymised) is a private method of
  `services/request-service.ts`, not a separate `approver-resolver.ts`.*
- *FR-046 — "today" starts at midnight **UTC**: the store's time zone has no setting this module may read (the nearest
  is `analytics.reporting_time_zone`, behind `reportingTimeZonePort`). Owner question.*
- *Decisions are serialised by a row lock on the request (`SELECT … FOR UPDATE`) and a `version` bump per decision; the
  loser reads a terminal state and answers `409 RELATED_PAYER_REQUEST_DECIDED` (T071 US4-3).*
- *T079 / T081 — the after-commit outbox (research R-8): `related_payers` declares four of its own Commands hookable,
  `afterCommit` only (`RELATED_PAYERS_HOOKABLE_ACTIONS` in `@endora-commerce/contracts`: `request.create`,
  `request.accept`, `request.reject`, `link.revoke`), and registers its own handlers on them (`ctx.commandHooks`). The
  reply to a request writes the same outbox rows whatever the tax ID matched (asserted in `request-enumeration.test.ts`)
  and sends nothing itself. The handlers act on the routing and state **the row recorded at commit** — re-reading the
  request instead announced a request Y had meanwhile moved to the operator twice — and each widens to its own system
  scope, because the drain pins a handler to the row's Organization (the sender, or the link's buyer) while the people
  told are the other side's too. Delivery: `related_payer_request_received` + a centre entry to the counterparty's
  approvers (never the contact e-mail); `related_payer_request_decided` + a centre entry to the sender's requester and
  payer managers on an acceptance or rejection; one `all_admins` bell entry when a request enters the queue (on
  creation, or Y's acceptance under `payer_then_admin`); `related_payer_link_revoked` + a centre entry to the other side
  (both sides when the operator or the port revoked). Expiry and withdrawal notify nobody. `customer_notifications` and
  `admin_notifications` are `degrades-without` edges, asked by `effectiveState.isPresent` in front of the port. The
  centre entry is idempotent on its source key; a redelivered row can repeat the bell entry (the bell has no key).*
- *T080 — added `GET /api/v1/account/related-payers` (`manage` or `order_with_payer`) and `GET /api/v1/account/payees`
  (`approve`). `POST /api/v1/account/payees/invitations` is T091 (Phase 6) and was not built. The payer-side revoke
  runs under `withSystemScope('related_payers: the payer revokes a link naming it')` after `findAsPayer` constrained it
  to a link naming the asking payer.*
- *T082 — queue: `GET /api/v1/admin/related-payers/requests` (`?state`, default `pending`; `?reason`;
  `?salesChannelId`), `POST …/:id/approve`, `POST …/:id/reject` (`{ reason }` required). `assign-organization`,
  `create-organization` and `send-invitation` are Phase 6 (T090). Approving a request with no matched Organization
  (`no_account`, `ambiguous_tax_id`) answers `422 VALIDATION_FAILED` until Phase 6 can assign one; the page disables
  *Approve* for such a row. Page `src/admin/pages/RequestsQueue.tsx` at `/related-payers/requests` (landing route), a
  sidebar entry under *Customers* (weight 600, after `/comparisons`), palette action `open-payer-requests` with the
  existing `Inbox` icon (no `icon-map.ts` change). `candidates` is answered `[]` until Phase 6.*
- *T083 — `workers/request-expiry-sweep-worker.ts`: a module-wide Job Scheduler every 30 minutes through `ctx.worker`,
  on the RFQ sweep's pattern; the tick also asks the module's presence itself (the job in hand when the flip landed),
  and an idle tick opens no system scope. `services/request-expiry.ts` expires each overdue pending request through
  `request.expire` (a request decided in between is skipped on the Command's `409`).*
- *T084 — `storefront/app/(account)/payers/` (page + server actions), `components/account/Payers.tsx`, account nav entry
  *Payers*, `payers` added to `reserved-segments.ts`; refusals reach the URL as a code (`?error=limit|decided|invalid|
  failed`), never the API sentence.*
- *Composition: `related_payers` is the first module of the generated list to call `ctx.commandHooks`, so the three test
  roots that compose that list without a hook registry (`test/unit/kernel/module-removal.test.ts`,
  `test/unit/kernel/worker-compose.test.ts`, `test/overlay/packaged-owner-decoration.test.ts`) now mount one through
  `test/helpers/generated-list-command-hooks.ts`; `harness-parity.test.ts` named them. `bullmq` joined the package's
  rendered dependencies (`manifests:generate`, `pnpm install`).*
- *RP-19 checked 2026-11-19: (a) `test/integration/search/payer-terms-search.test.ts` typechecks and stops in
  `beforeAll` on Meilisearch locally; (b) and (c) are green in `buying-for-promotions.test.ts` (whole
  `test/integration/related_payers` directory: 23 files, 288 tests).*
- *FR-046 — superseded by RP-20 (a) below: the day starts at midnight in the default store's time zone.*

RP-20 follow-ups (owner, 2026-11-19; done the same day, before Phase 6):

- *(a) The daily limit's day starts at midnight in the **default store's time zone**. There is no
  platform-wide store time zone (the nearest, `analytics.reporting_time_zone`, sits behind a switchable
  module and falls back to UTC — the reason `tasks.time_zone` rejected it), so the module declares
  `related_payers.time_zone` (IANA, default `Europe/Warsaw`, the `tasks` / `returns` precedent), reads it
  **for the system-default sales channel** (`services/store-time-zone.ts`), falls back to the default for a
  zone the runtime does not know, and refuses such a write (`422`, a `settingWriteValidatorRegistry`
  contribution). Not one of FR-003's six channel settings (`RELATED_PAYERS_SETTING_DEFAULTS` unchanged).
  `store-time-zone.test.ts` red first (module missing); `phase5-follow-ups.test.ts` (a) red first (setting
  unregistered), then **mutation-checked** (the resolver answering `UTC` ⇒ red).*
- *(b) The four request/revoke Commands stay public hookable actions — no change. Phase 6 adds two more for
  its own after-commit work: `request.expire` (c) and `request.route` (US5).*
- *(c) Expiry tells the **requester** only — `related_payer_request_expired` (en + pl defaults) and a centre
  entry `related_payers.request_expired` — from the `request.expire` outbox row (`notify-request-expired`),
  in the request channel's default language, as the other request e-mails. Withdrawal writes no outbox row
  and tells nobody. Red first (no e-mail); mutation-checked (recipient filter broken ⇒ red). The withdrawal
  case passed on its first run (nothing was ever sent on withdrawal).*
- *(d) `GET /api/v1/account/payees` names each buyer's tax ID: `relatedPayerLinkSchema.buyerTaxId` (the admin
  shape names both sides), `PayeesTable` shows a *Tax ID* column. Contract, integration and storefront cases
  each red first.*

**Checkpoint**: requests are safe against enumeration and every decision is audited.

---

## Phase 6 — US5 + US6: payer without an account, payer invitations (P2 / P3)

### Tests first

- [x] T086 [US5] Failing integration test `backend/test/integration/related_payers/no-account.test.ts`:
  US5 scenarios 1–6: `admin` mode queue entry; operator create-organization (link active),
  send-invitation, reject with reason; `invite` mode e-mail in the channel language with NIP prefill
  token; registration with that tax id approved (`organization.status_changed.v1` → `active`)
  attaches the request and routes it per FR-043; expired invitation attaches nothing; rejected
  registration leaves the request pending; never an Organization created from an invitation.
  [FR-044, FR-023]
- [x] T087 [P] [US5] Failing integration test `backend/test/integration/related_payers/ambiguous-tax-id.test.ts`:
  per-tree-root tax-ID scope with two Organizations ⇒ operator queue, `assign-organization` routes
  it; sender reply unchanged. [FR-043, FR-041]
- [x] T088 [US6] Failing integration test `backend/test/integration/related_payers/invitations.test.ts`:
  US6 scenarios 1–3; X's `manage` holders notified and accept; `payer_then_admin` adds the operator
  step; setting off ⇒ route 404 and storefront action absent; unregistered buyer follows the
  no-account modes (A-15). [FR-040, FR-042, FR-044]
- [x] T089 [P] [US5] Failing storefront test `storefront/test/auth/register-payer-invitation.test.tsx`:
  the registration page pre-fills the tax ID from a valid invitation token, ignores an expired one.
  [FR-044]

### Implementation

- [x] T090 [US5] Invitation flow: token issue/hash, `related_payer_invitation_to_register` e-mail
  (en + pl), `send-invitation` / `create-organization` / `assign-organization` queue actions,
  `ctx.subscribe('organization.status_changed.v1')` attach handler. Makes T086, T087 green.
  [FR-023, FR-044]
- [x] T091 [US6] `POST /api/v1/account/payees/invitations` and the reversed acceptance path, behind
  `related_payers.payer_may_invite_buyers`. Makes T088 green. [FR-040, FR-042]
- [x] T092 [US5] Storefront registration prefill in `storefront/app/auth/register/` and the payee
  invitation form on the Payers page. Makes T089 green. [FR-044, FR-101]

Phase 6 notes (done 2026-11-19):

- *Seen red first: the contract cases (`adminCreateRequestOrganizationBodySchema`,
  `relatedPayerInvitationLookupResponseSchema`, the `request.route` / `request.expire` actions),
  `request-commands.audit.test.ts`'s Phase 6 case (`requestRouteCommand is not a function`), T086
  `no-account.test.ts`, T087 `ambiguous-tax-id.test.ts`, T088 `invitations.test.ts` (14 of 18 across the three:
  routes missing), its invitation-withdraw case, T089 `register-payer-invitation.test.tsx` (2 of 3), the
  storefront `payers.test.tsx` Phase 6 cases (4) and the admin `RequestsQueue.test.tsx` Phase 6 cases (2 of 3; the
  reader case held already). The off-state probes for the new routes passed on their first run: the routes
  were mounted through `ctx.routes` when the probes were added.*
- *Written after their subject and **mutation-checked** (working tree, package rebuilt, red, restored from a
  scratchpad copy, rebuilt — no git): the direction guard on deciding a request (a member holding only
  `approve` accepting a payer's invitation ⇒ 200, red); `payer_may_invite_buyers` (⇒ 202, red); the candidate
  check of `assign-organization` (⇒ 200, red); the tax-ID match of `create-organization` (⇒ 201, red);
  `customers:manage` on `create-organization` (⇒ 201, red); the invitation lookup's expiry (⇒ 200, red); the
  invitation's once-only token on a redelivered outbox row (⇒ two e-mails, red — the first run **survived**,
  because a second drain does not redeliver a delivered row; the test now resets the row to `pending`); the
  counterparty constraint on an incoming request (an unrelated Organization accepting ⇒ 200, red).
  **Survived**: dropping `state: 'pending'` from the registration attach's query — the `expires_at` filter and
  the `request.route` Command's own pending check each still refuse an expired request (defence in depth, not
  a gap).*
- *T090 — the invitation to register is the Command `related_payers.invitation.send`: it issues a random token,
  stores only its sha-256 (`invitation_token_hash`) and moves the request to `awaiting_registration`; the
  caller e-mails the raw token, which never reaches an audit entry, an outbox row or a log. Under `invite` it is
  run by the `request.create` outbox handler (after commit, so the sender's reply is unchanged, FR-041); a
  redelivered row finds the token issued and sends nothing. The operator's *Send invitation* runs it from the
  queue. E-mail `related_payer_invitation_to_register` (en + pl) to the contact e-mail, in the request channel's
  default language, with an absolute link `<storefront>/register?payerInvitation=<token>` (the channel's
  `sales_channels.storefront_url`, else `STOREFRONT_BASE_URL` — `organizations`' issue #1371 resolver, copied).
  Anonymous `GET /api/v1/related-payers/invitations/:token` answers `{ taxId }` for a live invitation and `404`
  otherwise (unknown, used up, decided, expired, capability off on the request's channel).*
- *T090 — attach: `ctx.subscribe('organization.status_changed.v1')` with `newStatus = 'active'` (the moderation
  approval, and an unblock) routes every pending, unexpired `awaiting_registration` request naming that
  Organization's tax ID through `request.route`, by the approval mode captured on it (FR-043): to its
  approvers (who are told from the new `request.route` outbox row, `notify-request-routed`) or to the operator.
  The invitation token is cleared when the request finds its Organization, so the link stops pre-filling. A
  rejected registration emits `rejected`: nothing attaches and the request stays pending (US5-6).*
- *T090 — queue actions: `POST …/requests/:id/assign-organization` (`{ organizationId }`, one of the
  Organizations the tax ID matches now, else `422`; routed by the captured mode through `request.route`),
  `POST …/create-organization` (`related_payers:manage` **and** `customers:manage`; the organization create as
  the card's, always `active`; the tax ID must be the request's, else `422`; then `request.accept` at the
  operator step naming the new Organization — the link active on the buyer's terms), `POST …/send-invitation`.
  Each answers `404` for a request that is not a pending queue entry without an Organization, `409` once
  decided. `candidates` is filled for every pending queue entry without an Organization (an ambiguous tax ID,
  or one that registered since). Approving such an entry still answers `422` until it has an Organization.
  The queue screen offers *Assign organization* (when there are candidates), *Create organization* (a dialog
  with the card's fields, pre-filled with the request's tax ID; the fields are now one shared component,
  `src/admin/components/NewOrganizationFields.tsx`, used by the card's create too) and *Send invitation*.*
- *T087 — two Organizations sharing a tax ID need the installation-wide `per-tree-root` scope, which a parallel
  file must not switch (the Phase 5 enumeration note). The file drives the same operator path with a request
  routed while no Organization held the tax ID (one registered after) and one marked ambiguous; "several
  matches → operator" stays `request-routing.test.ts`'s.*
- *T091 — `POST /api/v1/account/payees/invitations` (`approve`; `404` while `payer_may_invite_buyers` is off on
  the channel): the request route's one `202 pending` reply and the daily limit both directions share.
  Added beside it: `GET /api/v1/account/payees/invitations` (the payer's sent invitations, sender view; `404`
  while the setting is off — the storefront hides the whole section on it, US6-3) and `POST …/invitations/:id/
  withdraw` (`approve`; not behind the setting, so an invitation sent before it was switched off can be taken
  back). `GET /api/v1/account/related-payers/requests` and its withdraw now reach buyer requests only.
  Deciding: `GET …/incoming` and `POST …/incoming/:id/accept|reject` admit `approve` **or** `manage`; a request
  to pay is decided by `approve`, an invitation from a payer by `manage` — a member holding only the other
  finds `404`. X's payer managers are told by `related_payer_invitation_received` (en + pl) and a centre entry
  `related_payers.invitation_received`; the decision e-mail goes back to the inviting payer's requester and
  approvers. Unregistered buyers follow the no-account modes (A-15).*
- *T092 — `storefront/app/(auth)/register/page.tsx` (the task text's `app/auth/register/` is the `(auth)` route
  group) reads `?payerInvitation=` and pre-fills the tax ID through `lookupPayerInvitation`; anything the API does
  not vouch for leaves the form empty. *Payers* page: *Payers offering to pay for our orders* (`manage`),
  *Invitations we sent* with the invite form (`approve`, only while the route answers).*
- *GUS/VIES prefill: the queue's *Create organization* uses the card's existing registry lookup (FR-021); the
  invitation flow itself prefills only the tax ID — the registration form's own registry lookup does the rest.*

RP-21 (owner, 2026-11-19, after the Phase 6 report) — recorded in `spec.md`; no code change follows from it:

- *(a) `related_payers.time_zone` stays until a platform-wide store time zone exists.*
- *(b) The `invite` mode's leak — a sender who types their own address as the contact e-mail learns the tax ID has no
  account — is an accepted residual risk; the default mode is `admin`. Documented beside FR-041 and in the operator
  documentation of the channel settings (T093).*
- *(c) `request.expire` and `request.route` stay public hookable actions.*
- *(d) `create-organization` from the queue requires the tax ID to equal the request's (as built in T090).*
- *(e) Withdrawing a payer's invitation stays available while `payer_may_invite_buyers` is off (as built in T091).*

---

## Phase 7 — Documentation, generated artefacts, verification

- [x] T093 [—] Module documentation `RP/docs/related-payers.md` (what it does, settings, permissions,
  checkout and cart behaviour, the port for overlays, off behaviour) and its Polish translation under
  `docs/i18n/pl/` with the translation-cache entry (`docs/docs/contributing/documentation-i18n.md`);
  update `packages/modules/orders/docs/`, `carts`, `invoices`, `returns` pages where behaviour changed.
  Run `pnpm --filter backend run check:module-docs` and `check:docs-translations`. [FR-101]
- [x] T094 [—] i18n sweep: every new key in both `en.json` and `pl.json` of `related_payers`, `orders`,
  `carts`, storefront catalogues; `pnpm --filter backend run i18n:hardcoded`;
  `backend/test/unit/_i18n/registered-bundles-shape.test.ts`. [FR-101]
- [x] T095 [—] Generated artefacts, regenerated and committed together:
  `pnpm --filter backend run composer:generate` (manifest index, migrations registry
  `backend/src/db/migrations-registry.generated.ts`, `admin/src/modules.generated.ts`, docs sidebar and
  module map), `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`,
  `pnpm --filter backend run composer:check`.
- [x] T096 [—] Changeset under `.changeset/` for every published package touched (`contracts`,
  `platform`, `related_payers`, `orders`, `carts`, `invoices`, `returns`, `catalog`, `search`,
  `comparisons`, `price_lists`), body checked against `specs/conventions/commercial-data.md` (no
  client named).
- [x] T097 [—] Moved/deleted-file sweep: `grep -rn` `backend/test/**` for every path this merge request
  renamed or deleted; re-derive any ledger derived from a location (`specs/conventions/check-estate.md`).
- [x] T098 [—] **Final verification** — report each command's output:
  `pnpm run build:packages`; `pnpm -r run typecheck`; `pnpm -r run lint`;
  `pnpm --filter backend run test:unit:fast`; `pnpm --filter '!backend' run test`;
  `pnpm --filter backend exec vitest run test/integration/related_payers test/contract/admin_users/permission-inventory.test.ts test/integration/carts/cart-read-equals-placement.test.ts test/integration/price_lists`;
  the complete suite `pnpm --filter backend run test` on `pnpm run dev:infra:test` (D-198: not run by
  the pull request); `pnpm run check:naming && pnpm run check:language`; the check estate —
  `check:module-boundary`, `check:port-dependencies`, `check:port-catches`, `check:kernel-boundary`,
  `check:subscribe-seam`, `check:entry-presence`, `check:action-route-permissions`,
  `check:platform-surface`, `check:module-docs`, tenancy classification, and
  `test/contract/kernel/harness-parity.test.ts`.
- [ ] T099 [—] Manual quickstart walk-through (`quickstart.md` §1–§6) on a local stack, timing SC-005
  (operator link < 1 min; checkout ≤ 2 extra selections) and noting the result in the merge request.
  [SC-005]

Phase 7 notes (2026-11-19):

- *Base moved to `origin/master` e15d9efc5 (106 commits) without a commit or a stash: the uncommitted work was backed up
  (`git diff HEAD --binary` + a tar of the untracked files, verified by applying the patch to the old base in a temporary
  index), the seven files upstream also changed were restored to `HEAD`, `git reset --keep origin/master` carried the
  rest, and the seven were re-applied with `git apply --3way`. Six merged cleanly; `orders/src/admin/pages/OrdersList.tsx`
  conflicted with upstream's `ListToolbar` rewrite (#1440): the payer filter was re-applied into *More filters* (an
  `OrganizationPicker`, an applied-filter chip, the *More filters (n)* count, *Clear all*), and
  `admin/test/modules/orders/order-payer.test.tsx` now opens *More filters*. `pnpm-lock.yaml` took upstream's and was
  regenerated; `composer:generate` and `manifests:generate` re-run, `composer:check` / `manifests:check` clean.*
- *T093 — the module's documentation is a directory, `docs/related-payers/`: `index.md` (concepts, settings,
  permissions, what an order with a payer changes, *Buying for*, notifications, the automation port and hookable actions,
  audit, off behaviour), `operator-guide.md` (the card section, channel settings with the RP-21 (b) residual risk under
  an explicit anchor, the queue, the payer's terms) and `storefront-guide.md` (buyer and payer). A section was added to
  each of the `orders`, `carts`, `invoices`, `returns`, `payment_methods`, `credit_limits` and `price_lists` pages. Polish:
  the three module pages, the seven sections, the generated reference (`related-payers`, plus the new dependency rows
  of `carts`, `orders`, `payment-methods`), the module map row and `sidebar.main.category.related_payers`; 15 pins.
  `check:module-docs` and `check:docs-translations` (192 sources, 0 findings) green; `pnpm --filter docs run build`
  green for `en` and `pl`. The first `composer:generate` after the page moved into a directory still linked the old
  single page (it walked the stale collected copy it then removed); a second run is correct.*
- *Found while documenting: the card's *Payers* section offered no control for the **billing address restriction**
  (`addressScope: one`) nor for the link's **payer e-mails** flag (`notifyPayerOnOrders`). **Closed 2026-11-19 (owner
  decision, FR-021)** — see the second note block below.*
- *T094 — every new key is in both bundles of `related_payers`, `orders`, `carts`, `invoices`, `_i18n` and the storefront
  catalogues. The `related_payers` Polish bundle used three words for "request" (*wniosek*, *zapytanie*, *prośba*); it now
  says *prośba* throughout, as the queue and the storefront do (settings names, the `approve` permission label, the
  request origin, two error sentences). `i18n:hardcoded` (0 regressions), `check:language`, `check:naming` green.*
- *T095 — regenerated after the rebase and after the docs move; `composer:check`, `manifests:check`, `overlay:check`
  clean.*
- *T096 — eight changesets `.changeset/182-*.md` (all `minor` but `mod-i18n` `patch`), C1–C4 = 0 in
  `check:release-intent`. `check:release-intent --since origin/master` cannot judge uncommitted work (it reports the
  branch as contained); re-run it after the commit.*
- *T097 — no tracked file deleted or renamed; the only removed file (`docs/related-payers.md`) was never committed and
  nothing references it. Derived ledgers: `test:unit:fast` (incl. `module-removal.test.ts`) green.*
- *OpenAPI baseline re-recorded after the rebase (`UPDATE_OPENAPI_BASELINE=1`), then green without it: 264 added lines,
  27 new paths, all this feature's, no deletion and no change to an existing path. Read sizes: `check-read-size.test.ts`
  green — 47 of 49 entries drift but every one is inside the band, so none is re-recorded (check-estate § *When a read
  size is re-recorded*; measured after removing the collected docs copies).*
- *T098 — `build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint` (warnings only, none in a file this feature
  touches), every `check:*` script, `test:unit:fast` (398 files / 8638 tests), `pnpm --filter '!backend' run test` (all
  green but `cli`'s known `install-wizard-tty` ×4 and `new-storefront` blocks:generate ×1), the complete backend suite in
  eight `--shard`s on the test Postgres (2330 files): red only `test/integration/search/*` ×5 in shard 1 (Meilisearch not
  configured in that shell — the whole search suite, `payer-terms-search.test.ts` included, then ran green: 23 files / 92
  tests; **RP-19 (a) seen green for the first time**), `customers/anonymization-schedule.test.ts` (shard 2) and
  `catalog/url-keys-three-levels.test.ts` (shard 3, a 30 s timeout) — each green when run alone (the latter's case
  takes 1.5 s alone). `PERF_RUN=true` T057 perf test green.*
- *T099 — **not done as written**: no manual UI walk on a running stack and no SC-005 timing. Each quickstart section
  was walked through its integration tests, all green in the complete run: §2 `admin-links`, `write-port`; §3
  `placement`, `placement-fail-open`, `paid-orders`, `paid-order-invoices`, `payer-order-email`; §4 `commercial-terms`,
  `commercial-terms-lifecycle`, `buying-for-*`, `payer-terms-surfaces`, `search/payer-terms-search`; §5 `requests`,
  `request-enumeration`, `operator-queue`, `no-account`, `invitations`, `revocation`; §6 `off-state`. The dev database
  was not migrated: it is shared with the main checkout.*

Phase 7 notes, second pass (2026-11-19, owner decisions of the day):

- *FR-021 gap closed — the *Payers* section now sets both link fields, on create and on edit, through the existing admin
  routes (each write is the `related_payers.link.create` / `link.update` Command, audited; no route, contract or
  Command changed). **Add payer**: after the payer is picked, a *Billing address* select (all of the payer's billing
  addresses, or one of them — read from the organization card's own `GET /api/v1/admin/organizations/:id/addresses`,
  filtered to `billing`) and an *E-mail the payer about orders placed and cancelled* checkbox. **Create payer
  organization**: the checkbox, and a hint that a new Organization has no billing address yet, so the link allows all.
  **Each live link**: *Change billing address* (an inline form like *Change validity*; an address the link names that is
  no longer live stays selectable, so opening the editor changes nothing) and an immediate `Switch` for the payer
  e-mails (If-Match, like every link write); the row shows *Payer e-mails on/off* to readers without `manage`. Tests
  first: `admin/test/modules/related_payers/PayersPanel.test.tsx` — five new cases, red before the change (no switch,
  no *Change billing address*, no select / checkbox in either form), green after; the no-English check now cuts the
  module's own keys before matching (a rendered key like `…editAddress` contains "Add"). Backend:
  `admin-links.test.ts` gains `FR-021: PATCH limits a link to one billing address and back to all, and switches the
  payer e-mails; each is audited` — green at once, because the API already served both fields (US1-3 named "scope"
  but never patched it). Ten keys in `related_payers` en + pl. Operator guide EN + PL: the "set through the admin API,
  no control yet" paragraph is gone, *Add payer* / *Create payer organization* name the new fields, and two bullets
  describe *Change billing address* and the e-mails switch; the operator guide re-pinned
  (`docs:translations:pin`), `check:docs-translations` 192 sources / 0 findings.*
- *Polish wording — "revoke" is **Odwołaj** everywhere (owner): the admin bundle already said *Odwołaj* / *Odwołać
  płatnika?* / *Odwołane*; the storefront said *Cofnij* / *Cofnięte* / *…zostało cofnięte.* and the
  `related_payer_link_revoked` Polish e-mail *…zostało cofnięte* (heading and body). All now *Odwołaj* / *Odwołane* /
  *…zostało odwołane*; the Polish storefront guide's *Cofnąć* / *Cofnij* became *Odwołać* / *Odwołaj*. *Prośba* is
  kept; *Wycofaj* (withdraw a request) is a different action and stays. The organization-members invitation's
  *Cofnij* is not this feature's and is untouched. Tests first, both red before the change:
  `storefront/test/account/payers.test.tsx` (*names revoking a payer link with the Polish verb the admin uses*) and
  the new `related_payers/src/backend/email-templates/request-defaults.test.ts`. The seeded e-mail default changes
  only for a database that installs the module after this change (nothing released holds the old text).*
- *Base — feature 180 (and 181) were already in the base: `origin/master` is still e15d9efc5 after `git fetch`
  (`cd277912b`, #1568, is its ancestor), so there was nothing to rebase. A fresh backup was still taken
  (`git diff HEAD --binary` + a tar of the 158 untracked files, the patch verified by applying it to `HEAD` in a
  temporary index and comparing the tree with the working tree). Checked against what 180/181 shipped: the returns
  changeset stands — an off-platform or guest case has no order, so its return context is `null` and refund / credit
  are refused before the payer could matter. While there, `creditTopupOrganizationId` was moved above
  `ReturnSettlementService`'s JSDoc, which it had split from the class.*
- *Lint: the one warning in a file of this feature (`no-explicit-any` in `test/integration/related_payers/fixtures.ts`)
  is gone.*
- *Verification (second pass): `build:packages`; `pnpm -r run typecheck`; `pnpm -r run lint` (warnings only, none in
  this feature's files); all 46 backend `check:*` / `composer:check` / `manifests:check` / `overlay:check` /
  `i18n:hardcoded` and the root `check:naming`, `check:language`, `check:pdfmake-footprint`; `test:unit:fast` (398 files
  / 8638 tests); `test/integration/related_payers` (24 files / 132 tests); integration + contract of `returns`,
  `orders`, `invoices`, `organizations` with `kernel/openapi-baseline` and `admin_users/permission-inventory` (343 files
  / 2256 tests) — the OpenAPI baseline green **without** re-recording (no route added), read sizes not re-recorded
  (`check-read-size.test.ts` green inside the band). Test database migrated (`migrate.ts up` on `b2b_test` at :5441
  only); the dev database untouched. `pnpm --filter '!backend' run test`: admin 710 files / 6699 tests, storefront 343 /
  4035, every package green but `cli`'s known `install-wizard-tty` ×4 and `new-storefront` blocks:generate ×1, and one
  `platform` case (`admin-base-url.test.ts`, "null when unset") that failed only because the shell exported the dev
  `ADMIN_BASE_URL` — green with a clean environment. The complete backend suite in ten `--shard`s on the test Postgres,
  Meilisearch configured: 2331 files (2299 run, 32 skipped), 21207 tests passed, one red —
  `integration/email/delivery-record.test.ts` expecting the console mail driver while the shell exported the dev
  `MAIL_DRIVER=smtp`; green alone without the mail variables.*
- *FR-002 defect (owner's manual test, 2026-11-20) — module on, `related_payers.enabled` off for the channel: the account
  still offered *Payers* and *Orders we pay for*, because `showsPayers` / `showsPaidOrders` read only module presence
  and permissions, while every account route answered `404` (correct). The list helpers swallow that `404` as `[]`, so
  *Payers* rendered an empty request form whose submission failed with the generic error. *Orders we pay for* already
  answered not-found (its list helper maps `404` to `null`), and the cart's *Buying for* and the checkout's *Paid by*
  already rendered nothing (`listCheckoutPayers` → `[]`). Fix: one new customer read,
  `GET /api/v1/related-payers/availability` → `{ data: { enabled } }` (`relatedPayersAvailabilityResponseSchema`,
  `200` either way, `no-store`, `503 MODULE_DISABLED` while the module is off; the `returns` guest `availability`
  precedent), read by `getRelatedPayersAvailability` (React `cache`, `false` on any failure). The account layout makes
  it only when either entry would otherwise be offered and drops both when `false`; *Payers* answers not-found before
  any list read. Tests first, red before the change: `storefront/test/account/payers-channel-off.test.tsx` (5 of 7
  cases; the two already-correct ones green) and the contract case in `related-payers.test.ts`. Backend: new
  `test/integration/related_payers/availability.test.ts` (channel override off over a global on), the route added to
  `off-state.test.ts`'s probes; both written beside the route, not observed red. OpenAPI baseline re-recorded — the one
  new path only. Layout tests that render an Administrator now mock the read (`module-presence-nav`,
  `personal-organization-pages`, `address-book`, `i18n/account-pages`), as a real fetch there hangs to the test
  timeout. Verified: storefront 344 files / 4042 tests; `test/integration/related_payers` 25 / 135; contracts and
  module suites; typecheck + lint of storefront, backend, contracts and the module; the relevant `check:*`.*
- *Storefront read defect (owner's manual test, 2026-11-20) — *Payers* crashed with `Cannot read properties of
  undefined (reading 'filter')` at `awaiting.filter`. `apiGetAuthed` already answers the envelope's `data`, and every
  read this feature added read `.data` a second time: `listCheckoutPayers`, `listPaidOrders`, `getPaidOrder`, the four
  *Payers* lists (`payerList`), `listPayeeInvitations` and `listPaymentMethodsForPayer` all answered `undefined` on a
  live backend. The backend was right (`{"data":[]}`, checked as `jan.alfa@demo.local`). No test saw it: the page
  tests replace `lib/api/related-payers` wholesale, and no test drove the helpers through the real transport.
  Fix: the helpers take `apiGetAuthed<T>` as `T`; `listPaidOrders` needs the `pagination` that `apiGetAuthed` drops, so
  it reads through the new `apiGetAuthedEnvelope` in `lib/api/mutations.ts` (the same request, answering the whole
  body; `apiGetAuthed` now delegates to it — no authenticated paginated read existed to follow).
  `getRelatedPayersAvailability`, `lookupPayerInvitation` (through `apiGet`, which answers the envelope),
  `setCartBuyingFor` and `previewOrderTotal` (through `apiMutate`) were already right. Tests first:
  `storefront/test/account/related-payers-reads.test.tsx` stubs only `fetch`, with the backend's own shapes — 9 of 11
  red before the fix (the two `404` cases already green), including the *Payers* page on empty lists (the owner's
  error verbatim) and *Orders we pay for* following its cursor to the second page; a `setCartBuyingFor` guard added
  after, green. Verified: storefront typecheck, lint (0 errors), 345 files / 4054 tests, `test/url-errors` 16 / 347,
  `check:language`.*
- *Reject in a dialog (owner, 2026-11-20) — *Payers* put a reason input beside *Reject* in every row of *Prośby
  czekające na naszą decyzję* and of the incoming invitations (both are `IncomingRequestsTable`). The row now carries
  only *Przyjmij* and *Odmów*; *Odmów* opens a `ModalDialog` (new client leaf
  `storefront/components/account/RejectPayerRequestButton.tsx`, the page and the table stay Server Components) that
  names the sender, asks for the optional reason (labelled textarea, `maxLength` = `RELATED_PAYER_COMMENT_MAX`, a hint
  that the sender sees it, focus on open), and posts `requestId` + `reason` to the unchanged
  `rejectPayerRequestAction` through `ModalDialogAction` (pending label, not dismissible in flight, a retry message on a
  transport failure; the API's refusals still arrive as `?error=`). The Polish verb is *Odmów* (was *Odrzuć*), in the
  bundle and the Polish storefront guide; states stay *Odrzucona* / *…została odrzucona*. Tests first, red before the
  change: new `storefront/test/account/payers-reject-dialog.test.tsx` (jsdom, 7 cases) and the reworded reject case in
  `payers.test.tsx`. *Odwołaj* (revoke a link) still posts from the row — a confirmation is recommended, not built.*
- *The cart's *Paid by* never appeared (owner, manual test, 2026-11-20) — T065 had put `CartBuyingForNotice` and
  `CartBuyingFor` inside the cart page's **empty-cart** branch, while `buyingForPayers` is read only for a cart with
  lines, so the control could never render (seen live as `jan.alfa@demo.local`: `listCheckoutPayers` answered Beta, the
  page had no control). T058 rendered the component alone, never the page. Fix: both moved into the cart with lines,
  above the lines and inside `CartQuantityAutosave` (a typed quantity is saved before the switch reprices); the
  empty cart shows neither. **RP-22** (owner, 2026-11-20): the control reads *Płaci* / *Paid by*, like the checkout's
  payer choice, and lists only payers on the **payer's** terms — FR-110's optional buyer's-terms shortcut is not
  offered (the checkout ignores a buyer's-terms `buyingFor` and lists those payers itself). Hint, failure and the
  checkout's fixed-payer sentence reworded EN + PL; storefront guide, overview and operator guide EN + PL name the
  control *Paid by* / *Płaci*, pins re-recorded. Tests first, red before the change: new
  `storefront/test/cart/cart-page-buying-for.test.tsx` renders the **page** (4 of 6 red: control, Polish label,
  change summary, reset notice) and `buying-for.test.tsx` gains the label and terms-filter cases (4 red). Verified:
  storefront typecheck, lint (0 errors), 347 files / 4070 tests, `check:language`, `check:docs-translations`.*
- *T099 is still not done as written (no manual walk-through on a running stack, no SC-005 timing).*

---

## Dependencies and execution order

- Phase 0 blocks everything; **T006 gates Phase 4 only**.
- Phase 1 → Phase 2 (policy port needs links) → Phase 3 (needs payer on order) → Phase 4 (needs
  placement with payer) → Phase 5 (links exist without it, but the shared `routes.customer.ts` and
  notification dispatch are built here) → Phase 6 (needs requests) → Phase 7.
- Inside a phase: every *Tests first* task before the implementation task that names it; `[P]`
  tasks touch different files and can run together.
- Migrations (T016, T031, T060) are scaffolded per owning module; `composer:generate` after each.

## FR coverage (consistency pass, spec ↔ plan ↔ tasks)

| FR | Tasks | FR | Tasks | FR | Tasks |
| --- | --- | --- | --- | --- | --- |
| 001 | T001 T010 T014 T024 T030 T052 T059 T085 | 044 | T066 T086 T088 T089 T090 T092 | 073 | T042 T043 T049 T050 |
| 002 | T007 T024 T026 T029 | 045 | T067 T074 T079 | 074 | T044 T051 |
| 003 | T002 T010 T017 T024 | 046 | T068 T070 T078 | 080 | T040 T047 |
| 004 | T014 T024 T052 | 047 | T071 T072 T076 T080 T084 | 081 | T040 T047 |
| 010 | T008 T011 T016 | 050 | T075 T076 T080 T081 | 082 | T003 T041 T048 |
| 011 | T002 T011 T016 | 051 | T038 T075 | 090 | T010 T017 |
| 012 | T007 T018 T025 T032 | 060 | T025 T026 T029 T034 T035 T058 | 091 | T014 T024 |
| 013 | T008 T011 T020 | 061 | T026 T028 T029 T035 | 100 | T009 T020 T069 T079 |
| 020 | T011 T013 T015 T018 T022 T023 | 062 | T003 T026 T033 | 101 | T015 T017 T023 T035 T050 T065 T081 T084 T092 T093 T094 |
| 021 | T011 T022 T023 | 063 | T025 T027 T032 T033 | 102 | T074 T083 T085 |
| 022 | T011 T015 T023 | 064 | T026 T033 | 110 | T004 T054 T055 T058 T060 T062 T065 |
| 023 | T073 T077 T082 T086 T090 | 065 | T026 T033 | 111 | T053 T054 T055 T061 |
| 024 | T010 T017 T077 T082 | 066 | T026 T027 T033 T034 | 112 | T054 T055 T064 |
| 025 | T073 T081 | 067 | T003 T026 T028 T031 | 113 | T004 T054 T055 T058 T062 |
| 030 | T002 T012 T021 | 068 | T026 T030 T033 | 114 | T054 T055 T062 |
| 031 | T012 T021 | 070 | T037 T038 T043 T045 T046 T050 | 115 | T053 T056 T057 T061 T063 |
| 032 | T012 T021 | 071 | T003 T037 T038 T043 T046 | 116 | T004 T055 T058 T062 T064 T065 |
| 040 | T071 T076 T080 T088 T091 | 072 | T039 T046 | 117 | T055 T056 T064 |
| 041 | T002 T070 T087 | 042 | T071 T081 T088 T091 | 118 | T009 T020 T055 |
| 043 | T066 T071 T078 T087 | | | 119 | T002 T011 T022 T055 T071 |

Success criteria: SC-001 T026 · SC-002 T070 · SC-003 T039 · SC-004 T014 (+ T030 T052 T059 T085) ·
SC-005 T099 · SC-006 T009 T012 T069 · SC-007 T026 T029 T036 · SC-008 T056 · SC-009 T056 ·
SC-010 T040 T041. Every FR in `spec.md` has at least one test task and one implementation task.
