# Contract: every file this feature changes outside `packages/modules/crm/`

**Feature**: `specs/143-crm-sales-opportunities/`

CRM must be detachable (Principle I) and absent when off (Principle XVII), and `orders` and
`quote_requests` must never import it. This page is the complete list of what changes outside
the module's own directory, why each change is generic rather than CRM-specific, and which
story carries it. **A file not on this page is not touched by this feature**; an implementer
who finds a need to touch one stops and reports it.

**Reconciled with the tree on 2026-10-06** (branch `po/143-crm`, merge base `dc8daa72f`).
The oracle is

```bash
git diff --stat $(git merge-base origin/master HEAD)..HEAD -- . \
  ':!packages/modules/crm' ':!specs' ':!backend/test' ':!admin/test' ':!docs' \
  ':!.changeset' ':!pnpm-lock.yaml'
```

which names **55 files**: every one of them is a row below, and every production file a row
names is among them — except the three rows that say in so many words that nothing was edited
(B2, G7, H5). Tests, docs mirrors and changesets, which that command leaves out, are §E.

The test for every row: *delete `packages/modules/crm/` and regenerate — does the platform
still compile, boot and pass its suites?* Yes for every row; the last column says what is left
behind.

## A. Shared contracts and the host — additive

| # | File | Change | Story | Left behind if CRM is removed |
| --- | --- | --- | --- | --- |
| A1 | `packages/contracts/src/crm.ts` (**new**), `packages/contracts/src/crm.test.ts` (**new**) | all CRM Zod schemas, port and event types; the co-located test of those schemas | Foundational | an unused contract file and its test — delete with the module |
| A2 | `packages/contracts/src/index.ts` | `export * from './crm.js';` and the comment above it | Foundational | two lines |
| A3 | `packages/contracts/src/admin-contributions.ts` | add `'crm'` to `AdminNavSectionNameSchema` | Foundational | an enum member no module joins — harmless, the shell hides an empty section |
| A4 | `packages/admin-shell/src/components/AppShell.tsx` | add `{ key: 'crm', labelKey: 'appShell.section.crm', items: [] }` to `NAV`, after `sales` — ten lines with the comment that says why the section is the host's | Foundational | an empty, never-rendered section |
| A5 | `packages/modules/_i18n/i18n/en.json`, `pl.json` | `"appShell.section.crm": "CRM"` in both | Foundational | one unused key per language |
| A6 | `packages/contracts/src/common.ts` | `OriginReferenceSchema` / `OriginReference` | US10 | a generic schema with two users |
| A7 | `packages/contracts/src/errors.ts` | the fifteen `CRM_*` members of `ERROR_CODES` — minting does require it (research N-13; admin-api.md §13) | US1 and each story that adds a raise site | unused members |
| A8 | `scripts/check-naming.sh` | `crm` added to `allowed_proper_noun` — the id is an acronym, not a plural, and the check refuses it otherwise (research N-1) | Setup | one allow-list word naming no folder |
| A9 | `backend/package.json` | `"@endora-commerce/mod-crm": "workspace:*"` — the generated registries import the package by bare specifier and no generator writes this line (research N-2) | Setup | a dependency on a missing member; remove with the module |
| A10 | `packages/contracts/src/assets-library.ts` | `'crm_opportunity_attachment'` added to `assetReferenceKindSchema` — the kind an asset-reference descriptor answers is a closed enum, and no existing member fits an Opportunity attachment (research N-B15; approved by the coordinator 2026-10-05). Nothing else in the tree enumerates or renders the kinds: each sibling literal is named only by this file, by its owner's descriptor and by its owner's tests | US5 | an enum member no descriptor answers |

A3–A5 are the owner's navigation ruling of 2026-10-05 (research R-19). They are a **host**
change: the section belongs to the shell, CRM contributes entries to it. Recorded follow-up:
if the group ends up with one or two links, the owner will have them moved to `sales`, and
A3–A5 are then reverted.

