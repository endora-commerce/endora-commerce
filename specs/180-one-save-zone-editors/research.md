# Research: One Save for every panel on the product edit page

Feature: `specs/180-one-save-zone-editors/` (renamed from `180-product-editor-one-save`) · Issue #407 · Base: `origin/master` `2cc56ea9b` plus
PR #1217. Each section is decision → rationale → alternatives rejected. OQ-1…OQ-8 were ruled by the owner on
2026-11-14 (`spec.md` § *Owner rulings*); R1–R13 were written to the recommendations, which the
owner accepted except OQ-8 (C, every editor with zone panels). R14–R21 cover the widening. OQ-9…OQ-11
were ruled A (as recommended) the same day; R18–R21 stand as written.

Abbreviations: **AK** = `packages/admin-kit/src/`, **CAT** = `packages/modules/catalog/src/admin/`,
**PL** = `packages/modules/price_lists/src/`.

## R1. What is on the page (finding)

**Finding.** `CAT/pages/ProductEditor.tsx` mounts six zones: `product.editor.details.before`,
`product.editor.field.after` (once per core field and per attribute row, also in
`CAT/components/editor/DetailsTab.tsx` and `CAT/components/ProductAttributesTab.tsx`),
`product.editor.pricing.before`, `product.editor.pricing.after`, `product.editor.channels` and
`product.editor.seo`. Contributors in this repository (grep of `zoneComponent(` across
`packages/modules/*/src/admin/index.ts` and `backend/src/apps/`):

| Zone | Contributor | Save behaviour |
| --- | --- | --- |
| `product.editor.pricing.after` | `price_lists` `ProductBasePrices` (`PL/admin/index.ts:112`) | own *Save prices*, own prompt with `guardTabsOutside` |
| `product.editor.channels` | `sales_channels` `ProductChannelMembership` (`packages/modules/sales_channels/src/admin/index.ts:139`) | immediate `PUT`/`DELETE` |
| `product.editor.seo` | `seo` `ProductSeoSection` (`packages/modules/seo/src/admin/index.ts:105`) | staged into the host via `onStage`, written in catalog's Command through `seo`'s port |
| the other three | none in the tree | — |

`product.content.editor` (`cms`) is mounted on `CAT/pages/ProductContentPage.tsx`, a separate
route; the editor's Attributes tab only counts it.

**Consequence.** One participant moves (base prices). SEO already has the stronger guarantee
(atomic with catalog) and must not be downgraded to a participant. Channel membership is immediate
by owner ruling (174 FR-070). The API must still be general (the issue asks for an API, and PIM
connector panels outside the repository contribute to `pricing.before` and `field.after`).

## R2. Tab panels unmount; drafts must outlive them

**Finding.** `ProductEditor.tsx` renders the active tab only (`switch (activeTab)`), and outside
Global the Pricing and Channels tabs render the global-only notice instead of the zone
(`ProductEditor.tsx:949`). `ProductBasePrices` holds its drafts in `useState` and therefore guards
tab switches itself (`guardTabsOutside: panelRef`). A participant whose state dies with the panel
cannot be saved from another tab.

