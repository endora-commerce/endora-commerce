# Implementation Plan: Related payers

**Branch**: `feat/182-related-payers` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification `specs/182-related-payers/spec.md` (owner rulings RP-1 to RP-11 of
2026-11-18, plan accepted with RP-12 and RP-13 the same day; assumptions A-3, A-4, A-5, A-15, A-17, A-18, A-19 confirmed as written).
**Companions**: [research.md](./research.md) (decisions R-1 to R-13), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md), [tasks.md](./tasks.md).

## Summary

A buyer Organization X may name another Organization Y of the store as the **payer** of an order. A
new operator-toggleable module `related_payers` owns the X → Y link, its consent workflow (operator,
automation port, buyer request, payer invitation), its settings per sales channel, four organization
permissions, two operator permissions, notifications and an expiry worker. `orders` gains a payer on
the order (columns it owns) and makes billing follow it: Y's billing address, VAT treatment, credit
reservation and payment-method allow-list; `invoices` and `invoice_ledger` follow the order's billing
snapshot and payer; `returns` refunds and credits the payer. `carts` gains a *Buying for* context;
on a link with the payer's commercial terms the whole cart, and the catalogue the buyer browses, is
priced **for Y** by naming Y to the unchanged pricing engine — Y's own profile, Y's own cache, no new
invalidation path. Y reads the orders it pays for through one sanctioned cross-tenant port.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — all existing; **no
new runtime dependency** (research R-13)
**Storage**: PostgreSQL — two new tables (`related_payer_links`, `related_payer_requests`), four new
columns on `orders`, two on `carts` (data-model.md)
**Testing**: Vitest — module co-located `*.test.ts` (fast), `backend/test/{contract,integration}`
(complete suite), admin and storefront Vitest suites
**Target Platform**: backend API + admin SPA + Next.js storefront
**Project Type**: monorepo web application (backend, admin, storefront, packages)
**Performance Goals**: zero added database reads on catalogue pricing for an Organization with no
payer's-terms link (research R-4.4); checkout payer list ≤ 1 extra round trip
**Constraints**: Principle XI (no widened tenant filter), XII (channel-bound price lists only), XVII
(off ⇒ absent, cart falls back to buyer pricing)
**Scale/Scope**: links are few per Organization (tens); requests bounded by the daily limit

## Constitution Check