Sections G–J were added on 2026-10-05 for the owner's second and third rulings; A1's "all CRM
Zod schemas" is extended additively by US15, US16 and US17.

## B. `orders` — one optional, opaque pass-through (US10 only)

| # | File | Change |
| --- | --- | --- |
| B1 | `packages/contracts/src/orders.ts` | `adminCreateOrderRequestSchema` gains `origin: OriginReferenceSchema.optional()`; the `order.created.v1` payload type gains `origin?: OriginReference` |
| B2 | `packages/modules/orders/src/backend/routes.ts` | `POST /api/v1/admin/orders` forwards `body.origin` to the creation service — **as built: not edited**; the route already hands the parsed body whole to the service (research N-J3 b) |
| B3 | `packages/modules/orders/src/backend/services/order-creation-admin-service.ts` | `AdminCreateOrderInput.origin?`; passed to `placeOrder` |
| B4 | `packages/modules/orders/src/backend/services/order-service.ts` | `placeOrder(ctx, req, options?: { origin?: OriginReference })`; the `order.created.v1` emit spreads `origin` when present; the local `Events` map type follows |
| B5 | `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx` | read `originType`, `originId`, `customerAccountId` from the query string; preselect the customer; send `origin`. **As built**, also `organizationId` (narrows the customer search), `salesChannelId` (preselected) and `returnTo` (an in-app path for Back and for the redirect after creating, which hands `{ createdDocument: { id } }` in the navigation state) — research N-J4 |
| B6 | `packages/modules/orders/docs/orders.md` (+ Polish copy) | document `origin` on the event and the endpoint — and that it reaches outbound webhooks, because `webhooks` bridges `order.created.v1` whole (research N-J7) |

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
| C2 | `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` | `createOnBehalf` emits `rfq.created_by_admin.v1 { rfqId, organizationId, adminUserId, origin: origin ?? null }` after its write. **As built**, the event's type (`RfqAdminEvents`) is declared in this file too, and the emit widens the bus locally: the shared `RfqEvents` map is in `rfq-service.ts`, which is not a row here (research N-J3 c) |
| C3 | `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx` | read the same three query parameters; preselect the customer; send `origin`. **As built**, also `organizationId` and `returnTo`, as B5 (no `salesChannelId`: a quote request takes none) — research N-J4 |
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

**As built**, the generated files that changed outside the module, each as its generator
wrote it: `backend/src/composition.generated.ts`, `backend/src/manifest-index.generated.ts`,
`backend/src/db/migrations-registry.generated.ts` (both CRM migrations),
`backend/src/db/entities-registry.generated.ts`, `backend/test/entities.generated.ts`,
`admin/src/modules.generated.ts`, `admin/src/tailwind.generated.css` (one `@import` of
`@endora-commerce/mod-crm/tailwind.css` — its header names `composer:generate`),
`admin/package.json` (the `@endora-commerce/mod-crm` line; the `@dnd-kit/core` line beside
it is G2, written by hand), `docs/sidebars.modules.generated.js`,
`docs/docs/modules/module-map.generated.md` and `docs/docs/module-reference/crm.md`.

### D2. Speckit plumbing — two files the feature workflow writes, not the feature

| File | What changed | Does it belong in the pull request? |
| --- | --- | --- |
| `AGENTS.md` | Only the auto-generated appendix at the bottom (*Active Technologies*, *Recent Changes*) and the `Last updated` date: two lines for this feature added, two `089-*` lines rotated out of *Recent Changes*. Written by `.specify/scripts/bash/update-agent-context.sh`, which `/speckit.plan` runs and which is pinned to this file. No rule, route or section of the router changed, and `backend/test/unit/docs/agents-router.test.ts` is unaffected | **Yes** — it is what `/speckit.plan` produces and what the file's own *Feature workflow* section describes; every planned feature before this one carried the same appendix lines to `master` (the `068-*`, `072-*`, `089-*`, `094-*`, `119-*` lines there). It is a hot file: a feature planned in parallel edits the same lines, so expect a trivial conflict on rebase and keep both sides' *Active Technologies* lines |
| `.specify/feature.json` | `feature_directory` now names `specs/143-crm-sales-opportunities` instead of `specs/130-comarch-xl-sync`. Written by `/speckit.specify`; it tells the later speckit commands which directory is current | **Yes, by precedent** — the file is tracked and a feature's own commits have carried the pointer to `master` every time (`git log origin/master -- .specify/feature.json` lists them: `3d2065f58` for the Infakt feature, `d0ba9cfc1` for Pimcore, `107eb2143` for product feeds and `9b84c8b51` for the kernel extraction are four). It is one line that the next `/speckit.specify` overwrites, so a conflict there is resolved by taking whichever feature was specified last |