**Decision.** The **save session holds each participant's draft and baseline**. The participant
hook (`useSaveParticipant`) reads and writes its draft through the session, so unmounting the panel
does not lose it, and remounting shows it again. The participant's `validate` and `save` functions
are registered with the session and must be **pure of component state**: they receive the draft,
the baseline and a context argument and close over nothing but stable values (the product id, the
module's API client). The session keeps an entry while it is dirty, even unmounted; a clean entry
is removed on unmount.

**Rejected.**
- *Keep every visited tab mounted and hidden.* Does not cover the global-only notice replacing the
  zone outside Global, makes every tab's reads stay live, and leaves a hidden panel unable to focus
  its error.
- *Block tab switches while a panel is dirty* (today's behaviour). The operator has to save per tab,
  which is the problem the issue describes.
- *Lift the draft into the host's own reducer as typed cells* (the SEO pattern). The host would have
  to know every participant's draft shape and write path — exactly what a zone exists to avoid.

## R3. How a contribution reaches the session: a zone prop, not a React context

**Decision.** The zones whose host offers a session carry one more prop, `saveSession:
EditorSaveSessionHandle`, typed in `packages/contracts/src/admin-contributions.ts` next to the
other zone props. `ProductEditorZoneProps` (used by `details.before`, `pricing.before`,
`pricing.after`, `channels`) and `ProductEditorFieldZoneProps` gain it. The handle is stable for
the session's life (the host memoises it), so `AdminZone`'s per-factory lazy components do not
remount (`AK/zones/AdminZone.tsx`, `lazyByFactory`).

**Rationale.** `AdminZonePropsMap` is "the contract and the registry is a courier"; participation
is part of what a zone offers, so it belongs in the map, where `tsc` checks both ends (FR-002). It
is also how the closest precedents already work — `ProductEditorSeoZoneProps.onStage`,
`ProductContentEditorZoneProps.onChange` hand host callbacks through props.

**Rejected.** *A React context provided by the host.* Invisible in the zone contract; a contributor
to a zone with no session would find out at runtime; `check:admin-zones` reasons about the map and
would see nothing.

## R4. Where the API lives in admin-kit

**Decision.** New source directory `AK/save-session/`, exported through the existing **`./lib`**
subpath (`AK/lib/index.ts`), beside `useUnsavedChangesPrompt`: `SaveSessionProvider`,
`useSaveSession()` (host side) and `useSaveParticipant()` (contributor side), plus the pure
`runSave()` orchestrator. The handle type lives in contracts (R3); admin-kit implements it.

**Rationale.** Contributors already import `@endora-commerce/admin-kit/lib`; `./lib` is a barrel
with explicit exports. No new `exports` entry, no build-configuration change (D-164's per-package
`dist` build is untouched).

**Rejected.** *A new subpath `./save-session`* — one more published surface for four exports.
*`./zones`* — that subpath is the host's rendering side; the participant hook is used by
contributors.

## R5. One orchestrator, generic, with the host's own write as the first part

**Decision.** `runSave(parts, options)` in `AK/save-session/run-save.ts` is a pure async function
over an ordered list of parts, each `{ id, label, validate, save, blocking }`. Phases:

1. **Validate** every dirty part (all of them, in parallel, so every error shows at once —
   FR-011). Any refusal → return `refused` with every part's issues; nothing written.
2. **Write** parts in order. A `blocking` part that fails stops the run (the host's own write is
   blocking: FR-015). A non-blocking failure is recorded and the next part runs (OQ-1 A). With
   OQ-1 B, `stopOnFailure: true` makes every part blocking — one option, not a second code path.
3. Return a `SaveOutcome` (`data-model.md`).

The catalog host passes its own write as the first, blocking part (its existing `save()` body:
client required-empty checks as `validate`, `PUT …/scoped-values` as `save`), followed by
`session.dirtyParticipants()` in zone order (OQ-2 A).

**Rationale.** FR-005: a second host adopts the same semantics by calling the same function. Pure
function → unit-tested without React.

**Rejected.** *The orchestration written inside `ProductEditor.tsx`.* Every future host would
re-implement it, and the semantics the owner rules on in OQ-1/OQ-2 would drift per editor.

## R6. Server pre-check for base prices (FR-021)

**Finding.** `PL/backend/routes.price-books.ts:220` (`PUT …/base-prices/:productId`) parses with
`basePricesWriteSchema`, then `PriceBookService.setBasePrices` plans rows with `planBasePriceRows`
and refuses with a validation error before opening its Command (`price-book-service.ts:301-335`).
The rows endpoint already has a `?dryRun=true` precedent (`routes.price-books.ts:512`).

**Decision.** Add `?dryRun=true` to `PUT …/base-prices/:productId`: same gate, same parse, same
planning and the same `422` refusals, then return `200 { data: { valid: true } }` without opening
the Command (`contracts/base-prices-dry-run.md`). The panel's `validate` runs its local checks,
then the dry run.

**Rationale.** Narrows the partial-failure window of OQ-1 to infrastructure failures and races; no
new endpoint, an existing precedent, a few lines in one service.

**Rejected.** *Client checks only* — the server's rules (variant adjustments needing a product
price, tier ordering) would be duplicated or missed. *A generic "validate" endpoint per module* —
nothing else needs one yet.

## R7. Auditing: one Command per module, no correlation id

**Decision.** Each part writes through its module's existing Command — catalog's scoped-values
Command (one entry, 174 FR-072) and `price_list.base_prices_set`. A Save with base prices yields
two audit entries.

**Rejected.** *A save-correlation id across entries* — `audit_log_entries` carries `requestId`
(`packages/platform/src/commands/command-bus.ts:56`), which is per request; a cross-request id
needs a platform column and nobody reads it yet (Principle IV). *One composite Command* — merges
modules' writes (excluded by the issue; OQ-1 C).

## R8. Presence (Principle XVII) and identity

**Decision.**
- A participant exists only while its contribution renders, and `useAdminZone` has already applied
  both presence axes and the contribution's permission before anything loads
  (`AK/zones/use-admin-zone.ts`). So an off module contributes no participant, no request, nothing
  counted (FR-034) — no new gating code.
- The participant's **module** is taken from the contribution, not declared: `AdminZone` wraps each
  contribution in a small context carrying the registry entry's `module` (D-142's rule: "a module
  cannot contribute under another module's presence"), and `useSaveParticipant` reads it. The
  participant supplies only a local key (`'base-prices'`); its id is `price_lists:base-prices`.
- An unmounted dirty entry is checked against `useSurfaceVisibility` on every render of the
  provider and before `runSave`; an entry whose module is no longer visible is dropped with the
  FR-034 notice.
- A `503 MODULE_DISABLED` from a participant's write is that part's failure with the "switched off"
  message.

## R9. UI reuse (Principle IX)

**Decision.** No new primitive. Save stays `ProductEditorSaveAction` (#1217), whose `stagedCount`
becomes the session total. The summary is the editor's existing form-error area rendered as admin-kit
`Alert` (destructive for refusals, warning for partial saves) with one list item per part and a
`Link`-styled button to its tab. The guard is the existing `ModalDialog` *Save / Discard / Stay*.
Field errors in a participant use its existing controls' `aria-invalid` / `aria-describedby`.
The `useUnsavedChangesPrompt` call moves from the host's `state.staged.size > 0` to the session's
`dirtyCount > 0`.

## R10. Counting

**Decision.** A participant reports `changeCount(draft, baseline)` in its own unit; the base-price
panel counts changed currencies (its existing `dirtyCurrencies`). Save shows the sum ("Save 3
changes"). The summary names parts by label, so the unit difference is not shown as a number per
part except where natural.

## R11. Concurrency of the base-price write (finding, not changed)

`PUT …/base-prices/:productId` takes no version: the last write wins, as with *Save prices* today.
The core write's `409` does not cover base prices. Adding a version is a separate change (spec
*Assumptions*).

## R12. Permissions (OQ-6 A)

**Decision.** `ProductEditor` renders `ProductEditorSaveAction` when `catalog:write` **or**
`session.hasWritableParticipant`. A participant registers itself writable only when its server read
says so (the base-price answer's `writable`, 161 G11). Without `catalog:write` the host's own part
is absent from the run. No new permission code.

## R13. Test strategy (product editor; per-editor tests are in `tasks.md`)

- `AK/save-session/run-save.test.ts` — the pure orchestrator: refusal writes nothing, blocking stop,
  non-blocking continue, retry writes only what is left, `stopOnFailure`.
- `admin/test/kit/save-session.test.tsx` — the provider and hooks: draft survives unmount, clean
  entry removed, dirty entry kept, module-gone drop with notice, crash in a boundary drops entry.
- `admin/test/modules/catalog/product-editor-one-save.test.tsx` — the host with a test-only
  participant (SC-006) and with the real base-price panel (US1–US4), on the existing
  `product-editor-harness.tsx`.
- `admin/test/modules/price_lists/product-base-prices.save.test.tsx` — rewritten: no *Save prices*,
  participates, dry-run called in validate.
- `admin/test/modules/price_lists/product-base-prices-off.test.tsx` — off state (US5).
- `PL/backend/routes.price-books.base-prices-dry-run.test.ts` (co-located, contract shape) and the
  existing contract test tree for the route under `backend/test/contract/price_lists/`.

## R14. Every zone host, classified (finding, OQ-8 = C)

**Method.** All 33 `zoneComponent(` declarations in `packages/modules/*/src/admin/index.ts` (none in
overlays), each contribution's component and the component it delegates to, scored for writes
(`apiClient.put|post|patch|delete`, module API clients), Save buttons, save-on-change and
`useUnsavedChangesPrompt`; every host from `<AdminZone>` / `useAdminZone(` / `<RouteTabsZone>`.

**Finding.** Panels that write a draft or save themselves:

| Component (module) | Hosts | Today |
| --- | --- | --- |
| `ProductBasePrices` (`price_lists`) | product editor | own Save + prompt |
| `DisplayModeOverrideRow` (`price_lists`, `src/admin/components/`) via `CategoryDisplayMode`, `OrganizationDisplayMode` | category editor, organization detail | save on select change; write not audited by design (`price-list-service.ts:151`, `command-coverage-ignore`) |
| `DefaultPreferencesPanel` (`quick_order`) via `OrganizationDefaults`, `CustomerDefaults` | organization detail, customer detail | own Save button; `PUT /api/v1/admin/quick-order/preferences`, audited by `default-preference-service.ts` |
| `negotiation-panel.tsx` (`quote_requests`) via `OrganizationPriceNegotiation`, `CustomerPriceNegotiation` | organization detail, customer detail | save on radio change; `routes.negotiation.ts` |

Immediate list actions: `ProductChannelMembership` (`sales_channels`), `ChannelWarehouses`
(`inventory`, sales-channel editor), `LinkedOpportunityPanel` (`crm`, order and quote-request
detail). Read-only: `projects` and `tasks` panels, `crm` `OrganizationOpportunities`, `projects`
`OrganizationProjects`, `invoice_ledger` `InvoiceLedgerRemoteIdPanel`, `payments` `OrderPaymentsTab`
(reads), `settings.setting.after` previews (render the host's draft). Host-saved already:
`category.content.editor`, `product.content.editor` (`onChange`).

**Decision.** An editor adopts when one of its zone panels writes. Adopting: product editor, category
editor, organization detail, customer detail, sales-channel editor (session only, OQ-10). The others
are listed in `spec.md` with the reason they do not change.

## R15. Host-owned sections as participants (FR-006, FR-062)

**Finding.** The organization and customer screens have no host write that could act as the
"blocking host part" the product editor has: their own sections save separately
(`OrganizationDetail.tsx` `handlePatch` called on change, on blur and by `FulfilmentStrategyPanel`,
`RestrictionsPanel`, `CustomFieldValuesPanel`).

**Decision.** `useSaveParticipant` also works **outside** an `AdminZone`: there it takes its module
from the provider (`SaveSessionProvider hostModule="organizations"`). Host sections that patch the
same record are gathered into **one** host part by the host (organization: one `PATCH
…/organizations/:id` with `expectedUpdatedAt`, blocking), so the record's version check still guards
everything; `CustomFieldValuesPanel` gains an optional `saveSession` prop and, when given one,
registers instead of rendering its Save (OQ-11 = A).

**Rejected.** *Each host section as its own participant writing its own `PATCH`*: several writes to
one record, each racing the same `expectedUpdatedAt`; the second would always conflict.

## R16. Generic Save control and summary (FR-007, Principle IX)

**Finding.** The product editor extends `ProductEditorSaveAction` (catalog-owned, names the scope).
The category editor has a form Save button; the sales-channel editor has the identity form's
submit; organization and customer have none.

**Decision.** admin-kit `./components` gains two compositions of existing primitives:
`SaveSessionActions` (primary `b2b-btn`, count, "No unsaved changes" note, inside
`StickyFormActions`) and `SaveSessionSummary` (`Alert` from a `SaveOutcome`, one item per part with a
"Show" action the host supplies). `ProductEditorSaveAction` keeps its own button (scope words) and
uses `SaveSessionSummary`; the category and sales-channel editors keep their buttons, wire them to
`session.run` and use `SaveSessionSummary`; organization and customer use both.

**UX justification for a kit component** (IX): four hosts need the same count-and-outcome
behaviour; composing `StickyFormActions` + `Alert` in each would copy the same pluralised count, the
same outcome wording and the same focus handling four times. Both are compositions; no new visual
primitive.

## R17. Category editor specifics

**Finding.** `CategoriesTree.tsx` renders the editor as a `<form>` with Save / Cancel and **no**
unsaved-changes prompt; `category.editor.after` is mounted after the Save row (the zone's contract
comment says so); selecting another category replaces the form.

**Decision.** Wrap the form in `SaveSessionProvider resetKey={category.id}`; the host part is the
existing category `PATCH`; move the zone mount above the Save row (FR-052, the comment in
`admin-contributions.ts` corrected, name unchanged — a rename would churn the closed enum and
`check:admin-zones` for no gain); add the FR-030 guard on selecting another category and on leaving;
Cancel discards. `DisplayModeOverrideRow` becomes a participant (draft = selected mode; validate =
the contracts enum; save = the existing `PUT`).

## R18. Organization and customer detail (OQ-9 = A)

**Decision.** Each screen gets `SaveSessionProvider` (reset on record id), `SaveSessionActions` in the
page head (sticky below 1024 px, as the product editor), `SaveSessionSummary`. Organization host part:
status, VAT status, order-confirmation e-mails, fulfilment strategy, restrictions and custom fields
gathered into one `PATCH` (R15). Customer host part: custom fields `PATCH`. Participants:
`DefaultPreferencesPanel` (validate = the contracts schema of the preferences body; no dry run, the
server adds no rule beyond it), `DisplayModeOverrideRow`, the negotiation panel (validate = its enum).
Immediate actions stay, with "Applies immediately" on their section headings.

**Rejected.** Option B of OQ-9 (panels only) and C (exclude) — see `spec.md`.

## R19. One component, several hosts

`DisplayModeOverrideRow`, `DefaultPreferencesPanel` and the negotiation panel render in two hosts.
They register under a fixed local key (`display-mode`, `ordering-defaults`, `price-negotiation`);
the id is unique per session because a session belongs to one host and one record. No change to the
API.

## R20. Validation for panels without server rules

Only `price_lists` base prices have server rules beyond the request schema (R6). The other
participants validate against their `@endora-commerce/contracts` schemas locally; adding dry runs
there would be speculative (Principle IV). The partial-failure path (OQ-1 A) covers the rest.

## R21. Sales-channel editor (OQ-10 = A)

`SalesChannelEditPage.tsx` wraps the existing-channel branch in `SaveSessionProvider resetKey={
channel.id}` and passes `saveSession` to `sales_channel.editor.after`; `ChannelIdentityForm`'s submit
calls `session.run(hostPart)`. `ChannelWarehouses` is unchanged except for the "Applies immediately"
badge on its heading. The create branch mounts no zone and is unchanged.

## R22. The Inventory tab's product-row settings travel in the scoped-values write (WP-4, T051)

**Finding.** `globalOnlyProductFieldsSchema` (`packages/contracts/src/product-scoped-values.ts`)
already carries `manageStock`, `backorderEnabled`, `lowStockThreshold`, `lowStockThresholdMode`,
`fulfilmentStrategy` and `fulfilmentStrategyWarehouseOrder`. The scoped-values read answers all six
in `data.product`, and the save writes a `product.*` cell to the row's own column at Global, as it
does for the SKU (`scoped-values-save.service.ts`, `writeGlobal`). The tab wrote them through
`PATCH /api/v1/admin/catalog/products/:id`, which assigns the same columns with no further rule.

**Decision.** The six settings are staged as Global cells `product:<field>` of the editor's own
write and go in its `PUT …/scoped-values` (`changes.product`). This needs no contract change and no
second request, so the product's version check guards them, and one audit entry names them as
`product.<field>@G`. The tab reads them from the editor's scoped read and no longer requests the
product itself. Setting a value back to the saved one unstages it. A warehouse order is staged as
`null` unless the strategy is *defined order*, as the `PATCH` body was. Per-warehouse stock levels
and thresholds keep their `inventory` writes (OQ-7 = B).

**Rejected.** *A second, blocking host write through the `PATCH`*. It means two writes to one
record in one Save, each with its own audit entry, and the second would not be covered by the
scoped write's version.

Held by `backend/test/contract/catalog/scoped-values-inventory-settings.test.ts` and
`admin/test/modules/catalog/product-editor-inventory-save.test.tsx`.