*Gate before research; re-checked after design (bottom of this section).* Constitution 4.3.0.

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular (NN)** | PASS | New module by domain ownership (R-1). Cross-module access only through three published ports and the platform slot (contracts/ports.md); `orders` → `related_payers` is `refuses-without`, `carts` → `related_payers` `degrades-without`; no import of another module's internals; detachable (off ⇒ orders/carts behave as today). |
| **II. API-first** | PASS | Every shape is a Zod schema in `packages/contracts/src/related-payers.ts` and the extended `orders.ts` / `carts` / `catalog.ts` schemas, written first (Wave 0). Additive changes only; `placeOrderRequestSchema` gains an optional field. |
| **III. TDD (NN)** | PASS | Each wave starts with failing tests (*Test strategy*); FR → test map in tasks. |
| **IV. YAGNI / deps** | PASS | No new dependency; no new cache key; no counter table; no tab-zone refactor (R-7). |
| **V. TypeScript** | PASS | — |
| **VI. Naming (NN)** | PASS | Module id `related_payers`; tables `related_payer_*`; migration class tails begin `RelatedPayers…`; permission codes `related_payers.*` (organization) and `related_payers:*` (operator); `check:naming`. |
| **VII. SEO** | PASS | Anonymous catalogue responses untouched; a payer context exists only for authenticated buyers, whose responses are already `private, no-store`. |
| **VIII. English (NN)** | PASS | Code and docs English; user-facing strings en + pl. |
| **IX. UI reuse** | PASS | Admin panel and queue built from admin-kit (`ImmediateBadge`, list/table primitives); storefront selectors reuse the checkout address components. |
| **X. Queue consumers** | PASS | Request expiry is a repeatable BullMQ job via `ctx.worker`, on the `rfq-expiry-sweep-worker.ts` pattern; notifications through the `afterCommit` outbox. |
| **XI. Tenancy (NN)** | PASS | Both new entities `@OrgScoped()`; every X/Y read is a named port method under `withSystemScope` with a predicate from a validated link (R-5 table) — including Y's billing addresses, credit reservation and payment-method allow-list at placement; Y's view of paid orders is `paidOrderReadPort`, not a widened filter; no "no-organization" path (personal Organizations are excluded, not null). Cross-tenant tests per row. |
| **XII. Channel scoping (NN)** | PASS | Settings resolved per request channel; pricing for Y uses the channel's price lists only — the engine still filters books by the request's channel, only the named Organization changes (R-4); cart snapshot carries the channel as today. A-17 confirmed against `specs/154-sales-channel-access/` FR-004/FR-007: channel access governs *requests by Y's users*, not the Organization a price is resolved for. |
| **XIII. Command Bus (NN)** | PASS | Every link/request write is a Command (contracts/commands-audit.md); audit names-only per `audit-state.md`; actor distinguishes operator / automation / customer. |
| **XIV. Extensibility** | PASS / N.A. | No "add a field" requirement. Spec 178 extension columns considered and rejected for the order's payer (R-2) because core paths must read it. |
| **XV. Untouched core / overlay** | PASS | The deployment's automation is an overlay over `relatedPayerWritePort`; core ships no project logic. |
| **XVI. Command palette** | PASS | `open-payer-requests` action on the landing route; palette-coverage test. |
| **XVII. Toggleable (NN)** | PASS | Manifest activation default off; routes/workers/subscribers via `ctx.*`; ports gated by registration; pricing slot filtered by contributor presence; off ⇒ no checkout selector, no cart *Buying for*, cart reprices for its own Organization, placements naming a payer refused, admin panel/queue/settings/palette absent, organization permissions hidden but kept. Off-state test covers deactivated-while-available. |

**Post-design re-check (after Phase 1)**: unchanged — PASS on every principle; no entry in
Complexity Tracking. The two places that most needed care are recorded as named tests: the
payment-method allow-list read for Y under system scope (fail-open without it, R-5) and the
catalogue price walk with a visible audience ≠ priced organization (R-4 spike).

## Project Structure

### Documentation (this feature)

```text
specs/182-related-payers/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── checklists/requirements.md
└── contracts/  ports.md · storefront-api.md · admin-api.md · commands-audit.md
```

### Source Code (repository root)

```text
packages/contracts/src/
├── related-payers.ts             # NEW — schemas, DTOs, port types, settings enums
├── orders.ts                     # payerOrganizationId, payer block, PaidOrderReadPort, return context
├── carts.ts                      # buyingFor, set/repricing schemas
├── catalog.ts                    # ProductAudience.pricingOrganizationId
└── errors.ts                     # five new codes

packages/platform/src/http/
└── product-audience.ts           # pricedAudienceOf + pricing-subject resolver slot

packages/modules/related_payers/  # NEW module
├── package.json, i18n/{en,pl}.json, docs/related-payers.md (+ pl translation in docs/i18n)
└── src/
    ├── manifest.ts               # activation, settings, permissions, organizationPermissions,
    │                             #   actions, transactionalEmails, dependencies, nonBinding…
    ├── migrations/               # scaffolded with migration:new --module related_payers
    ├── backend/
    │   ├── index.ts              # registerModule: services, ports, routes, worker, subscribers
    │   ├── entities/             # related-payer-link.entity.ts, related-payer-request.entity.ts
    │   ├── commands/             # one file per Command in contracts/commands-audit.md
    │   ├── services/             # link-service, request-service, policy (port), write port,
    │   │                         #   approver-resolver, link-cache, notification dispatch
    │   ├── routes.customer.ts, routes.admin.ts
    │   └── workers/request-expiry-sweep-worker.ts
    ├── admin/                    # organization.detail.after panel, queue page, labels.ts
    └── test-support/index.ts     # volatileTables

packages/modules/orders/          # payer columns + migration, placement/preview, paidOrderReadPort,
                                  #   admin filter, return context, manifest nonBinding edge
packages/modules/carts/           # buying_for columns + migration, PUT /cart/buying-for, reprice,
                                  #   pricing-subject resolver contribution, manifest edge
packages/modules/invoices/        # copy-host ledger key, admin reach/filter expression
packages/modules/returns/         # credit top-up to payerOrganizationId
packages/modules/catalog/, search/, comparisons/, price_lists/   # pricedAudienceOf at priced reads
storefront/                       # cart "Buying for", checkout payer selector, AddressSection
                                  #   read-only company fields, account: Payers, Requests,
                                  #   Orders we pay for; registration NIP prefill from invitation
backend/test/{contract,integration}/related_payers/   # complete-suite tests
```