## E. Test harness and ledgers — only where a check asks

| File | When |
| --- | --- |
| `backend/test/helpers/package-entities.ts` | when an integration test needs a CRM entity class by name (the harness's sanctioned door to a packaged module's entities) |
| `backend/test/fixtures/error-code-routing/…`, `backend/test/unit/_i18n/error-code-migration-progress.test.ts` | if minting the `CRM_*` codes moves those ledgers (commit `512b68e84` is the worked example) |
| `backend/test/fixtures/openapi-baseline.json` | every story that adds a route: regenerate with `UPDATE_OPENAPI_BASELINE=1` and review the diff (`backend/test/contract/kernel/openapi-baseline.test.ts`) |
| `backend/test/integration/sales_channels/delete-attribution-guard.test.ts` | the contributors of `salesChannelAttributionRegistry` are asserted as a set; `crm` joined it with its counter (US1, T050 — research N-25) |
| `backend/test/integration/audit_logs/reference-contributions.test.ts` | the contributors of `auditReferenceRegistry` are asserted as a set; `crm` joined it with its resolver (US14, T137 — research N-G6) |
| `backend/test/helpers/seed-crm.ts` (**new**) | the fixtures the CRM contract and integration tests share, and the restore of the seeded workflow that makes them independent of run order (research N-21) |
| `backend/scripts/check-port-dependencies.ts` | `CONTRIBUTION_POLICY_STATED` gains `'webhooks:webhookEventRegistry': 'skip'` — the check refuses a `contributes-to` edge into a registry whose owner's absent-contributor policy is not stated there, and User Story 16 adds both the registry and its first contributor (research N-E20). One line and its comment, in a commit of its own |
| `backend/test/unit/kernel/contribution-absent-owner.test.ts` | every `contributes-to` edge the manifests declare is held, two ways, to a composition that proves the push survives an owner the instance never installed; `crm` joined it with its edge into `webhookEventRegistry` (US16, T169 — research N-E21). One composer entry and its import, in a commit of its own |
| `backend/test/unit/tenancy/transitive-parent-chains.test.ts` | the population of `@TransitivelyScoped` classes is asserted as a set; the seven CRM child classes joined it with their entities |
| `backend/scripts/check-command-coverage.ts` | `'crm'` appended to `MIGRATED_MODULES` — the rollout ledger whose header asks for a new module "as it lands"; without the entry a write outside a Command in this module is a warning unless the run is `--strict` (research N-B11, N-D1) |
| a recorded read size under `backend/` | **only** an entry whose band refuses the new file count; drift inside a band is left for the release pull request (`specs/conventions/check-estate.md` § *Measuring a read size* — read it first) |
| `docs/i18n/pl/…` | the Polish copy of every docs page this feature writes or edits |
| `docs/translation-cache/pl/…`, `docs/i18n/pl/docusaurus-plugin-content-docs/current.json` | the translation-cache entry beside every Polish copy, the generated reference page and module-map row in Polish, and the `sidebar.main.category.crm` id (research N-10) |
| `docs/docs/module-reference/crm.md` | generated by `composer:generate` and committed, as every module's reference page is |
| `backend/test/helpers/seed-crm-analytics.ts`, `backend/test/helpers/crm-attachment-upload.ts` (**new**) | the hand-computed analytics fixture (US13) and the multipart request the upload tests share (US5, T182) |
| `backend/test/entities.generated.ts` | generated beside the entities registry; the thirteen CRM classes joined it |
| `backend/test/contract/orders/admin-create.test.ts`, `backend/test/integration/orders/admin-create-origin.test.ts` (**new**) | the tests §B owes: `origin` accepted, echoed on the event, absent when not sent, refused when malformed (400) |
| `backend/test/contract/quote_requests/admin-routes.test.ts`, `backend/test/integration/quote_requests/admin-create-origin.test.ts` (**new**) | the tests §C owes: `rfq.created_by_admin.v1` once, with the origin or `null`; `rfq.created.v1` still not emitted on that path |
| `backend/test/integration/custom_fields/entity-owner-presence.test.ts` (**new**) | §H's proof: a host type whose owner is off is not offered and its definitions cannot be changed; existing types unaffected |
| `backend/test/integration/webhooks/contributed-events.test.ts` (**new**), `admin/test/modules/webhooks/contributed-event-types.test.tsx` (**new**) | §I's proofs |
| `admin/test/kit/kit-custom-field-values.test.tsx` | three cases for the panel's embedded mode (G8) |
| `admin/test/modules/orders/OrderCreatePage.test.tsx`, `admin/test/modules/quote_requests/RfqCreatePage.origin.test.tsx` (**new**) | B5 and C3: the query parameters, and the exact request body when opened without them |
| `admin/test/modules/orders/OrderDetail.after-zone.test.tsx`, `admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx` (**new**) | §J's proofs: an empty zone renders nothing |
| `admin/test/modules/quote_requests/RfqDetail.custom-fields.test.tsx`, `RfqDetail.validity.test.tsx` | the screen now ends with a zone (J3), so these two existing tests render it under the session providers, with no contribution; no assertion changed |
| `.changeset/*.md` | nine changesets, one per meaning (`specs/conventions/release-intent.md`) |

