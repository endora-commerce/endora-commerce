# Research: Related payers

**Feature**: `specs/182-related-payers/` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

Each entry is *decision → rationale → alternatives rejected*. Measured facts cite the file they were
read from on `origin/master` at `663c292dc`. Rulings RP-1 to RP-11 are the spec's and are not
reopened here.

---

## R-1 — A new module, `related_payers`

**Decision.** The capability is a new core module `packages/modules/related_payers/` (id
`related_payers`). It owns the payer link, the payer request, the module's settings, its operator
and organization permissions, its notifications, the request-expiry worker, the customer and admin
routes, and two published ports (R-6). It extends `orders`, `carts`, `invoices` and `returns` only
through their own code paths and published seams; it never touches their tables.

**Rationale.** Domain ownership, not size: the link and its consent lifecycle are a relation
*between* two Organizations that no existing module owns. `organizations` owns one Organization and
its members; `orders` owns a placed order; neither owns "X may bill Y". RP-1 requires the capability
to be operator-toggleable on its own (Principle XVII); a module is the unit of that toggle.

**Alternatives rejected.**
- *Extend `organizations`.* It is `nonDeactivatable` (it is tenancy), so RP-1's toggle would be a
  flag inside a module that cannot be switched off — the "patched with a flag" shape Principle XVII
  forbids. It would also grow a module that is already the most depended-upon in the tree.
- *Extend `orders`.* The request/approval/invitation flow (US4–US7) has nothing to do with a placed
  order and would make `orders` own notifications to organizations that never ordered.
- *An overlay.* RP-1 calls it a generic Core feature; the overlay is the *consumer* of the port.

## R-2 — Where the payer lives on the order (settles spec A-13)

**Decision.** `orders` owns four new nullable columns on `orders`: `payer_organization_id`,
`payer_link_id`, `payer_terms` (`buyer` | `payer`) and `payer_snapshot` (jsonb). They are core
columns of the `Order` entity, written only by placement, read by `orders` itself (detail, list,
filter, return context, the invoice copy host) and published on the order's contract shapes.

**Rationale.**
1. The payer is read by core paths that must keep working with `related_payers` off: the order
   detail, the invoice buyer (`invoice-service.ts` builds `buyerSnapshot` from
   `order.billingAddress`), the invoice-ledger client key (`invoice-copy-host.service.ts:52`
   returns `order.organizationId`), the return settlement's credit top-up
   (`return-settlement-service.ts:579` uses `rc.organizationId`). Spec FR-004/FR-051 require placed
   orders to keep their payer as order data when the module is off.
2. `specs/178-extensible-columns/` columns are, by its own rulings, **inert while the declaring
   module is off** and **never read by a core path** (`specs/conventions/module-activation.md`, the
   paragraph on extension columns). Both properties are the opposite of what R-2.1 needs.
3. "Bill-to party" is a generic order concept (an ERP connector or an overlay could set it); naming
   it *payer* on the order, rather than *related payer*, keeps `orders` free of the link concept.

**Alternatives rejected.**
- *Extension columns `x_related_payers_*` on `orders` (spec 178).* Rejected for R-2.2: invoices,
  returns and the ledger would read a module-private column, which 178 forbids, and the order would
  lose its payer the moment the module was switched off.
- *A side table `related_payer_order_links` owned by `related_payers`.* Same defect as the above
  (off ⇒ invisible), plus every order read that shows the payer would need a cross-module join or a
  port call per order.

## R-3 — Where the "Buying for" context lives on the cart

**Decision.** `carts` owns two nullable columns on `carts`: `buying_for_organization_id` and
`buying_for_terms` (`buyer` | `payer`). Set through a new carts route, validated against
`relatedPayerPolicyPort` (R-6) on every write and every read; cleared (and the cart repriced) when
the policy no longer vouches for it (FR-116).

**Rationale.** RP-10 puts the choice on the cart; the cart prices its own lines
(`carts/src/backend/services/cart-line-pricing.ts`, `cart-pricing-recompute.ts`) and must know the
pricing subject without a cross-module read per line. `carts` is not a custom-field host, so spec
178 is not available anyway.

**Alternatives rejected.**
- *On the customer session.* The owner ruled "on the cart"; a session value also outlives the cart
  it priced and has no row to audit or approve (cart approval, `specs/170-organization-roles/` OR-3).