**Structure Decision**: one new module package plus seam changes in the owning modules, per
Principle I; storefront pages under the existing account and checkout trees.

## Delivery and implementation order

**One merge request (RP-6)**, built in this order; each step lands green before the next starts.
The module ships with activation off and `related_payers.enabled` false everywhere, so the merged
tree changes nothing for an installation until an operator turns it on.

0. **Contracts and spike** — Zod schemas and port types (contracts/); error codes; the R-4 spike on
   the catalogue's priced-vs-visible audience (deleted after). Failing contract tests first.
1. **US1 + US8 — Links, operator surface, port.** Module skeleton (manifest, activation, settings,
   permissions both kinds, palette action, i18n, docs stub), entities + migrations, link Commands,
   link cache with pub/sub drop, `relatedPayerWritePort`, admin routes and the organization-card
   panel incl. registry-prefilled create, off-state test.
2. **US2 — Checkout and placement.** `orders` columns + migration; `relatedPayerPolicyPort`;
   placement and preview: payer validation, Y billing address, VAT from Y, credit on Y, Y's
   payment-method list (system-scoped), override conflict, snapshot; checkout payer list and
   payment-method catalogue variant; storefront checkout selector and read-only company fields.
3. **US3 — Payer visibility, invoices, refunds.** `paidOrderReadPort`; paid-orders routes and
   storefront pages; invoice ledger key and admin invoice reach; order admin filter and *Paid by*;
   return-context payer and credit top-up to the payer; the per-link payer order e-mail (FR-074).
4. **US9 — Payer's commercial terms.** `carts` columns + migration; `PUT /cart/buying-for` with
   repricing summary; cart-read reset (FR-116); `ProductAudience.pricingOrganizationId`,
   `pricedAudienceOf`, carts' resolver contribution; consumers switched — every priced call site of
   research R-4.8, each pricing and grossing (VAT) for Y and resolving the display mode for X
   (RP-14, FR-120), with the engine's optional display-mode organisation (R-4.7); placement
   re-check; storefront cart selector and change summary.
5. **US4 + US7 — Requests, approval, revocation.** Request Commands, anti-enumeration, daily limit,
   routing by approval mode, approver discovery, operator queue screen, e-mails and in-account
   notifications, revocation from both sides, expiry worker.
6. **US5 + US6 — No account yet, payer invitations.** `invite` / `admin` no-account modes, invitation
   e-mail with NIP prefill, attach on `organization.status_changed.v1` approval, payer-initiated
   invitations behind `payer_may_invite_buyers`.
7. **Finish** — module documentation en + pl, `composer:generate`, `manifests:generate` +
   `pnpm install --lockfile-only`, changeset, full check estate.

## Test strategy (failing test first in every step)