No `root-dispositions.json` entry is owed for `specs/143-crm-sales-opportunities/`: that check
was retired from the canonical tree (the header of `backend/scripts/lib/root-dispositions.ts`
says so, and its record file is not in this repository).

## G. `admin-kit` and the admin application — the board primitive and its dependency (US7)

Owner ruling of 2026-10-05, third round: the board is built on `@dnd-kit`, as a reusable
primitive of the design system. This is a **host package** change.

| # | File | Change |
| --- | --- | --- |
| G1 | `packages/admin-kit/package.json` | `@dnd-kit/core` `^6.3.1` in `peerDependencies` **and** `devDependencies` (the `echarts` pattern) |
| G2 | `admin/package.json` | `@dnd-kit/core` `^6.3.1` in `dependencies` |
| G3 | `pnpm-lock.yaml` | `pnpm install --lockfile-only` |
| G4 | `packages/admin-kit/src/components/kanban/KanbanBoard.tsx`, `index.ts` (**new**) | the generic board: lanes, cards, `canDrop`, `onMove`, render props, announcements |
| G5 | `packages/admin-kit/src/components/index.ts` | export `KanbanBoard` and its types |
| G6 | `admin/test/components/KanbanBoard.test.tsx` (**new**) | the primitive's tests |
| G7 | another consumer of `@endora-commerce/admin-kit` (`packages/admin-shell/package.json`, the docs site, the `create-endora-commerce` template) | **only if** `pnpm install --frozen-lockfile` reports the new peer unmet there — T149 measures it and names the file. **As built: not triggered, no file edited** (research N-K2) |
| G8 | `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` | **conditional, US15**: an optional controlled mode (`onChange`, no save button), only if the panel cannot be embedded in the create form as it is — T160 decides after reading it. **As built: taken.** `save` became optional, `onChange(values)` reports the whole bag, and two more optional props came in the same file — `fieldErrors` (a refusal shown at its field) and `language` (labels were hard-coded to English). All default to the old behaviour, so the four existing hosts are unchanged (research N-G1) |