- *In `related_payers` keyed by cart id.* Cart pricing would need a port call before every
  recompute and the context would survive cart completion unless `related_payers` subscribed to
  cart events — two owners of one fact.

## R-4 — Pricing for the payer without a new invalidation path (FR-110 to FR-117, SC-008)

**Measured.** The pricing engine is *named* a buyer: `PricingResolutionInput.context.organization`
plus `customerAccountId` (`price_lists/src/backend/services/pricing-service.interface.ts`), and it
applies `customerGroupId ?? account's group (when the account belongs to the organization) ??
organization's group`. The profile and the answer cache are keyed by (organization chain, group,
channel, currency) (`specs/pricing/current-model.md` § *Caching and invalidation*). Catalogue
consumers derive the named organization from `ProductAudience` (`packages/contracts/src/catalog.ts`
§ `ProductAudience`), built from the actor by `productAudienceOf`
(`packages/platform/src/http/product-audience.ts`) and turned into a priced organization by
`viewerOrganizationFor` (`catalog/src/backend/services/viewer-organization.ts`), whose header warns
that two derivations of "who is asking" on one page is two chances to disagree.

**Decision.**
1. **The engine is named Y; nothing about the engine changes.** In a payer's-terms context every
   pricing consumer names `organization = Y` (with Y's customer group) and `customerAccountId =
   null`. The profile is *Y's own profile* — the one Y's users already hit — so the existing cache
   key, the existing `PricingGeneration` bumps and the existing price surface cover it. **No new
   cache key, no new invalidation event, no new surface profile.** Passing `customerAccountId:
   null` settles spec A-18 by construction: an X user's personal group cannot reach Y's prices.
2. **`ProductAudience` gains `pricingOrganizationId?: string | null`** — "the Organization prices
   are resolved for; absent means `organizationId`". Visibility keeps reading `organizationId` (X):
   `isProductVisibleTo` is untouched, so what X may see stays X's (spec edge case *A product is not
   visible to Y*).
3. **One resolver fills it, at the request edge.** `@endora-commerce/platform/http` gains
   `pricedAudienceOf(request): Promise<ProductAudience>` beside `productAudienceOf`, which asks a
   host-held **pricing-subject resolver slot** (zero or one contributor, filtered by the
   contributor's effective presence at call time — the contribution-sink discipline of
   `packages/platform/src/kernel/contribution-sinks.ts`). `carts` contributes the resolver: for a
   customer actor on the request's channel it reads the active cart's `buying_for_*`, asks
   `relatedPayerPolicyPort.pricingContext(…)` and returns Y or nothing. Every catalogue-pricing
   route (catalog list/detail/links, search, suggestions, comparisons, `price_lists`' storefront
   reads) switches from `productAudienceOf` to `pricedAudienceOf`, and `viewerOrganizationFor` reads
   `pricingOrganizationId ?? organizationId`. The derivation stays one.
4. **Cost.** The resolver short-circuits to "nothing" without a database read unless (a) the
   capability is enabled on the channel and (b) the actor's Organization holds at least one
   payer's-terms link — both answered from `related_payers`' per-process cache (R-9). An
   Organization with no such link pays nothing per request.
5. **Order placement** reads the cart's context directly (it already loads the cart) and re-asks the
   policy port inside the placement transaction (FR-116, FR-117). `cart-read-equals-placement` gains
   a payer-context case (SC-008).

**Alternatives rejected.**
- *A client-supplied header naming Y on catalogue requests.* The client would choose the pricing
  subject; every consumer would have to validate it, which is N derivations of "who is asking".
- *Each consumer calls a carts port.* Five or more new cross-module edges and five derivations —
  exactly what `viewer-organization.ts` warns against.
- *Substitute inside the pricing engine* (a `price_lists` registry carts contributes to, keyed by
  account + channel). One place, but a hidden input: every caller that names an account — admin
  order creation, the API intake, quick-order import — would silently switch to Y's prices while
  RP-11/A-6 say those paths have no payer.
- *A dedicated "payer" price profile per (X, Y).* A new cache key and a new surface population per
  link — the new invalidation path the brief asked to avoid — for prices that are by definition Y's.

**Verify in implementation (Phase 0 spike, not left in the tree).** The catalogue's price-sorted walk
reads the surface of the *priced* profile while visibility is applied for the *visible* audience;
confirm the two inputs are separable in `catalog-query.service.ts` (§ "What a price walk reads once
per page") and extend `price-surface-identity.test.ts` with a viewer whose two differ.

**Spike result (2026-11-18, T006, on `feat/182-related-payers` at `663c292dc` + Phase 0
contracts; spike code deleted, never committed). Verdict: separable — Phase 4 proceeds as
planned, with the additions below.**

- *What was changed for the spike.* `ProductAudience.pricingOrganizationId` (T005) was read in
  exactly two places: `viewerOrganizationFor` priced `pricingOrganizationId ?? organizationId`
  (`catalog/src/backend/services/viewer-organization.ts:33`), and `#viewerPricingContext` used that
  organisation and named `customerAccountId` only when the priced organisation is the buyer's own
  (`catalog-query.service.ts:933–950`). A test-only request header stood in for `pricedAudienceOf`
  in `routes.public.ts`. Nothing in `price_lists` was touched.
- *Why it separates.* The walk derives its pricing context **once per page** from the audience
  (`#priceWalkScope` → `#viewerPricingContext`, `catalog-query.service.ts:1488`, `:933`) and hands
  only that context to `orderByUnitPrice` (`:1528` → `price_lists/…/pricing-service.ts:397`), which
  knows nothing of visibility. Visibility is applied page-side with `ctx.audience`
  (`isProductVisibleTo(…, ctx.audience)`, `:2066`, and the SQL availability scope), which never
  reads the new field. Every read the engine makes for Y is tenant-unfiltered: `Organization` is
  `@GlobalEntity` (`organizations/…/organization.entity.ts:47`), every `price_lists` entity is
  `@RuleScoped`, the org chain comes from `organizationInheritancePort.priceListOrgChain`
  (`book-pricing.ts:483`). So X's ambient tenant context does not hide Y's books.
- *Measured* (throwaway integration test over `price-sort-fixture.ts`: org A and org B with opposite
  book prices, `DELTA` restricted to A; HTTP `GET /api/v1/catalog/products?sort=price`):
  B priced as A answered `ALPHA 10, BETA 90, GAMMA (tail)` — A's own listing minus `DELTA`, equal
  item for item and price for price; descending, a one-row keyset walk and a `minPrice=5&maxPrice=50`
  range all agreed. A priced as B kept `DELTA` (visible to A) at the price B's profile gives it
  (channel 55): `BETA 10, DELTA 55, ALPHA 90, GAMMA`. `price_profiles` held 3 rows before and after
  the B-as-A walks and the surface producer was asked for **0** rebuilds — the walk read Y's existing
  profile, no new key. With Y's buyer profiles deleted, the walk answered live and the next surface
  pass rebuilt Y's **own** profile, after which the walk was unchanged. Re-run green with the spike
  in place: `price-surface-identity.test.ts` (11), `pricing-surfaces-agree.test.ts` (2),
  `catalog/price-sort-visibility.test.ts` (5), `catalog/price-sort-viewer-scope.test.ts` (12),
  `price_lists/customer-own-group-every-path.test.ts` (5).
- *A-18 holds twice.* Even a leaked `customerAccountId` cannot apply X's user's own group to Y:
  `effectiveCustomerGroupId` applies an account's group only when the account belongs to the priced
  organisation (`price_lists/…/pricing-service.ts:235`). Passing `null` (decision 1) remains the rule.
- *Surprise — more derivations of "who is priced" than decision 3 lists.* Each reads
  `audience.organizationId` on its own and must switch to the priced organisation in Phase 4, or a
  page disagrees with itself:
  `catalog/src/backend/routes.public.ts:219` (`priceControlsAvailable` — the page display mode is
  resolved for X while the service, once switched, resolves it for Y; a payer whose mode is `none`
  and a buyer whose mode is not would disagree on whether price sort is offered);
  `routes.public.ts:181` (`withVatRates` — the listing's VAT rate is X's, while FR-064 computes
  checkout tax from Y's VAT status: **needs an architect/owner decision** whether listing grosses in
  a payer's-terms context use Y's rate);
  `catalog/…/product-link.service.ts:422` (cross-sell tiles); `search/…/search-query.service.ts:540`
  and `search/…/suggestion-pricing-enricher.ts:56–68` (hits and type-ahead, each its own copy of
  `viewerOrganizationFor`); `comparisons/…/comparison-service.ts:316`;
  `price_lists/…/routes.storefront.ts:70` (`pricingViewerOf`); and the cart upsells
  (`carts/…/routes.ts:904`). Search never orders by price (the index carries no price), so only its
  per-hit pricing needs the switch.
- *Consequence for Phase 4.* No change to R-4's design: no new cache key, invalidation path or
  surface profile. Add the derivations above to the Phase 4 consumer switch (one assertion per
  surface in the SC-008 equality), and settle the VAT-rate question before T060.

**Owner ruling RP-14 (2026-11-18) — settles the spike's open question, and amends decisions 1 and 3.**

6. **Two organisations per priced read, each with one job.** In a payer's-terms context a
   price-carrying read takes the **priced** organisation `pricingOrganizationId ?? organizationId`
   (Y) for the price **and the VAT rate** (Y's VAT status and country — the rate checkout applies,
   FR-064), and the **buyer** `organizationId` (X) for the **display mode** (X's organization
   override, else the settings default; product and category steps keep their precedence) and for
   visibility. Y's organization-level display mode is never read, so Y's `none` does not hide prices
   from X — accepted because only an operator or the port enables the payer's terms (RP-11).
7. **This is the one engine change** (amends decision 1, "nothing about the engine changes"): the
   price-book engine resolves the display-mode tail for `viewer.organizationId`
   (`price_lists/…/book-pricing.ts:459` `#viewerMode`, used for the withheld arm and for
   `orderable` in `price-surface.ts:210`). `ListingPriceViewerContext` gains an optional
   `displayModeOrganization` that `#viewerMode` and `pageDisplayMode` read when present, absent
   meaning `organization`. It is not part of the profile key or the answer-cache key (the viewer
   mode is applied after the cache, `book-pricing.ts:316–326`), so it adds no cache key and no
   invalidation path; the viewer-mode memo is already keyed by the organisation it is asked for.
8. **The call sites** (amends decision 3's list), each switched in Phase 4 with its own assertion:
   catalogue listing and price sort including `priceControlsAvailable` (display mode → X) and
   `withVatRates` (VAT → Y) in `catalog/…/routes.public.ts`; the product page; cross-sell tiles
   (`product-link.service.ts`); search hits (`search-query.service.ts`) and type-ahead
   (`suggestion-pricing-enricher.ts`); comparisons (`comparison-service.ts`); the storefront price
   and display-mode endpoints (`price_lists/…/routes.storefront.ts`); cart upsells
   (`carts/…/routes.ts`); and the cart's own line VAT rate and grosses (`carts`, T062).

## R-5 — The payer's cross-tenant reads (Principle XI)

**Measured.** `Order` is `@OrgScoped()` (`orders/src/backend/entities/order.entity.ts:18`), `Invoice`
is `@TransitivelyScoped('Order', 'orderId')`, `Address`, `CreditLimit` and
`OrganizationPaymentMethodLink` are `@OrgScoped()`. `AddressReadService.findById(orgId, id)` filters
by `organizationId` **and** runs under the ambient org filter (`addresses/src/backend/services/address-ports.ts`).
`withOrgScope` is host-only (D-285); a module widens with `withSystemScope(reason, fn)` and constrains
by `organizationId` itself (`specs/conventions/module-composition.md` item 10a).

**Decision.** Every read across the X/Y boundary is one named method on an owning module's port,
running under `withSystemScope('<module>: <reason>', …)` with an explicit organization predicate
that came from a **validated link**, never from the request:

| Read | Who asks | Owner and method | Predicate |
| --- | --- | --- | --- |
| Y's allowed billing addresses (checkout list, preview, placement) | orders, related_payers | `relatedPayerPolicyPort.payerBillingAddresses` → `addressReadPort` under system scope | link usable for (X, user, channel); address ∈ link scope, `organizationId = Y`, live, kind billing |
| Y's credit reservation | orders | existing `creditLimit.reserve({ organizationId: Y })`, called under system scope | `organizationId = Y` from the validated link |
| Y's payment-method allow-list | orders | `assertMethodsAllowedForOrganization({ organizationId: Y })` under system scope | as above — **without** the scope the `@OrgScoped` link read returns no rows, which reads as "no restriction": fail-open, so this is a named test |
| Orders Y pays for | related_payers | new `paidOrderReadPort.list/find` (owner `orders`) | `payerOrganizationId = Y`; DTO is read-only |
| Invoice documents of a paid order (Y) | related_payers | `invoiceReadPort` by order id, after the order passed `paidOrderReadPort.find` | `orderId` |
| Links / requests naming Y as counterparty | related_payers | own service, `listAsPayer` / `listIncoming` | `payerOrganizationId = Y` / `counterpartyOrganizationId = Y` |

Every out-of-scope answer is the module's existing 404 (FR-072); each row ships a cross-tenant test.

**Alternatives rejected.**
- *Widen Y's tenant context to include X* (an "allowed set"). That is the tenant filter doing the
  cross-tenant read, which RP-2 forbids, and it would expose *all* of X's orders, not those naming Y.
- *Copy the order to Y.* Two records of one sale; every status change would need mirroring.
- *Put payer visibility into `OrderAccessService`.* That service is the buyer's scope rule; adding a
  second organization and a foreign permission code to it couples `orders` to `related_payers`'
  permission vocabulary. The payer path is `related_payers`' route over a narrow `orders` port.

## R-6 — Ports

**Decision.** Three published ports, typed in `packages/contracts/src/related-payers.ts`:
- `relatedPayerPolicyPort` (owner `related_payers`) — `usablePayers`, `assertUsable`,
  `payerBillingAddresses`, `pricingContext`, `hasPayerTermsLinks`. Consumed by `orders` and `carts`.
- `relatedPayerWritePort` (owner `related_payers`) — `addPayer`, `revokePayer`; for overlays (FR-030).
- `paidOrderReadPort` (owner `orders`) — `list`, `find`; consumed by `related_payers` only.

Manifest edges: `orders` → `related_payers` is `nonBindingDependencies` kind **`refuses-without`**
on `relatedPayerPolicyPort` ("an order naming a payer cannot be placed; every other order is
unaffected") — the `credit_limits` entry in `orders/src/manifest.ts:243` is the precedent. `carts` →
`related_payers` is **`degrades-without`** ("the cart prices for its own Organization"). The pricing
resolver contribution is `contributes-to` the platform slot. `related_payers` → `orders`,
`organizations`, `addresses`, `settings`, `sales_channels` are `dependencies`; → `invoices`,
`customer_notifications`, `admin_notifications`, `transactional_emails` are `degrades-without`.

**Rationale.** `orders` must not bind on an optional module (a bind would make `related_payers`'
toggle a dead switch for anyone with orders); placement *with a payer* is precisely the operation
that stops.

## R-7 — The organization card's Payers section (settles spec A-14)

**Measured.** `OrganizationDetail.tsx` (`organizations/src/admin/pages/`) has no tab strip; it ends
with `<AdminZone name="organization.detail.after" props={{ organizationId, saveSession }} />`
(l. 1019). Tab-strip zones exist elsewhere (`order.entry.tabs`, `ledger.section.tabs`, rendered by
`<RouteTabsZone>`), whose contract says *fewer than two tabs is not a choice*.

**Decision.** `related_payers` contributes a **Payers** panel to `organization.detail.after`, gated
on `related_payers:read`, carrying `ImmediateBadge` and no save participant (spec FR-022). The panel
has an anchor (`#payers`) the palette and order detail link to.

**Alternatives rejected.**
- *Add `organization.detail.tabs` and refactor the card into tabs.* It reshapes a host every other
  contributor (quick-order defaults, carts' policy panel, custom fields) renders into, for one new
  contributor, and the tab-zone contract refuses a one-tab strip. If the owner wants the card tabbed,
  that is an `organizations` change with its own scope.
- *A separate route `/organizations/:id/payers`.* A second page for one card's relations; operators
  would have to leave the card to see who pays.

**Owner confirmed (2026-11-18, RP-12).** A section in the panel stack, no tab strip.

## R-8 — Anti-enumeration and the daily limit (FR-041, FR-046, SC-002)

**Decision.** Every request/invitation submission creates a request row owned by the **sender**
regardless of the lookup outcome, and answers `202 { data: { id, state: 'pending' } }` — the id is
the sender's own row, so it leaks nothing. The daily limit is a count of the sender's rows created
since local midnight in the store time zone, checked **before** the tax-ID lookup, answering `429
RELATED_PAYER_REQUEST_LIMIT`. All side effects (e-mails, notifications, operator-queue entries) are
dispatched by the Command's `afterCommit` outbox (`specs/176-command-hooks-outbox/`), so response
time does not depend on whether an e-mail was sent. The sender's DTO never carries
`counterpartyOrganizationId`, `routing` or `operatorReason`.

**Alternatives rejected.** *`@fastify/rate-limit`* (already in `packages/platform/src/http/server.ts`):
per-client and per-process, not per-Organization per day; *a counter table*: a second fact beside the
rows it counts.

## R-9 — Per-process link cache with pub/sub drop

**Decision.** `related_payers` keeps a per-process cache keyed by buyer Organization: its usable
links (payer, terms, scope, window). Dropped on every link Command's commit (publish on
`b2b:related_payers:links-changed`, every process drops the key), on `organization.status_changed.v1`
for either party, and by a 60 s TTL as the degraded bound. Placement never trusts the cache: it
re-reads the link inside its transaction. This is the 154 per-Organization cache shape
(`specs/154-sales-channel-access/research.md` R-16).

## R-10 — Notifications, i18n, documentation

**Decision.** Transactional e-mails declared in the manifest (`related_payer_request_received`,
`related_payer_request_decided`, `related_payer_invitation_to_register`, `related_payer_link_revoked`,
`related_payer_order_placed`), each with en + pl defaults; in-account notifications through
`customerNotificationRecordPort`; operator queue notifications through `adminNotificationRecordPort`.
Approver discovery reuses the cart-approval precedent: `organizationPermissionPort.rolesHolding(Y,
'related_payers.approve')` then members holding those roles
(`carts/src/backend/services/cart-approval-emails.ts`). Enum labels through `defineEnumLabels` in
`src/admin/lib/labels.ts` (`specs/conventions/module-i18n.md`). A module page
`packages/modules/related_payers/docs/related-payers.md` in en and pl
(`specs/conventions/module-documentation.md`).

## R-11 — Refund target and the invoice (RP-7, RP-8)

**Measured.** Platform invoices carry no `organizationId`; their tenant is the order's
(`@TransitivelyScoped('Order', 'orderId')`), and `buyerSnapshot` is built from
`order.billingAddress` (`invoice-service.ts`). There is no customer-facing list of platform invoices:
a buyer reaches them per order; `/api/v1/account/organization/invoices` lists ERP-imported documents
only (`invoices/src/backend/routes.customer.ts`).

**Decision.**
- The order's billing snapshot is Y's, so the invoice's buyer snapshot is Y's with **no invoices
  change**. The invoice-ledger key becomes `order.payerOrganizationId ?? order.organizationId` in
  `invoice-copy-host.service.ts` (FR-081). The admin invoice list's organization reach and filter use
  the same expression, so the invoice is listed under Y (RP-8 "its invoice list" on the operator side).
- The buyer keeps the per-order document download it has today (RP-8's read-only download); Y gets
  the same download through `related_payers`' paid-order route (R-5).
- `orders`' return context (`order-return-context.ts`) publishes `payerOrganizationId`; the return
  settlement credits `payerOrganizationId ?? organizationId` (RP-7). A money refund goes back to the
  original payment, which the payer made; a correction follows the invoice.

**Owner confirmed (2026-11-18, RP-13).** Because no customer list of platform invoices exists, Y's
"invoice list" on the storefront is the paid-orders view with its documents; no storefront invoice
list is created by this feature.

## R-12 — Settings per channel

**Decision.** Six settings in the manifest with a global value and a sales-channel override, read
through `settingsReadPort` for the request's channel (`specs/conventions/module-composition.md`
item 6), precedent `orders.min_order_value` (`orders/src/manifest.ts`): `related_payers.enabled`
(false), `.approval_mode` (`payer`), `.unregistered_payer_mode` (`admin`),
`.payer_may_invite_buyers` (true), `.request_ttl_days` (30), `.daily_request_limit` (10). The request
captures the two mode values at creation (spec edge case *A setting changes while requests are
pending*).

## R-13 — No new runtime dependency

Everything above uses what the tree has: MikroORM, Zod, BullMQ (expiry worker on the
`quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` pattern), ioredis pub/sub, the
registry lookup in `organizations/src/backend/registry-lookup/`, the existing invitation flow.
