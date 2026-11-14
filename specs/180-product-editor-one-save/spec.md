# Feature Specification: One Save for every panel on the product edit page

**Feature Branch**: `spec/407-product-editor-one-save`
**Created**: 2026-11-14
**Status**: Draft — open questions OQ-1…OQ-8 wait for the owner
**Input**: Issue #407 — *Product editor: one Save for every panel on the page*. The base-price panel
of `specs/161-price-book-editor/` shipped with its own *Save prices* button by owner ruling
2026-10-22 (161 research R7, OQ-1 = B; 161 FR-020 amended), "one Save for the whole product page is
issue #407". `specs/174-product-editor-scope-switcher/` gave the editor its one Save with a
staged-changes count (FR-070…FR-076); PR #1217 (issue #717) moves that Save into the sticky scope
bar at ≥ 1024 px as `ProductEditorSaveAction`. This specification assumes #1217 has merged and
builds on it.

## Context: what is on the page today

Measured on `origin/master` `2cc56ea9b` plus PR #1217. Paths are relative to
`packages/modules/catalog/src/admin/` unless they start with `packages/`.

### Zone panels contributed to the product edit page (`pages/ProductEditor.tsx`)

| Zone (mounted where) | Contributor in this repository | How it saves today |
| --- | --- | --- |
| `product.editor.pricing.after` (Pricing tab) | `price_lists` — `packages/modules/price_lists/src/admin/zones/ProductBasePrices.tsx` | **Its own *Save prices*** button, its own unsaved-changes prompt that also guards the host's tabs (`useUnsavedChangesPrompt(dirty, undefined, { guardTabsOutside })`), one `PUT /api/v1/admin/price-books/base-prices/:productId` through the `price_list.base_prices_set` Command |
| `product.editor.channels` (Channels tab body) | `sales_channels` — `packages/modules/sales_channels/src/admin/zones/ProductChannelMembership.tsx` → `EntityChannelMembership` | **Immediate** add / remove (`PUT` / `DELETE` per channel), labelled "Applies immediately" by the host (174 FR-070) |
| `product.editor.seo` (SEO tab) | `seo` — `packages/modules/seo/src/admin/zones/ProductSeoSection.tsx` | **Already in the one Save**: the section stages through `onStage`, and catalog's Save writes it with the scoped values in one Command through `seo`'s write port (174 FR-071) |
| `product.editor.pricing.before` (Pricing tab) | none in this repository (PIM connector panels live outside it) | — |
| `product.editor.details.before` (Details tab) | none in this repository | — |
| `product.editor.field.after` (beside name, description, categories, gallery, attachments and each attribute row — `components/editor/DetailsTab.tsx`, `components/ProductAttributesTab.tsx`, `pages/ProductEditor.tsx`) | none in this repository (field protection of external PIM connectors, `packages/admin-kit/src/field-protection/`) | — |

`product.content.editor` (`cms`) is **not** on this page: it is mounted on the product content
screen (`pages/ProductContentPage.tsx`, its own route, its own Save). The editor's Attributes tab
only counts it (`useAdminZone`) to decide whether to show a link card.

### Host-owned sections on the same page that still save themselves

Not zone panels, but they are "Save in several places" from the operator's point of view, so the
issue's goal ("no per-panel buttons") reaches them:

| Section | Owner | Writes |
| --- | --- | --- |
| Inventory tab — stock management / backorders, low-stock threshold and its mode (mode auto-saves on change), fulfilment strategy | `catalog` (`components/ProductInventoryTab.tsx`) | `PATCH /api/v1/admin/catalog/products/:id` — product-row fields, each with its own Save button |
| Inventory tab — per-warehouse low-stock threshold | `catalog` component calling `inventory` | `PUT /api/v1/admin/inventory/warehouse-low-stock-thresholds`, own Save per row |
| Inventory tab — stock level per warehouse | `catalog` component calling `inventory` | own Save per row; 174 FR-070 calls warehouse stock an immediate action |