| Layer | Where | What it proves |
| --- | --- | --- |
| Contract schemas | `packages/contracts/src/related-payers.test.ts`, `orders.test.ts` | override conflict refinement, request body bounds, sender DTO omits counterparty |
| Unit (fast) | co-located `packages/modules/related_payers/src/**/*.test.ts` | usability rule (FR-012) table-driven; routing matrix approval × unregistered × match outcome (FR-043/044); state machines; daily-limit window (its day boundary is Phase 5's question; the link window is instants, RP-15); audit-key allowlist; repricing summary builder |
| Audit sentinels | co-located, real `CommandBus` + recording audit port | every Command records no tax ID / e-mail / comment / reason / names (`audit-state.md` §6) |
| Integration — tenancy | `backend/test/integration/related_payers/cross-tenant.test.ts` | each R-5 row: out-of-scope ⇒ 404 indistinguishable from missing; Y without permission; unrelated Z; payment-method allow-list for Y not fail-open |
| Integration — placement | `…/placement.test.ts` | SC-001 matrix (VAT payer/exempt × domestic/foreign), credit on Y not X, preview = placement, refusals of FR-068 write nothing |
| Integration — pricing | extend `backend/test/integration/carts/cart-read-equals-placement.test.ts`, `price_lists/price-surface-identity.test.ts`, `pricing-surfaces-agree.test.ts` with a payer context | SC-008: listing = search = PDP = cart = preview = order = Y's own price; X's visibility kept |
| Integration — anti-enumeration | `…/request-enumeration.test.ts` | SC-002: byte-identical replies across eligible / ineligible / ambiguous / unknown and the 429 path |
| Integration — workflow | `…/requests.test.ts`, `…/invitations.test.ts`, `…/revocation.test.ts` | US4–US7 acceptance scenarios; concurrent accept; expiry sweep; attach on registration approval |
| Off-state | `…/off-state.test.ts` | Principle XVII: routes 503, port 503, checkout/cart without payer, cart in payer context falls back to buyer pricing, admin surfaces absent, settings not editable, permissions hidden and kept, reactivation restores |
| Admin | `admin/test/modules/related_payers/*.test.tsx`, palette-coverage, permission inventory contract test | panel, queue, immediate badge, palette, labels |
| Storefront | storefront Vitest for cart selector, checkout selector, read-only company fields | RP-5, FR-061 |
| Overlay port | test-only module calling `relatedPayerWritePort` | US8 |

Iterate with `pnpm --filter backend exec vitest run <path>`; the complete suite
(`pnpm --filter backend run test`) and `pnpm --filter '!backend' run test` before the merge request
is opened, since D-198 keeps integration off the pull request (`specs/conventions/backend-test-suite.md`).

## Checks the merge request must pass

`check:module-boundary`, `check:port-dependencies` (edges and the deactivation-consequence ledger),
`check:port-catches`, `check:subscribe-seam`, `check:entry-presence`, `check:action-route-permissions`,
`check:module-docs`, `check:docs-translations`, `i18n:hardcoded`, `check:naming`, `check:language`,
the permission inventory contract test, `registered-bundles-shape.test.ts`, the tenancy
classification check, `composer:check`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Catalogue price walk assumes priced audience = visible audience | R-4 spike in step 0 — separable (2026-11-18); identity test extended before consumers switch |
| A priced call site keeps deriving the organisation from the buyer (or the display mode from the payer) | RP-14 / R-4.8 list; one assertion per call site in `payer-terms-surfaces.test.ts` (T056a) |
| A system-scoped read missed at placement fails open (allow-list) or closed (address) | R-5 table is the checklist; one cross-tenant test per row |
| Per-request cost of the pricing resolver | cache-only short-circuit (`hasPayerTermsLinks`); measured in the pricing perf test |
| One large merge request | implementation order above; each step green before the next |

## Owner confirmations of this plan (2026-11-18, recorded in `spec.md` as RP-12 and RP-13)

1. **RP-12 — "Payers" is a section** in the organization card's `organization.detail.after` panel
   stack; no tab strip (R-7).
2. **RP-13 — No new storefront invoice list.** Y sees paid-order invoices under *Orders we pay for*;
   the Admin UI invoice list and the invoice ledger list the invoice under Y (R-11).

## Complexity Tracking

No violations and no new runtime dependency. Nothing to justify.

## Handoff to `endora-commerce-dev`

Build in the order of *Delivery and implementation order*, contracts first. Binding inputs:
research R-2 (payer columns owned by `orders`, cart context owned by `carts`), R-4 (name Y to the
engine; `pricingOrganizationId` on the audience; carts contributes the resolver), R-5 (every X/Y read
is a port method under `withSystemScope` with a link-derived predicate), R-6 (edge kinds), R-7
(card section), R-8 (anti-enumeration), contracts/commands-audit.md (names-only audit). Scaffold
migrations with `migration:new`, never pick numbers; regenerate and commit generated artefacts.