`packages/modules/crm` declares **nothing** for `@dnd-kit`: it imports the primitive from
`@endora-commerce/admin-kit/components`. Left behind if CRM is removed: a design-system
component with no consumer yet, and one peer — which is what "reusable" means.

## H. `custom_fields` — Opportunities as a host type (US15)

| # | File | Change |
| --- | --- | --- |
| H1 | `packages/contracts/src/custom-fields.ts` | add `'opportunity'` to `supportedEntityTypeSchema` |
| H2 | `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts` | optional `ownerModuleId` on `SupportedEntityMeta`; the `opportunity` entry (`orgOwned: true`, `ownerModuleId: 'crm'`) — compile-coupled to H1, because the map is a `Record` over the enum |
| H3 | `packages/modules/custom_fields/src/backend/routes.admin.ts` | `entity-types` omits a type whose owner is not effectively present; definition mutations for such a type are refused |
| H4 | `packages/modules/custom_fields/i18n/en.json`, `pl.json` | `customFields.entity.opportunity` |
| H5 | ~~`packages/modules/custom_fields/docs/…` (+ Polish copy) — the new host type and the owner-presence rule~~ | **Struck: not edited, and cannot be.** `custom_fields` ships no documentation page — there is no `packages/modules/custom_fields/docs/` directory and the module map says "no page yet". The host type and the owner-presence rule are documented on CRM's own page instead (research N-G3). Still owed, outside this feature: `docs/docs/architecture/custom-fields.md` describes `managedBy` and not the new `ownerModuleId` marker |
| H6 | every exhaustive switch or enumerating test over `SupportedEntityType` | found by grep in T156, repaired in the same change. **As built, two files**: `packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts` — one line, the `opportunity` entry of `HOST_TABLE_BY_ENTITY`, a second `Record` over the enum (the `{ table, column }` the definition-change guards probe: `crm_opportunities.custom_field_values`); and its row in `packages/modules/custom_fields/src/backend/services/value-probe-binding.test.ts` (research N-G3) |

`custom_fields` learns one string, `'crm'`, as a registry value — the same way it already
holds `'catalog'` in `managedBy` — and one table name, `crm_opportunities`, as the value of
H6's map, the same way that map already holds every other host's table. It imports nothing from CRM and reads the marker's presence
only. Existing host types declare no owner and behave exactly as before, which
`entity-owner-presence.test.ts` proves. Left behind if CRM is removed: an enum member and a
registry entry whose owner is never present, so the type is never offered — inert, and
removable with the module.

## I. `webhooks` — a contribution seam for event types (US16)

| # | File | Change |
| --- | --- | --- |
| I1 | `packages/contracts/src/webhooks.ts` | `WebhookEventDescriptor`, `WebhookEventRegistryPort` |
| I2 | `packages/modules/webhooks/src/backend/services/webhook-event-registry.ts` (**new**), `webhook-event-registry.test.ts` (**new**, beside it) | the registry; bridges each contributed type through the module's own gated subscription; its co-located unit test |
| I3 | `packages/modules/webhooks/src/backend/index.ts` | register `webhookEventRegistry` ungated |
| I4 | `packages/modules/webhooks/src/backend/routes.ts` | `GET /api/v1/admin/webhooks/event-types` |
| I5 | `packages/modules/webhooks/src/admin/pages/WebhooksPage.tsx` | offer the contributed types **after** the existing `KNOWN_EVENT_TYPES`, which is not edited |
| I6 | `packages/modules/webhooks/docs/webhooks.md` (+ Polish copy) | the seam |

`webhooks` names no CRM event and gains no edge to `crm`. `BRIDGED_EVENT_TYPES` and
`KNOWN_EVENT_TYPES` are untouched, so the module behaves identically when nobody contributes.
**Reported, not repaired**: `KNOWN_EVENT_TYPES` offers thirteen types of which the backend
bridges two — a pre-existing defect for the register.

## J. Two detail-screen zones (US17)