Structural sections (variants, bundle slots, grouped items, links, images, attachments, packaging
units) are immediate actions by 174 FR-070 and carry the "Applies immediately" badge. They have
no Save button and are out of scope.

## Clarifications

*(None yet. The owner's answers to OQ-1…OQ-8 are recorded here when given.)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One Save writes the product and its base prices (Priority: P1)

An operator edits a product's name on the Details tab, switches to the Pricing tab, changes the
PLN base price, and presses the one Save in the scope bar. Both changes are written; there is no
*Save prices* button anywhere on the page.

**Why this priority**: it is the issue. Without it the operator has to find and press a second
Save, and an unsaved panel is easy to miss.

**Independent Test**: on a product with `price_lists` on, stage a name change and a base-price
change, press Save once, reload, and see both stored; assert no other Save control exists.

**Acceptance Scenarios**:

1. **Given** a staged name change and an edited base price, **When** the operator looks at Save,
   **Then** it counts both ("Save 2 changes") and the Pricing tab has no Save button of its own.
2. **Given** an edited base price on the Pricing tab, **When** the operator moves to the Details
   tab and back, **Then** the edited price is still there and still counted, and no prompt asked
   about the tab switch.
3. **Given** both changes, **When** the operator presses Save, **Then** both are stored, each in its
   own module's audited Command, the count returns to zero and one sentence says what was saved.
4. **Given** only a base-price change, **When** the operator presses Save, **Then** only the base
   prices are written and the product's scoped values are not touched (no catalog Command runs).

---

### User Story 2 — Nothing is written while any part is invalid (Priority: P1)

The operator enters a base price that the price rules refuse (a tier starting below the one
before it) and also a valid name change. Save writes nothing and shows the price error where the
price is, even though the operator pressed Save from the Details tab.

**Why this priority**: the issue's rule "validates all of them before writing anything". A half
save caused by a mistake the system could have caught first is the failure this feature exists
to avoid.

**Independent Test**: stage an invalid base price and a valid name; press Save; assert no request
that writes was sent and the price error and summary are shown.

**Acceptance Scenarios**:

1. **Given** an invalid base price and a valid name change, **When** the operator presses Save,
   **Then** nothing is written, every staged change stays, the base-price field shows its error,
   and a summary above the tabs lists "Base prices — 1 problem" with a link to the Pricing tab.
2. **Given** a required field cleared at Global and an invalid base price, **When** Save is
   pressed, **Then** both errors are shown at once (not one per attempt) and focus moves to the
   first one in page order.
3. **Given** a base price the panel's own checks accept but the server refuses, **When** Save is
   pressed, **Then** the server's pre-check refuses it before anything is written (FR-021).

---

### User Story 3 — A part that fails is reported on its own (Priority: P1)

Validation passed, the product fields were written, and the base-price write then failed (the
connection dropped). The operator sees that the product fields were saved and the base prices were
not, with the base prices still edited and Save offering to save the rest.

**Why this priority**: writes stay per module (Principle XIII; the issue: "the shared Save
orchestrates, it does not merge writes across modules"), so a later part can fail after an earlier
one succeeded. The operator must know exactly what is stored.

**Independent Test**: make the base-price write fail after a successful core write; assert the
summary, the kept draft and the new count. *(Exact semantics: OQ-1.)*

**Acceptance Scenarios**:

1. **Given** a successful core write and a failed base-price write, **When** the save ends,
   **Then** the summary says "Saved: product fields (1 change). Not saved: Base prices — <reason>",
   the product fields are no longer staged, the base prices are, and Save reads "Save 1 change".
2. **Given** that state, **When** the operator presses Save again, **Then** only the base prices
   are written.
3. **Given** a core write refused (version conflict, completeness gate in *refuse* mode, URL-key
   takeover, validation), **When** the save ends, **Then** no panel was written and the core
   refusal is shown as today (174 §3).

---

### User Story 4 — One unsaved-changes question for the whole page (Priority: P2)

The operator has an edited base price and presses Back, or picks another scope, or follows a
link. One dialog asks *Save / Discard / Stay* about everything unsaved on the page.

**Why this priority**: two guards (the host's and the panel's) asking in turn, or a panel's
changes lost without a question, are both possible today.

**Independent Test**: with only a panel change staged, press Back, choose each option, assert the
outcome. *(OQ-3, OQ-4.)*

**Acceptance Scenarios**:

1. **Given** only a base-price change, **When** the operator presses Back, **Then** the
   *Save / Discard / Stay* dialog opens; *Save* saves and leaves only if every part saved; *Discard*
   drops every change and leaves; *Stay* keeps everything.
2. **Given** a base-price change, **When** the operator switches the scope to a channel, **Then**
   the same dialog opens (recommended reading of OQ-4).
3. **Given** a base-price change, **When** the operator closes the browser tab, **Then** the
   browser's own leave prompt appears.

---

### User Story 5 — A module that is off takes no part (Priority: P2)

`price_lists` is switched off. The Pricing tab shows no base-price panel, Save counts only the
product's own changes, and no price request is made.

**Why this priority**: Principle XVII (NN): an off module behaves as if never installed.

**Independent Test**: off-state test with `price_lists` disabled: no participant, no request, the
count and the summary never name base prices; switch it back on and the panel takes part again.

**Acceptance Scenarios**:

1. **Given** `price_lists` off, **When** the editor opens, **Then** no base-price panel renders,
   nothing registers with the Save and no `price-books` request is sent.
2. **Given** an edited base price, **When** `price_lists` is switched off from another window and
   the editor learns of it, **Then** the unsaved base-price change is dropped with a notice
   ("Base prices are no longer available; your unsaved change there was discarded"), and the count
   drops.
3. **Given** an edited base price, **When** the write is refused because `price_lists` was switched
   off in the meantime (`503 MODULE_DISABLED`), **Then** that part is reported as not saved with
   "Base prices are switched off" and the other parts are unaffected.

---

### User Story 6 — A module author makes a panel take part (Priority: P2)

A developer writing a zone panel for the product editor uses one admin-kit hook to declare the
panel's unsaved changes, how to check them and how to save them, and drops the panel's own Save
button. The host needs no change to accept a new participant.

**Why this priority**: the issue asks for an API, not a one-off wiring of the base-price panel;
a second contributor must not need to edit `catalog`.

**Independent Test**: a test-only participant rendered into `product.editor.pricing.before` takes
part in Save (dirty count, validation refusal, save, failure) with no change to the host.

**Acceptance Scenarios**:

1. **Given** a zone whose host offers a save session, **When** a contribution registers a
   participant, **Then** the host's count, validation and save include it.
2. **Given** a zone whose host offers no save session, **When** a contribution tries to take part,
   **Then** the type-check refuses it (the handle is not among the zone's props).
3. **Given** a contribution that does not take part, **When** it renders, **Then** it works exactly
   as before.

---

### User Story 7 — The Inventory tab's settings save with the product (Priority: P3, conditional on OQ-7)

The operator changes the fulfilment strategy and the low-stock threshold and presses the one Save.

**Why this priority**: the issue's outcome is "no per-panel buttons"; these are catalog's own
sections, not zone panels, so the issue's scope sketch does not name them. OQ-7 decides.

**Independent Test**: stage a fulfilment-strategy and threshold change, press Save, assert both
stored and no Save button on the tab.

**Acceptance Scenarios**:

1. **Given** OQ-7 = B, **When** the operator edits the product-row inventory settings, **Then** they
   are staged and written by the one Save, and the tab has no Save button for them.

### Edge Cases

- **Panel on a tab the operator is not looking at.** Its changes stay staged and counted (FR-003);
  a validation error or a failure there is listed in the summary with a link to its tab, and
  following the link focuses the first error once the panel has rendered.
- **Panel still loading when Save is pressed.** A participant that has not loaded has no changes
  and takes no part. A participant whose data failed to load has no changes either.
- **Save pressed twice.** Save is inert (`aria-disabled`) while saving (#1217).
- **Version conflict on the core write** (`409`): the panels are not written (FR-015); the reload
  button ("Reload (discards your unsaved changes)") discards every change on the page, panels
  included, and says so.
- **Read-only operator** (no `catalog:write`) who may write base prices: OQ-6.
- **Base prices changed elsewhere meanwhile.** The base-price write carries no version today
  (`PUT …/base-prices/:productId`); the last write wins, as with *Save prices* today. Not changed
  here (research R11).
- **A participant whose module is on but whose write the server forbids** (a representative, who
  reads base prices and may not write them): the panel shows read-only and registers no changes,
  as today (161 FR-028).
- **An immediate action while a panel is dirty** (add a variant): the immediate action runs, the
  panel's staged change stays (174 §3 rule, extended to participants).
- **Two contributions from one module to one zone** (allowed by `AdminZone`): each registers its own
  participant under its own key.
- **A contribution that crashes** (its `ZoneErrorBoundary` catches): its participant is removed
  and its unsaved changes are reported as discarded.

## Requirements *(mandatory)*

### Functional Requirements

#### The save-participation API (admin-kit)

- **FR-001**: `@endora-commerce/admin-kit` MUST offer a save-participation API with which a zone
  contribution declares to its host editor: a translated label naming the part ("Base prices"),
  whether it has unsaved changes and how many, a validation step that may refuse with messages per
  field, and a save step that writes the part and returns its new saved state.
- **FR-002**: A contribution MUST be able to take part only in a zone whose host offers a save
  session; the offer MUST be visible in the zone's props contract, so a contribution to a zone
  without one is refused by the type-check, not at runtime.
- **FR-003**: A participant's unsaved changes MUST survive the panel being unmounted by a tab
  switch, and be shown again when the panel renders again, until they are saved or discarded.
- **FR-004**: A participant's identity MUST be derived from the contribution's module and a key
  local to that module, never declared as another module's id; a contribution that takes no part
  MUST render and behave exactly as before.
- **FR-005**: The API MUST provide the host with the list of participants with unsaved changes,
  their total change count, and one operation that runs the save in the order and with the
  failure semantics of FR-011…FR-016, so a second host editor can adopt it without re-implementing
  them.

#### The product editor's one Save

- **FR-010**: The product editor's one Save (`ProductEditorSaveAction`, #1217) MUST count the
  staged scoped changes plus every participant's changes, and be enabled when that total is above
  zero.
- **FR-011**: Pressing Save MUST first run every check: the editor's own client checks (174) and
  the validation step of every participant with changes, including any server-side pre-check the
  participant's module offers. If any check refuses, nothing MUST be written, every change MUST
  stay staged, each error MUST be shown at its field or panel, a summary MUST list every part with
  problems (each linking to its tab), and focus MUST move to the first error in page order.
- **FR-012**: After the checks pass, the editor's own changes MUST be written as today — one atomic
  Command for the product row and every scoped field, SEO included (174 FR-071, unchanged) — and each
  participant MUST be written through **its own module's API, in its own audited Command**
  (Principle XIII). The Save MUST NOT merge writes of different modules into one request or one
  transaction.
- **FR-013**: The write order MUST be: the editor's own changes first, then participants in zone
  order (the order `useAdminZone` returns: weight, then module id), one after another.
  *(OQ-2; this is the recommendation.)*
- **FR-014**: When a participant's write fails after other parts were written, the parts written
  MUST stay written and stop being staged, the failed part MUST keep its changes and show its
  error, the remaining participants MUST still be attempted, and the summary MUST name what was
  saved and what was not. Pressing Save again MUST write only what is still staged.
  *(OQ-1; this is the recommendation.)*
- **FR-015**: When the editor's own write is refused or fails, no participant MUST be written.
- **FR-016**: The outcome MUST be announced once in the existing live region ("Saved 3 changes at
  Global" for a full success; the summary text for a partial one) and shown in the summary until
  the next edit.
- **FR-017**: Every Save MUST produce one audit entry per module written: one for the catalog
  Command (174 FR-072 still holds for it) and one per participant Command. No cross-module audit
  correlation is added (research R7).

#### Panels that move to the one Save

- **FR-020**: The base-price panel (`price_lists`) MUST take part in the one Save and MUST lose its
  *Save prices* button and its own unsaved-changes prompt; its field errors, its "this product has
  no base price and is therefore not orderable" statement and its read-only rendering for callers
  the server marks not writable MUST stay. This supersedes the 2026-10-22 amendment of 161 FR-020
  and restores its original wording ("saves with the product editor's save action").
- **FR-021**: `price_lists` MUST offer a validation-only form of the base-price write that applies
  every rule of the real write and writes nothing (`contracts/base-prices-dry-run.md`), and the
  panel's validation step MUST call it.
- **FR-022**: Channel membership MUST stay an immediate, individually audited action labelled
  "Applies immediately" (174 FR-070). *(OQ-5; this is the recommendation.)*
- **FR-023**: The SEO section MUST stay in the editor's own atomic write and MUST NOT become a
  participant.
- **FR-024**: The Pricing tab heading MUST NOT carry "Applies immediately" once its only panel in
  this repository saves with Save; a contributor that still applies immediately MUST label its own
  section.
- **FR-025** *(conditional on OQ-7)*: The Inventory tab's product-row settings (stock management,
  backorders, low-stock threshold and mode, fulfilment strategy) MUST be staged and written by the
  one Save, with their Save buttons and the mode's auto-save removed; per-warehouse stock levels and
  thresholds MUST stay immediate and be labelled so.

#### Unsaved changes, scope and presence

- **FR-030**: One guard MUST cover every unsaved change on the page — the editor's and every
  participant's: Back, a scope switch, a scope-map link, browser Back and an in-app link MUST ask
  *Save / Discard / Stay* (174 FR-075); *Save* MUST run FR-011…FR-016 and proceed only if every part
  saved; *Discard* MUST drop every change, panels included.
- **FR-031**: Switching tabs MUST NOT ask anything, since no change is lost (FR-003). No panel on the
  page MUST run a prompt of its own.
- **FR-032**: Closing or reloading the browser tab with any unsaved change MUST trigger the
  browser's leave prompt.
- **FR-033**: A participant's changes MUST belong to the editor scope they were made at: switching
  scope with participant changes MUST go through the FR-030 guard, and Save MUST keep naming the
  current scope. Global-only tabs stay editable at Global only (174 FR-081). *(OQ-4; this is the
  recommendation.)*
- **FR-034**: A module that is off MUST contribute no participant: no panel, no count, no request,
  no mention in a summary (Principle XVII). A module switched off while its participant has
  changes MUST have those changes dropped with a notice; a write refused with `503 MODULE_DISABLED`
  MUST be reported as that part not saved, naming the module's part as switched off.
- **FR-035**: Save MUST be shown to an operator who may write the product (`catalog:write`) **or**
  any participant on the page; a participant MUST register changes only when its own write is
  permitted. *(OQ-6; this is the recommendation.)*

#### Cross-cutting

- **FR-040**: Every new string MUST ship in English and Polish; the API's own strings (summary,
  notices) in the kit's `core` catalogue, a participant's label in its module's catalogue.
- **FR-041**: The summary, field errors and announcements MUST meet the WCAG 2.2 AA floor of
  `.claude/skills/ux-laws/SKILL.md`: errors associated with their controls (`aria-invalid`,
  `aria-describedby`), the summary reachable from Save, links that move focus to the first error.
- **FR-042**: The documentation pages "Editing a product at a scope" (`catalog`) and "Price-book
  editor" (`price_lists`), in English and Polish, MUST say that base prices save with the product's
  Save and no longer have a button of their own.
- **FR-043**: Only the product editor adopts the API in this feature. *(OQ-8; this is the
  recommendation.)*

### Key Entities

- **Save session** — the product edit page's set of unsaved changes, across the editor and its
  participants, for one product at one editor scope.
- **Participant** — a zone panel taking part in the session: its part's label, its unsaved changes
  and their count, its errors, and its last save result.
- **Save outcome** — what one press of Save did: per part, saved, refused before writing, not
  saved (with the reason) or not attempted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the product edit page with every module of this repository on, exactly one control
  saves edits (Save); `admin/test` asserts no other Save button renders on any tab.
- **SC-002**: An operator changing the name and a base price presses Save once, not twice.
- **SC-003**: A Save refused by any check sends zero writing requests (asserted on the API double).
- **SC-004**: After a partial failure, the summary names every part's result, and the next Save
  sends only the failed part's request.
- **SC-005**: With `price_lists` off, the editor sends zero `price-books` requests and the Save count
  never includes base prices.
- **SC-006**: A test-only participant takes part in Save with zero lines changed in `catalog`.

## Assumptions

- PR #1217 merges first; `ProductEditorSaveAction` is the one Save slot this feature extends.
- The base-price write stays unversioned (last write wins); adding a version is a separate change.
- PIM connector panels outside this repository keep working unchanged; they may adopt the API later.
- No migration, no new permission code, no new Setting, no new command-palette action: the editor
  is already reachable from the palette and no configuration is introduced.

## Amendments to earlier specifications (on the owner's approval)

- **161 FR-020** — back to "the panel MUST save with the product editor's save action"; the
  2026-10-22 amendment (*Save prices*, own prompt) is superseded by FR-020 here.
- **174 FR-070** — "price-book rows" stay immediate on the price-book grid; the **base prices** in
  the product editor join the one Save. Channel membership and warehouse stock stay immediate
  (FR-022, FR-025).
- **174 FR-072** — "exactly one audit entry" applies to the catalog write; a Save with participants
  adds one entry per participant module (FR-017).
- **174 `contracts/editor-ui.md` §3** — the Save, the staged count and the switch guard cover
  participants (`contracts/editor-save-ui.md` here).

## Open questions for the owner

Each has options and a recommendation. The FRs above are written to the recommendations and are
marked where an answer would change them.

### OQ-1 — Partial failure: some parts saved, one failed

The editor's own write is one atomic Command; a participant writes through its own module. Once
two modules are written, the Save is no longer all-or-nothing.

- **A — Keep what saved, report per part, retry the rest.** Parts written stay written and leave the
  count; a failed part keeps its changes and its error; later parts are still attempted; Save again
  writes only what is left. Validation-first (FR-011) plus the server pre-check (FR-021) leaves
  only infrastructure failures and races to reach this path.
- **B — Stop at the first failure.** As A, but participants after the failed one are not attempted
  and are reported "not attempted". Fewer writes after something went wrong; still not atomic.
- **C — All or nothing across modules.** One server-side composite write, or compensating
  "undo" writes for the parts already saved. A composite merges writes of several modules into one
  transaction, which the issue excludes and Principle I resists (catalog would call every
  participant's write port); compensation writes an extra audited change the operator did not
  make and can itself fail.

**Recommendation: A.** It is what an operator can act on, it never hides a stored change, and the
pre-check makes it rare.

### OQ-2 — Order between the product's own fields and the panels

- **A — Product fields first, then panels one by one in zone order.** The product write carries the
  version check, the completeness gate and the URL-key takeover, so it is the part most likely to be
  refused; going first means a refusal writes nothing at all (FR-015). Sequential gives a
  deterministic report.
- **B — Panels first, then product fields.** A refused product write would leave panels saved.
- **C — Everything in parallel.** Faster by one round trip per participant (one today); the product
  refusal can no longer prevent panel writes.

**Recommendation: A.**

### OQ-3 — Unsaved-changes prompt across panels

- **A — One guard for the whole page.** *Save / Discard / Stay* on leaving or changing scope covers
  every part; tab switches ask nothing because nothing is lost; panels lose their own prompts.
- **B — As A, but tab switches still ask** when a panel on the tab being left has changes (today's
  base-price behaviour).
- **C — Keep each panel's prompt** beside the host's; the operator may be asked twice.

**Recommendation: A.** It needs FR-003 (changes survive unmount), which this design provides.

### OQ-4 — Editor scope (channel / language) and panels that are not scope-aware

Base prices and channel membership are the same at every scope; the Pricing and Channels tabs are
already global-only (editable at Global only).

- **A — A participant's changes belong to the scope they were made at.** Switching scope with any
  unsaved change asks *Save / Discard / Stay*, as for scoped fields; Save always names the current
  scope. One rule for everything on the page.
- **B — Scope-independent changes travel across scope switches.** The switch asks only about scoped
  changes; Save at "B2B PL × Polish" also writes the Global base prices and has to say so ("Save 2
  changes at B2B PL × Polish and base prices").
- **C — A participant declares whether it is scope-aware**; scope-aware ones behave as A, others as
  B. More API for a case with no participant today.

**Recommendation: A.**

### OQ-5 — Which panels join the Save (174 FR-070 lists price-book rows, channel membership and warehouse stock as immediate)

- **A — Base prices only.** The base-price panel already has a draft and a Save button; moving it is
  the issue. Channel membership stays immediate: it changes which scopes are valid, and staging it
  would make the scope switcher depend on unsaved state.
- **B — Base prices and channel membership.** Membership edits staged; the switcher keeps the saved
  membership until Save.
- **C — Everything, warehouse stock levels included.** Stock levels are movements, not drafts.

**Recommendation: A**, which amends 174 FR-070 for the base prices only.

### OQ-6 — Who sees Save when the operator may write base prices but not the product

Today such an operator (`price_lists` write, no `catalog:write`) can save base prices with
*Save prices*; #1217 renders no Save without `catalog:write`.

- **A — Save shows when the operator may write the product or any participant**; it then saves only
  what they may write.
- **B — Save needs `catalog:write`**; such an operator edits base prices on the price-book grid
  instead (a regression in the editor).
- **C — The panel keeps a Save of its own for that operator only.**

**Recommendation: A.**

### OQ-7 — The Inventory tab's own Save buttons (catalog-owned, not zone panels)

- **A — Out of scope**; a separate issue.
- **B — The product-row settings join the one Save** (stock management, backorders, low-stock
  threshold and mode, fulfilment strategy — they are product-row fields, which 174 FR-070 already
  says the Save covers); per-warehouse stock levels and thresholds stay immediate and are labelled
  so.
- **C — B, and the per-warehouse thresholds become an `inventory` participant** (moving that UI into
  an `inventory` zone contribution, which also removes a cross-module call from catalog).

**Recommendation: B**, delivered as its own work package (WP-5) so it can ship after the rest. It
meets the issue's outcome on the whole page without widening the module surface; C is the right
end state for the thresholds but is a module-boundary change of its own.

### OQ-8 — Do other editors adopt the API now?

Hosts with zone panels: the category editor (`category.editor.after`), organization and customer
detail, the sales-channel editor, order, quote-request and opportunity detail.

- **A — Only the product editor now**; the API is generic (FR-005) and each other editor is a
  follow-up issue when it has a panel with its own Save.
- **B — The product editor and the category editor.**
- **C — Every host with a panel that saves itself.**

**Recommendation: A.**
