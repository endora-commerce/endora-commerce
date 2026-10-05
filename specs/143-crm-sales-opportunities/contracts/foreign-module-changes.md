# Contract: every file this feature changes outside `packages/modules/crm/`

**Feature**: `specs/143-crm-sales-opportunities/`

CRM must be detachable (Principle I) and absent when off (Principle XVII), and `orders` and
`quote_requests` must never import it. This page is the complete list of what changes outside
the module's own directory, why each change is generic rather than CRM-specific, and which
story carries it. **A file not on this page is not touched by this feature**; an implementer
who finds a need to touch one stops and reports it.

The test for every row: *delete `packages/modules/crm/` and regenerate — does the platform
still compile, boot and pass its suites?* Yes for every row; the last column says what is left
behind.

## A. Shared contracts and the host — additive

| # | File | Change | Story | Left behind if CRM is removed |
| --- | --- | --- | --- | --- |
| A1 | `packages/contracts/src/crm.ts` (**new**) | all CRM Zod schemas, port and event types | Foundational | an unused contract file — delete with the module |
| A2 | `packages/contracts/src/index.ts` | `export * from './crm.js';` | Foundational | one line |
| A3 | `packages/contracts/src/admin-contributions.ts` | add `'crm'` to `AdminNavSectionNameSchema` | Foundational | an enum member no module joins — harmless, the shell hides an empty section |
| A4 | `packages/admin-shell/src/components/AppShell.tsx` | add `{ key: 'crm', labelKey: 'appShell.section.crm', items: [] }` to `NAV`, after `sales` | Foundational | an empty, never-rendered section |
| A5 | `packages/modules/_i18n/i18n/en.json`, `pl.json` | `"appShell.section.crm": "CRM"` in both | Foundational | one unused key per language |
| A6 | `packages/contracts/src/common.ts` | `OriginReferenceSchema` / `OriginReference` | US10 | a generic schema with two users |
| A7 | `packages/contracts/src/errors.ts` | the `CRM_*` members — **only if** minting requires it (admin-api.md §13) | Foundational | unused members |
| A8 | `scripts/check-naming.sh` | `crm` added to `allowed_proper_noun` — the id is an acronym, not a plural, and the check refuses it otherwise (research N-1) | Setup | one allow-list word naming no folder |
| A9 | `backend/package.json` | `"@endora-commerce/mod-crm": "workspace:*"` — the generated registries import the package by bare specifier and no generator writes this line (research N-2) | Setup | a dependency on a missing member; remove with the module |

A3–A5 are the owner's navigation ruling of 2026-10-05 (research R-19). They are a **host**
change: the section belongs to the shell, CRM contributes entries to it. Recorded follow-up:
if the group ends up with one or two links, the owner will have them moved to `sales`, and
A3–A5 are then reverted.

## B. `orders` — one optional, opaque pass-through (US10 only)

| # | File | Change |
| --- | --- | --- |
| B1 | `packages/contracts/src/orders.ts` | `adminCreateOrderRequestSchema` gains `origin: OriginReferenceSchema.optional()`; the `order.created.v1` payload type gains `origin?: OriginReference` |
| B2 | `packages/modules/orders/src/backend/routes.ts` | `POST /api/v1/admin/orders` forwards `body.origin` to the creation service |
| B3 | `packages/modules/orders/src/backend/services/order-creation-admin-service.ts` | `AdminCreateOrderInput.origin?`; passed to `placeOrder` |
| B4 | `packages/modules/orders/src/backend/services/order-service.ts` | `placeOrder(ctx, req, options?: { origin?: OriginReference })`; the `order.created.v1` emit spreads `origin` when present; the local `Events` map type follows |
| B5 | `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx` | read `originType`, `originId`, `customerAccountId` from the query string; preselect the customer; send `origin` |
| B6 | `packages/modules/orders/docs/orders.md` (+ Polish copy) | document `origin` on the event and the endpoint |

Rules that keep this generic:

- **`orders` never interprets `origin`.** Not persisted, not validated beyond shape, not
  branched on. It is `{ type: string, id: uuid }`.
- **The storefront cannot set it.** `origin` is on the *admin* create schema only; the public
  `PlaceOrderRequest` schema and `OrderPlacementPort.placeOrder(ctx, req)` are unchanged. B4's
  third parameter is on the service method, not on the published port.
- **No behaviour changes when it is absent**, which is every call today.
- **Tests owed in `orders`** (red first): the event carries `origin` when the admin request
  did, and carries no `origin` key when it did not; a storefront placement body containing
  `origin` does not reach the event.

## C. `quote_requests` — the same pass-through, plus the event the admin path lacks (US10 only)