| # | File | Change |
| --- | --- | --- |
| J1 | `packages/contracts/src/admin-contributions.ts` | `'order.detail.after'` and `'quote_request.detail.after'` in `AdminZoneNameSchema` and `AdminZonePropsMap`; new `QuoteRequestDetailZoneProps { quoteRequestId }` |
| J2 | `packages/modules/orders/src/admin/pages/OrderDetail.tsx` | one element, `<AdminZone name="order.detail.after" props={{ orderId: id }} />`, with its import and a comment — six lines |
| J3 | `packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx` | one line: the Quote Request mount (and the `AdminZone` import) |
| J4 | both modules' docs pages (+ Polish copies) | the new zone |

A member and its mount land in one change (`check:admin-zones` refuses a member nothing
renders, and a contribution to one). Neither host names a contributor; an empty zone renders
nothing, so both screens are identical without CRM — proven by the two `after-zone` tests.
The Quote Request zone is added only once User Story 8 has landed. Left behind if CRM is
removed: two zones nobody contributes to, in the shape of `organization.detail.after`.

## K. `audit_logs` — one prefix, so the audit viewer labels CRM's actions (US11)

| # | File | Change |
| --- | --- | --- |
| K1 | `packages/modules/audit_logs/src/backend/routes.admin.ts` | one line in `moduleIdForAuditAction`: `if (action.startsWith('crm.')) return 'crm';` |
| K2 | `packages/modules/audit_logs/src/backend/routes.admin.test.ts` | the prefix cases, CRM's among three neighbours, and the fall-through to `core` |

Approved by the owner on 2026-10-06 (research N-22, N-E12, N-H1). The function is a hard-coded
prefix chain, not a registry: the line is the shape every other module's prefix has there.
`audit_logs` gains no edge to `crm` and imports nothing of it; with CRM off or absent the line
is never reached by a row, and a row written before CRM was removed falls back to its raw
action code, as any unlabelled action does. Left behind if CRM is removed: that one line.

## L. The notification bell — a translatable message beside the finished sentence (FR-085)

Owner's request of 2026-10-07 (research N-BT1 … N-BT4). `specs/conventions/module-i18n.md`
already rules that an admin notification ships "a key, its params and an English fallback
sentence" and that the consumer translates; this is that rule built for the bell. Every row
is additive and optional: a writer that passes no message — `organizations`, `catalog`,
`product_feeds`, and `pim_ergonode` outside this repository — is recorded and shown exactly
as before.

| # | File | Change |
| --- | --- | --- |
| L1 | `packages/contracts/src/admin-notifications.ts` | `AdminNotificationMessage` (`{ scope, key, params? }`); optional `titleMessage` / `bodyMessage` on `RecordAdminNotificationInput` and on `AdminNotificationRecord` |
| L2 | `packages/modules/admin_notifications/src/migrations/20261007T194748_admin_notifications_message_keys.ts` (**new**), `src/migrations/index.ts` | two nullable `jsonb` columns on `admin_notifications`, `title_message` and `body_message`; no backfill, no default |
| L3 | `packages/modules/admin_notifications/src/backend/entities/admin-notification.entity.ts` | the two properties and the stored shape |
| L4 | `packages/modules/admin_notifications/src/backend/services/admin-notification-service.ts`, `services/admin-notification-port.ts`, `routes.admin.ts` | `record` validates and stores a message (and refuses a `bodyMessage` with no `body`); the feed query, the port's record and `GET /api/v1/admin/notifications` answer both, `null` when absent |
| L5 | `packages/admin-shell/src/components/notifications/notification-text.ts` (**new**), `NotificationBell.tsx`, `useAdminNotifications.ts`, `index.ts` | the bell resolves a message through the loaded bundles and falls back to the recorded sentence — never to a raw key |
| L6 | `backend/src/db/migrations-registry.generated.ts` | regenerated by `composer:generate` for L2 |
| L7 | `docs/docs/contributing/translations.md` | § *Notification bell entries* — how any module makes its entry translatable |