| # | File | Change |
| --- | --- | --- |
| C1 | `packages/contracts/src/quote-requests.ts` | `adminCreateQuoteRequestSchema` gains `origin: OriginReferenceSchema.optional()`; export the `rfq.created_by_admin.v1` payload type |
| C2 | `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` | `createOnBehalf` emits `rfq.created_by_admin.v1 { rfqId, organizationId, adminUserId, origin: origin ?? null }` after its write |
| C3 | `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx` | read the same three query parameters; preselect the customer; send `origin` |
| C4 | `packages/modules/quote_requests/docs/quote_requests.md` (+ Polish copy) | document the new event |

Why a **new** event rather than emitting `rfq.created.v1` from the admin path: that event is
emitted by the customer path only today (`rfq-service.ts`), and whatever already subscribes to
it would start seeing admin-created requests — a behaviour change in `quote_requests` with CRM
off, which FR-070 forbids. A new event name has no existing subscriber by construction.

**Tests owed in `quote_requests`**: `createOnBehalf` emits the event exactly once with the
given `origin`, and with `origin: null` when none was sent; `rfq.created.v1` is still not
emitted on that path.

## D. Generated artefacts — regenerated, never edited

Regenerate and commit in the same change that adds or moves anything they are derived from
(`AGENTS.md` § traps; `specs/conventions/module-migrations.md`).

| Command | Artefacts it rewrites |
| --- | --- |
| `pnpm --filter backend run manifests:generate` | `packages/modules/crm/package.json`; `admin/package.json` (the admin's dependency on `@endora-commerce/mod-crm`, once `src/admin/` exists) |
| `pnpm install --lockfile-only` | `pnpm-lock.yaml` — always run beside the line above |
| `pnpm --filter backend run composer:generate` | `backend/src/db/migrations-registry.generated.ts`, `backend/src/db/entities-registry.generated.ts`, the generated manifest index (`manifest-index.generated.ts`), `admin/src/modules.generated.ts`, `docs/sidebars.modules.generated.js`, `docs/docs/modules/module-map.generated.md`, and the composition artefacts the script lists in its own output |

The set of artefacts is the generator's to state, not this table's: read what
`composer:generate` reports it wrote and commit exactly that. `pnpm --filter backend run
composer:check`, `manifests:check` and `overlay:check` are the proofs.

## E. Test harness and ledgers — only where a check asks

| File | When |
| --- | --- |
| `backend/test/helpers/package-entities.ts` | when an integration test needs a CRM entity class by name (the harness's sanctioned door to a packaged module's entities) |
| `backend/test/fixtures/error-code-routing/…`, `backend/test/unit/_i18n/error-code-migration-progress.test.ts` | if minting the `CRM_*` codes moves those ledgers (commit `512b68e84` is the worked example) |
| `backend/test/fixtures/openapi-baseline.json` | every story that adds a route: regenerate with `UPDATE_OPENAPI_BASELINE=1` and review the diff (`backend/test/contract/kernel/openapi-baseline.test.ts`) |
| `backend/test/unit/tenancy/transitive-parent-chains.test.ts` | the population of `@TransitivelyScoped` classes is asserted as a set; the seven CRM child classes joined it with their entities |
| a recorded read size under `backend/` | **only** an entry whose band refuses the new file count; drift inside a band is left for the release pull request (`specs/conventions/check-estate.md` § *Measuring a read size* — read it first) |
| `docs/i18n/pl/…` | the Polish copy of every docs page this feature writes or edits |
| `docs/translation-cache/pl/…`, `docs/i18n/pl/docusaurus-plugin-content-docs/current.json` | the translation-cache entry beside every Polish copy, the generated reference page and module-map row in Polish, and the `sidebar.main.category.crm` id (research N-10) |
| `docs/docs/module-reference/crm.md` | generated by `composer:generate` and committed, as every module's reference page is |

No `root-dispositions.json` entry is owed for `specs/143-crm-sales-opportunities/`: that check
was retired from the canonical tree (the header of `backend/scripts/lib/root-dispositions.ts`
says so, and its record file is not in this repository).

## F. Explicitly **not** changed

- No column, table or migration of another module.
- No import of `@endora-commerce/mod-crm` by any other module package; `orders` and
  `quote_requests` gain no manifest edge to `crm`.
- No new zone in `AdminZoneNameSchema`: CRM contributes to the existing
  `organization.detail.after` only.
- No change to `OrderTransitionPort`, `OrderStatusActor`, `QuoteRequestReadPort`,
  `supportedEntityTypeSchema` or `KnownIconNameSchema`.
- No new runtime dependency in any `package.json` (the generator may add *existing* workspace
  packages and already-used third-party peers to `mod-crm`'s own manifest; that is derivation,
  not a new dependency).