Tests: `backend/test/integration/admin_notifications/translatable-messages.test.ts` (**new**),
`backend/test/contract/admin_notifications/list.test.ts`,
`admin/test/components/NotificationBell.translation.test.tsx` (**new**). Changesets: one each
for `@endora-commerce/contracts`, `@endora-commerce/mod-admin-notifications` and
`@endora-commerce/admin-shell`.

Why it is generic: nothing in L1 – L5 names `crm`. The message's `scope` is whichever bundle
the writer names, and the bell knows no module's kinds or keys. `admin_notifications` gains
no dependency and no edge. Left behind if CRM is removed: all of it, in use by nobody until
another module passes a message — two null columns and an untaken branch in the bell.

Against the oracle at the top of this page, §L is **eleven** files: L1, the two of L2, L3,
the three of L4 and the four of L5 (L6 was a row of §D already; L7 is under `docs/`, which the
oracle leaves out). The count in the opening paragraph is the reconciliation of 2026-10-06 and
was not re-derived here: on `212907604` the command names 67 files, which is those 55, these
eleven and one that arrived between the two and is not this section's.

**This section is the one exception to §F's first line**, and it is an exception by the
owner's request rather than by drift: the migration is `admin_notifications`' own, scaffolded
into its own directory, and touches no CRM table.

## M. `admin_roles` demo data — the demo Sales Rep holds the CRM codes

Owner ruling of 2026-10-08 ("nadaj i domyślnie rola demo powinna je mieć"): the seeded
`sales_representative` role gains `crm:read` and `crm:write`
(`packages/modules/admin_roles/src/backend/demo/rows.ts`, `SALES_REPRESENTATIVE_PERMISSIONS`).
Without them a demo Sales Rep was offered by neither `/lookups/assignees` nor
`/lookups/mentionable`, so the owner's own example ("@Tomasz Nowak - przejmij temat") found
nobody. The list already names other capabilities' codes (`rfqs:handle`, `price_lists:read`);
a code whose module is off grants nothing. Demo data only — no installed role changes.

## F. Explicitly **not** changed

- No column, table or migration of another module — **except §L**, the two nullable columns
  `admin_notifications` adds to its own table through its own migration, **and §QS**, the one
  nullable column `carts` adds to its own table through its own migration.
- No import of `@endora-commerce/mod-crm` by any other module package; `orders` and
  `quote_requests` gain no manifest edge to `crm`.
- No change to `OrderTransitionPort`, `OrderStatusActor`, `QuoteRequestReadPort` or
  `KnownIconNameSchema`. (§QS adds one optional argument to `CartWritePort` and one field to
  `CartRecord`; `QuoteRequestReadPort` gains a consumer, `orders`, and no method.)
- No `@dnd-kit` declaration in `packages/modules/crm` or any other module package, and no new
  runtime dependency anywhere other than `@dnd-kit/core` in the two manifests of §G (the
  generator may add *existing* workspace packages and already-used third-party peers to
  `mod-crm`'s own manifest; that is derivation, not a new dependency).
- No change to `BRIDGED_EVENT_TYPES` or `KNOWN_EVENT_TYPES` in `webhooks`, to any existing
  custom-field host type, or to `order.detail.payment`.
- Nothing in `import_export`: that integration stays deferred (research R-22).

(Until the owner's second ruling of 2026-10-05 this section also said "no new zone" and "no
change to `supportedEntityTypeSchema`"; §H and §J are those two changes, now in scope.)

## QS. An Order records the Quote Request it was placed from (FR-100 … FR-104)

Owner ruling of 2026-10-08 ("Ad 2) tak, jak możesz to dorób"), the answer to `spec.md`
§ Clarifications, A-1. Added on branch `feat/143-crm-quote-source`; research N-QS1 … N-QS6.
**None of these rows names `crm`, and CRM's own source does not change**: the column
`orders.source_quote_request_id`, its two serialisers and its three readers all predate this
feature, and what is repaired is the platform's missing writer.

| # | File | Change | Left behind if CRM is removed |
| --- | --- | --- | --- |
| QS1 | `packages/contracts/src/carts.ts` | `CartRecord.sourceQuoteRequestId`; `CartSeedOptions`; an optional third argument on `CartWritePort.replaceItemsForCustomer`, replaced on every call | all of it — the basket's memory of its quote, used by `orders` and `quote_requests` |
| QS2 | `packages/modules/carts/src/migrations/20261008T061751_carts_cart_source_quote_request.ts` (**new**), `src/migrations/index.ts`, `backend/src/db/migrations-registry.generated.ts` (generated) | `carts.source_quote_request_id uuid null` — no foreign key, no index, no backfill | a nullable column |
| QS3 | `packages/modules/carts/src/backend/entities/cart.entity.ts`, `services/cart-read-port.ts`, `services/cart-service.ts` | the property; the seed writes the mark and its `lastActivityAt` on the `EntityManager` it flushes (the latter was never written — N-QS5 (a)); the mark is cleared when the last line is removed | all of it |
| QS4 | `packages/modules/quote_requests/src/backend/services/rfq-service.ts` | `convertToOrder` passes `{ sourceQuoteRequestId: rfq.id }` to the seed | all of it |
| QS5 | `packages/modules/quote_requests/src/backend/services/order-completion-reactor.ts`, `order-completion-reactor.test.ts` (**new**), `backend/plugin.ts`, `backend/index.ts` | the completion looks again, off the bus's chain, for an Order whose commit is still in flight, and refuses an Order of another Organization; `deferAfterCommit` / `isStillPresent` supplied by the composition (N-QS5 (b)) | all of it — the completion of a converted request, which the dead column had kept from ever running |
| QS6 | `packages/modules/orders/src/backend/domain/quote-request-source.ts`, `quote-request-source.test.ts` (both **new**) | the pure rule: same Organization, still `Approved`, an agreed line still on the basket | all of it |
| QS7 | `packages/modules/orders/src/backend/services/order-service.ts`, `backend/plugin.ts`, `backend/index.ts` | `placeOrder` stamps the vouched source on the `Order` it creates; the `quoteRequestRead` accessor, `null` when `quote_requests` is not present | all of it |
| QS8 | `packages/modules/orders/src/manifest.ts`, `docs/docs/module-reference/orders.md` (generated) | one `nonBindingDependencies` entry: `quote_requests` / `quoteRequestReadPort` / `degrades-without` | the edge and its sentence |

Tests, outside the oracle: `backend/test/helpers/quote-conversion.ts` (**new**),
`backend/test/helpers/orders-neighbour-ports.ts` (the rig's `quoteRequestRead: () => null`),
`backend/test/integration/orders/place-order-from-quote-request.test.ts` (**new**),
`backend/test/integration/quote_requests/conversion.test.ts` (four cases added),
`backend/test/integration/crm/quote-conversion.test.ts` (**new**). Docs, also outside it: the
module pages of `carts`, `orders` and `quote_requests`, their Polish mirrors and
translation-cache entries, and the Polish mirror of the generated `orders` reference page.
Changesets: `contracts`, `mod-carts`, `mod-quote-requests`, `mod-orders`.

**Amended by the independent review (2026-10-08, research N-QSR1 … N-QSR5; tasks
T280 – T285)**, in files already on this list: QS6 gains a fourth refusal, `already-ordered`
(an Order already names the request); QS7 takes a transaction-scoped advisory lock on the
request's id and counts `orders`' own rows before it stamps; QS5 throws after its last look
so that the give-up is logged. No new source file, no new edge, no schema change. Tests,
outside the oracle: `backend/test/integration/orders/quote-request-source-review.test.ts`
and `backend/test/integration/carts/seed-bookkeeping.test.ts` (both **new**).

**No manifest edge is added to `carts` or `quote_requests`**, no API shape changes (the
OpenAPI baseline is untouched), nothing in `storefront/` or `admin/` changes, and the external
order API takes no new field. Against the oracle at the top of this page, §QS is **eighteen**
files, the generated migrations registry included (the generated reference page is under
`docs/`, which the oracle leaves out).
