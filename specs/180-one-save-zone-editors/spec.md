# Feature Specification: One Save for every admin editor with zone panels

**Feature Branch**: `spec/407-product-editor-one-save`
**Created**: 2026-11-14 · **Revised**: 2026-11-14 (owner rulings OQ-1…OQ-8; scope widened by OQ-8 = C)
**Status**: Draft — OQ-1…OQ-8 ruled; new questions OQ-9…OQ-11 wait for the owner
**Input**: Issue #407 — *Product editor: one Save for every panel on the page*. The base-price panel
of `specs/161-price-book-editor/` shipped with its own *Save prices* button by owner ruling
2026-10-22 (161 research R7, OQ-1 = B; 161 FR-020 amended), "one Save for the whole product page is
issue #407". `specs/174-product-editor-scope-switcher/` gave the product editor its one Save with a
staged-changes count (FR-070…FR-076). PR #1217 (issue #717, **merged**) moved that Save into the
sticky scope bar as `packages/modules/catalog/src/admin/components/ProductEditorSaveAction.tsx`, the
one Save component this feature extends. The owner's OQ-8 ruling (C) widens the feature from the
product editor to **every admin editor that hosts zone panels**; the directory was renamed from
`180-product-editor-one-save` for that reason and keeps its number.

## Owner rulings *(binding, 2026-11-14)*

| # | Question | Ruling |
| --- | --- | --- |
| OQ-1 | Partial failure (some parts saved, one failed) | **A** — keep what saved, report per part, the next Save writes only what is left (FR-014) |
| OQ-2 | Order between the editor's own fields and panels | **A** — the host's own changes first (blocking), then panels one by one in zone order (FR-013, FR-015) |
| OQ-3 | Unsaved-changes prompt across panels | **A** — one guard per page; tab switches ask nothing; panels lose their own prompts (FR-030, FR-031) |
| OQ-4 | Editor scope vs panels that are not scope-aware | **A** — a participant's changes belong to the scope they were made at; a scope switch asks (FR-033) |
| OQ-5 | Which product-editor panels join | **A** — base prices only; channel membership and warehouse stock stay immediate (FR-020, FR-022) |
| OQ-6 | Save for an operator who can write a panel but not the host record | **A** — Save shows when any part is writable and saves only what they may write (FR-035) |
| OQ-7 | The product Inventory tab's own Save buttons | **B** — the product-row settings join the one Save; per-warehouse stock levels and thresholds stay immediate (FR-025, WP-4) |
| OQ-8 | Do other editors adopt now? | **C** — **every editor with zone panels adopts the one Save**, against the architect's recommendation (A) |

The **amendments** to `specs/161-price-book-editor/` FR-020 and `specs/174-product-editor-scope-switcher/`
FR-070, FR-072 and `contracts/editor-ui.md` §3 are **approved** with these rulings (§ *Amendments*).

## Context: zone hosts and their panels

Measured on `origin/master` after #1217 merged. Contributions were listed from every
`zoneComponent(` in `packages/modules/*/src/admin/index.ts` (33; none under `backend/src/apps/`), hosts
from every `<AdminZone>` / `useAdminZone(` / `<RouteTabsZone>` outside admin-kit.

### Editors that adopt the one Save (have at least one panel that writes)

| Editor (host file) | Zone | Panel (module) | Saves today |
| --- | --- | --- | --- |
| **Product editor** (`packages/modules/catalog/src/admin/pages/ProductEditor.tsx`) | `product.editor.pricing.after` | `ProductBasePrices` (`price_lists`) | own *Save prices* + own prompt |
| | `product.editor.channels` | `ProductChannelMembership` (`sales_channels`) | immediate add / remove |
| | `product.editor.seo` | `ProductSeoSection` (`seo`) | already in the host's one Save (atomic) |
| | `details.before`, `pricing.before`, `field.after` | none in this repository | — |
| **Category editor** (`packages/modules/catalog/src/admin/pages/CategoriesTree.tsx`, the edit `<form>` with Save / Cancel) | `category.editor.after` (mounted after the Save row) | `CategoryDisplayMode` → `DisplayModeOverrideRow` (`price_lists`) | **auto-saves** on select change (`PUT …/pricing/display-mode-overrides/category/:id`) |
| **Organization detail** (`packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx`) | `organization.detail.after` (end of screen) | `OrganizationDefaults` → `DefaultPreferencesPanel` (`quick_order`) | own **Save** button (`PUT …/quick-order/preferences`) |
| | | `OrganizationDisplayMode` → `DisplayModeOverrideRow` (`price_lists`) | **auto-saves** on select change |
| | | `OrganizationPriceNegotiation` (`quote_requests`, `negotiation-panel.tsx`) | **auto-saves** on radio change |
| | | `OrganizationOpportunities` (`crm`) | read-only list with links |
| | | `OrganizationProjects` (`projects`) | read-only list with links |
| **Customer detail** (`packages/modules/customers/src/admin/pages/CustomerDetail.tsx`) | `customer.detail.after` | `CustomerDefaults` → `DefaultPreferencesPanel` (`quick_order`) | own **Save** button |
| | | `CustomerPriceNegotiation` (`quote_requests`) | **auto-saves** on radio change |
| **Sales-channel editor** (`packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage.tsx`) | `sales_channel.editor.after` (below the identity form) | `ChannelWarehouses` (`inventory`) | **immediate** assign / unassign / make default |

The organization and customer detail screens have **no one Save today**: their own sections save
themselves too (organization: status and VAT status auto-save on change, confirmation e-mails save on
blur, `FulfilmentStrategyPanel` and `RestrictionsPanel` have Save buttons, `CustomFieldValuesPanel`
has one; customer: `CustomFieldValuesPanel`; both also carry immediate actions — members, hierarchy,
moderation, VAT validation, organization assignment, group, addresses, block / reset / impersonate).
OQ-9 asks how far their conversion goes.

### Zone hosts that do not change, and why

| Host | Zone(s) | Panels | Why no change |
| --- | --- | --- | --- |
| Setting row editor (`packages/modules/settings/src/admin/components/SettingRowEditor.tsx`) | `settings.setting.after` | `seo` previews (robots.txt, llms.txt, default robots notice), `organizations` PL-sources warning | The panels **write nothing**: they render the host's draft (`draftText`, `dirty`); the row's own Save is already the one Save |
| Category content / product content screens (`CategoryContentPage.tsx`, `ProductContentPage.tsx`) | `category.content.editor`, `product.content.editor` | `cms` page-builder canvas | The host already saves the contribution (`onChange`; "the host saves; the contributor never does") — already one Save |
| Order detail (`packages/modules/orders/src/admin/pages/OrderDetail.tsx`) | `order.detail.after`, `order.detail.payment`; `order.shipment.row.actions`, `order.shipments.tab.actions` | `crm` linked opportunity (immediate link), `projects` and `tasks` panels (read-only), `payments` tab (reads) | No panel holds a draft; linking is an immediate action (OQ-10) |
| Quote-request detail (`RfqDetail.tsx`) | `quote_request.detail.after` | `crm` linked opportunity (immediate), `projects`, `tasks` (read-only) | as order detail |
| Opportunity detail (`OpportunityDetail.tsx`), task detail (`TaskDetail.tsx`), invoice detail (`InvoiceDetail.tsx`) | `opportunity.detail.after`, `task.detail.after`, `invoice.detail.after` | `projects`, `tasks`, `invoice_ledger` panels | read-only panels |
| Order entry (`OrderCreatePage.tsx`, `QuickOrderOnBehalfPage.tsx`), ledger sections, delivery / payment method lists | `order.entry.tabs`, `ledger.section.tabs`, `*.list.integrations` | entry modes, route tabs, link cards | not editors: each tab or card is a whole screen or a link |

The rule this table applies: **an editor adopts when one of its zone panels writes something**. A
read-only panel has no Save to merge. Immediate panels follow OQ-5's reasoning (OQ-10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One Save writes the product and its base prices (Priority: P1)

An operator edits a product's name on the Details tab, switches to the Pricing tab, changes the
PLN base price, and presses the one Save in the scope bar. Both changes are written; there is no
*Save prices* button anywhere on the page.

**Independent Test**: stage a name change and a base-price change, press Save once, reload, see both
stored; assert no other Save control exists.

**Acceptance Scenarios**:

1. **Given** a staged name change and an edited base price, **When** the operator looks at Save,
   **Then** it counts both ("Save 2 changes") and the Pricing tab has no Save button.
2. **Given** an edited base price, **When** the operator moves to the Details tab and back, **Then**
   the edit is still there and counted, and no prompt asked about the tab switch.
3. **Given** both changes, **When** Save is pressed, **Then** both are stored, each in its own
   module's write, the count returns to zero and one sentence says what was saved.
4. **Given** only a base-price change, **When** Save is pressed, **Then** only base prices are
   written; no catalog write runs.

### User Story 2 — Nothing is written while any part is invalid (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an invalid base price and a valid name change, **When** Save is pressed, **Then**
   nothing is written, every change stays, the price field shows its error, and a summary lists
   "Base prices — 1 problem" with a link to the Pricing tab.
2. **Given** a required field cleared at Global and an invalid base price, **When** Save is pressed,
   **Then** both errors show at once and focus moves to the first in page order.
3. **Given** a base price the panel's own checks accept but the server refuses, **When** Save is
   pressed, **Then** the server pre-check refuses it before anything is written (FR-021).

### User Story 3 — A part that fails is reported on its own (Priority: P1)

**Acceptance Scenarios** (OQ-1 = A, OQ-2 = A):

1. **Given** a successful host write and a failed base-price write, **When** the save ends, **Then**
   the summary says "Saved: Product fields (1 change). Not saved: Base prices — <reason>", the
   product fields are no longer staged, the base prices are, and Save reads "Save 1 change".
2. **Given** that state, **When** Save is pressed again, **Then** only the base prices are written.
3. **Given** a host write refused (version conflict, completeness gate, URL-key takeover,
   validation), **When** the save ends, **Then** no panel was written.

### User Story 4 — One unsaved-changes question per page (Priority: P2)

**Acceptance Scenarios** (OQ-3 = A, OQ-4 = A):

1. **Given** only a panel change, **When** the operator presses Back, **Then** *Save / Discard /
   Stay* opens; *Save* leaves only if every part saved; *Discard* drops every change and leaves.
2. **Given** a base-price change, **When** the operator switches scope, **Then** the same dialog opens.
3. **Given** any unsaved change, **When** the browser tab closes, **Then** the browser's leave prompt
   appears.

### User Story 5 — A module that is off takes no part (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `price_lists` off, **When** the product editor or the category editor opens, **Then** no
   display-mode or base-price panel renders, nothing registers, no `price-books` / `pricing` request
   is sent.
2. **Given** an edited panel, **When** its module is switched off and the editor learns of it,
   **Then** the change is dropped with a notice and the count drops.
3. **Given** an edited panel, **When** its write is refused with `503 MODULE_DISABLED`, **Then** that
   part is reported "switched off" and other parts are unaffected.

### User Story 6 — A module author makes a panel take part (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a zone whose host offers a save session, **When** a contribution registers, **Then** the
   host's count, validation and save include it, with no change to the host.
2. **Given** a zone whose host offers none, **When** a contribution tries to take part, **Then** the
   type-check refuses it.
3. **Given** a contribution that does not take part, **When** it renders, **Then** it works as before.

### User Story 7 — The product Inventory tab saves with the product (Priority: P2)

**Acceptance Scenarios** (OQ-7 = B):

1. **Given** changed fulfilment strategy and low-stock threshold, **When** Save is pressed, **Then**
   both are stored and the tab has no Save button for them; changing the threshold mode no longer
   saves by itself.
2. **Given** the per-warehouse stock and threshold rows, **When** the operator changes one, **Then**
   it applies immediately as today, under an "Applies immediately" badge.

### User Story 8 — The category editor's Save includes its price display mode (Priority: P2)

An operator renames a category and changes its price display mode, then presses the category
editor's Save. Both are written; the display-mode select no longer saves on change.

**Acceptance Scenarios**:

1. **Given** a renamed category and a changed display mode, **When** Save is pressed, **Then** the
   category write runs first, then the display-mode write, and both are stored.
2. **Given** only a changed display mode, **When** the operator selects another category in the
   tree, **Then** *Save / Discard / Stay* opens (the category editor gains the guard).
3. **Given** a changed display mode, **When** Cancel is pressed, **Then** the change is discarded.
4. **Given** the category write is refused (slug taken), **When** the save ends, **Then** the display
   mode is not written.

### User Story 9 — The organization and customer screens get one Save (Priority: P3, shape per OQ-9)

An operator changes an organization's ordering defaults, its price display mode and its
price-negotiation setting, and presses one Save for the screen.

**Acceptance Scenarios** (recommended OQ-9 = A):

1. **Given** changes in the three panels, **When** the operator presses the screen's Save, **Then**
   each module's write runs in zone order and the summary names each part.
2. **Given** a changed status and custom field (host sections), **When** Save is pressed, **Then** the
   host's own write (`PATCH …/organizations/:id` with `expectedUpdatedAt`) runs first; a version
   conflict writes no panel.
3. **Given** the members, hierarchy, moderation or VAT-validation actions, **When** the operator uses
   one, **Then** it applies immediately as today, labelled so.
4. The customer detail behaves the same with its two panels and its custom fields.

### User Story 10 — The sales-channel editor offers the session (Priority: P3)

**Acceptance Scenarios** (recommended OQ-10 = A):

1. **Given** the warehouse-routing panel, **When** the operator assigns a warehouse, **Then** it
   applies immediately as today, under an "Applies immediately" badge, and Save is unaffected.
2. **Given** a future participant contributed to `sales_channel.editor.after`, **When** it registers,
   **Then** the identity form's Save includes it with no host change.

### Edge Cases

- **Panel on a tab not shown** (product editor): changes stay staged and counted; errors are listed
  in the summary with a link to the tab.
- **Panel still loading or failed to load**: no changes, no part in the Save.
- **Save pressed twice**: inert while saving.
- **Version conflict on a host write** (product `409`, organization `VERSION_CONFLICT`): no panel is
  written; the reload discards every change on the page and says so.
- **Unversioned panel writes** (base prices, display mode, quick-order defaults, negotiation): last
  write wins, as today (research R11).
- **A panel the server marks not writable** (a representative on base prices; a holder of
  `customers:read` without `customers:manage` on negotiation): read-only, never dirty.
- **An immediate action while a panel is dirty**: runs; the staged change stays.
- **One component in two hosts** (`DisplayModeOverrideRow`, `DefaultPreferencesPanel`,
  `negotiation-panel.tsx`): registers in whichever session its host offers; the key is unique per
  session, not globally.
- **A zone mounted after the host's Save row** (`category.editor.after`): the mount moves above the
  row so what Save covers sits above it (FR-052).
- **A contribution that crashes**: its participant is removed; unsaved changes reported as discarded.
- **Category create form / sales-channel create form**: no id, so the zone is not mounted; nothing
  changes there.

## Requirements *(mandatory)*

### Functional Requirements

#### The save-participation API (admin-kit)

- **FR-001**: `@endora-commerce/admin-kit` MUST offer a save-participation API with which a zone
  contribution declares to its host editor: a translated label naming the part, whether it has
  unsaved changes and how many, a validation step that may refuse with messages per field, and a save
  step that writes the part and returns its new saved state.
- **FR-002**: A contribution MUST be able to take part only in a zone whose host offers a save
  session; the offer MUST be visible in the zone's props contract, so a contribution to a zone without
  one is refused by the type-check.
- **FR-003**: A participant's unsaved changes MUST survive the panel being unmounted (tab switch) and
  be shown again when it renders again, until saved or discarded.
- **FR-004**: A zone participant's identity MUST be derived from the contribution's module and a key
  local to it; a contribution that takes no part MUST behave exactly as before.
- **FR-005**: The API MUST give the host the list of participants with changes, their total count,
  and one operation that runs FR-011…FR-016, so every adopting editor shares one set of semantics.
- **FR-006**: A **host-owned section** (not a zone contribution) MUST be able to take part through
  the same hook, under the host's module (needed by the organization and customer screens, OQ-9).
- **FR-007**: admin-kit MUST offer a generic Save control with the change count and a generic outcome
  summary, composed of existing primitives, for hosts that have no Save of their own to extend.

#### Shared save semantics (every adopting editor)

- **FR-010**: An adopting editor's Save MUST count the host's own unsaved changes plus every
  participant's, and be enabled when the total is above zero.
- **FR-011**: Pressing Save MUST first run every check — the host's own client checks and every dirty
  participant's validation, including any server pre-check its module offers. If any refuses, nothing
  MUST be written, every change MUST stay, each error MUST be shown where it belongs, a summary MUST
  list every part with problems (each with a way to reach it), and focus MUST move to the first error.
- **FR-012**: After the checks pass, the host's own changes MUST be written as today, and each
  participant MUST be written through its own module's API, as that module writes today (Principle
  XIII). A Save MUST NOT merge writes of different modules into one request or transaction.
- **FR-013**: The order MUST be the host's own write first, then participants in zone order (weight,
  then module id), one after another (OQ-2 = A).
- **FR-014**: When a participant's write fails after other parts were written, the written parts MUST
  stay written and stop being staged, the failed part MUST keep its changes and show its error, the
  remaining participants MUST still be attempted, and the summary MUST name what was saved and what
  was not. Save again MUST write only what is still staged (OQ-1 = A).
- **FR-015**: When the host's own write is refused or fails, no participant MUST be written.
- **FR-016**: The outcome MUST be announced once in a live region and shown in the summary until the
  next edit.
- **FR-017**: A Save MUST produce, per module written, exactly the audit that module's write produces
  today; no cross-module correlation is added.

#### Product editor

- **FR-020**: The base-price panel (`price_lists`) MUST take part in the one Save and lose *Save
  prices* and its own prompt; its field errors, its "not orderable" statement and its read-only
  rendering for callers the server marks not writable MUST stay. (161 FR-020, original wording
  restored — approved.)
- **FR-021**: `price_lists` MUST offer a validation-only base-price write that applies every rule and
  writes nothing (`contracts/base-prices-dry-run.md`); the panel's validation MUST call it.
- **FR-022**: Channel membership MUST stay an immediate, individually audited action labelled
  "Applies immediately" (OQ-5 = A).
- **FR-023**: The SEO section MUST stay in the host's atomic write and MUST NOT become a participant.
- **FR-024**: The Pricing tab heading MUST NOT carry "Applies immediately"; a contributor that still
  applies immediately MUST label its own section.
- **FR-025**: The Inventory tab's product-row settings — stock management, backorders, low-stock
  threshold and its mode, fulfilment strategy — MUST be staged and written by the host's own write
  (the one Save), with their Save buttons and the mode's auto-save removed; per-warehouse stock levels
  and thresholds MUST stay immediate and carry the "Applies immediately" badge (OQ-7 = B).
- **FR-026**: The product editor's Save (`ProductEditorSaveAction`) MUST keep naming the editor scope
  ("Save 2 changes at B2B PL") and its #1217 placement.

#### Unsaved changes, scope, presence, permissions (every adopting editor)

- **FR-030**: One guard MUST cover every unsaved change on the page: leaving the page, Back, and the
  host's own context switches (product: scope switch, scope-map link; category editor: selecting
  another category) MUST ask *Save / Discard / Stay*; *Save* proceeds only if every part saved;
  *Discard* drops every change (OQ-3 = A).
- **FR-031**: Switching tabs MUST NOT ask anything; no panel MUST run a prompt of its own.
- **FR-032**: Closing or reloading the browser tab with any unsaved change MUST trigger the browser's
  leave prompt.
- **FR-033**: In the product editor, a participant's changes MUST belong to the editor scope they were
  made at; switching scope with them MUST go through FR-030 (OQ-4 = A). Editors without a scope reset
  their session on their own context switch (another category, another record).
- **FR-034**: A module that is off MUST contribute no participant: no panel, count, request or mention
  (Principle XVII). A module switched off while its participant has changes MUST have them dropped
  with a notice; a `503 MODULE_DISABLED` MUST be that part not saved, named as switched off.
- **FR-035**: Save MUST be shown to an operator who may write the host record **or** any participant;
  a participant MUST register changes only when its own write is permitted (OQ-6 = A).

#### Category editor

- **FR-050**: The category editor's Save MUST include the price display-mode panel; the panel MUST
  stop saving on change and lose its "saved" suffix.
- **FR-051**: The category editor MUST gain the FR-030 guard, triggered by selecting another category,
  leaving the page, or Cancel with changes (Cancel = *Discard* without a dialog, as today for its own
  fields).
- **FR-052**: The `category.editor.after` mount MUST move above the Save / Cancel row; the zone keeps
  its name, and its contract comment is corrected ("the end of the category editor's form, before its
  save row").

#### Organization and customer detail (OQ-9)

- **FR-060**: The organization detail and the customer detail MUST each get one Save (FR-007's
  control) covering their zone participants: `quick_order` ordering defaults (losing its Save
  button), `price_lists` display mode and `quote_requests` price negotiation (both losing their
  save-on-change).
- **FR-061** *(OQ-9 = A, recommended)*: The same Save MUST cover the host's own draft sections —
  organization: status, VAT status, order-confirmation e-mails, fulfilment strategy, restrictions,
  custom fields; customer: custom fields — written as the host writes them today (organization: one
  `PATCH …/organizations/:id` with `expectedUpdatedAt`, blocking); their own Save buttons,
  save-on-change and save-on-blur go. Immediate actions (members, hierarchy, moderation, VAT
  validation, sales channels, organization assignment, customer group, addresses, block / reset /
  impersonate / delete) MUST stay immediate and be labelled so.
- **FR-062**: `CustomFieldValuesPanel` (admin-kit) MUST be able to take part as a host-owned section
  (FR-006) while keeping its current standalone behaviour for hosts that do not adopt (OQ-11).

#### Sales-channel editor (OQ-10)

- **FR-070** *(OQ-10 = A, recommended)*: The sales-channel editor MUST offer a save session to
  `sales_channel.editor.after` and include participants in the identity form's Save; the warehouse
  routing panel (`inventory`) MUST stay immediate and carry the "Applies immediately" badge.

#### Cross-cutting

- **FR-080**: Every new string MUST ship in English and Polish; the kit's in the `core` catalogue, a
  participant's label in its module's catalogue.
- **FR-081**: Summaries, field errors and announcements MUST meet the WCAG 2.2 AA floor of
  `.claude/skills/ux-laws/SKILL.md`.
- **FR-082**: The documentation of every changed screen, in English and Polish, MUST say what the one
  Save covers and what applies immediately: catalog "Editing a product at a scope" and the categories
  page, `price_lists` "Price-book editor" and module page, `quick_order`, `quote_requests` and the
  organizations / customers pages that describe these panels.
- **FR-083**: A zone host added later that mounts a panel that writes MUST offer a save session
  (recorded in `specs/conventions/module-admin-surfaces.md` as a rule, with this feature as its
  provenance).

### Key Entities

- **Save session** — one adopting editor's set of unsaved changes, across the host and its
  participants, for one record (and, in the product editor, one scope).
- **Participant** — a zone panel or host-owned section taking part: label, unsaved changes and count,
  errors, last result.
- **Save outcome** — per part: saved, refused before writing, not saved (with reason), not attempted.

## Success Criteria *(mandatory)*

- **SC-001**: On each adopting editor with every module on, exactly one control saves drafts; tests
  assert no other Save button and no save-on-change in its panels.
- **SC-002**: An operator changing a host field and a panel presses Save once.
- **SC-003**: A Save refused by any check sends zero writing requests.
- **SC-004**: After a partial failure, the summary names every part and the next Save sends only the
  failed part.
- **SC-005**: With a contributing module off, the editor sends zero requests to it and never counts
  it.
- **SC-006**: A test-only participant takes part in each adopting host with zero host changes after
  that host's WP.

## Assumptions

- The participant writes keep their current endpoints and audit; the display-mode override write is
  deliberately not audited (`price-list-service.ts`, `command-coverage-ignore`: a display config
  toggle) and stays so.
- Panel writes stay unversioned; adding versions is separate.
- PIM connector panels outside this repository keep working; they may adopt later.
- No migration, no new permission code, no Setting, no command-palette action.

## Amendments to earlier specifications *(approved 2026-11-14)*

- **161 FR-020** — back to "the panel MUST save with the product editor's save action"; the
  2026-10-22 amendment (*Save prices*, own prompt) is superseded by FR-020 here.
- **174 FR-070** — "price-book rows" stay immediate on the price-book grid; the **base prices** in the
  product editor join the one Save; the Inventory tab's product-row settings are confirmed inside it
  (FR-025). Channel membership and warehouse stock stay immediate.
- **174 FR-072** — "exactly one audit entry" applies to the catalog write; a Save with participants
  adds each participant module's own audit (FR-017).
- **174 `contracts/editor-ui.md` §3** — the Save, the staged count and the switch guard cover
  participants (`contracts/product-editor-save-ui.md`).

T090 writes the pointers into those files.

## Open questions for the owner (new, raised by OQ-8 = C)

### OQ-9 — How far do the organization and customer screens convert?

They have no one Save today; their own sections save in several different ways (on change, on blur,
per-section buttons), and many of their actions are immediate.

- **A — One Save for the screen covering the zone panels and the host's draft sections**; immediate
  actions stay immediate and labelled (the OQ-5 rule). One save style per screen. Largest: about ten
  host sections across two screens (WP-7, WP-8).
- **B — One Save covering the zone panels only**; the host's sections keep their own saves until a
  follow-up. Smaller, but leaves two save styles side by side on one screen — the confusion #407
  exists to remove.
- **C — Leave them out**: read OQ-8 C as "editors with one form" (product, category, sales channel),
  and treat organization / customer as detail screens with self-saving sections.

**Recommendation: A**, shipped as its own work packages after the product and category editors, so
the shared API is proven first.

### OQ-10 — Immediate list panels on other editors

`inventory`'s warehouse routing on the sales-channel editor and `crm`'s *link opportunity* on order and
quote-request detail are list actions like channel membership.

- **A — They stay immediate and labelled "Applies immediately"**, as OQ-5 ruled for membership; the
  sales-channel editor still offers a session (cheap; a future participant needs no host change).
  Order and quote-request detail have no draft panel and do not adopt.
- **B — Stage them**: warehouse assignments and opportunity links wait for Save.
- **C — As A, but the sales-channel editor offers no session until it has a participant** (YAGNI).

**Recommendation: A.**

### OQ-11 — `CustomFieldValuesPanel` under a page Save

`CustomFieldValuesPanel` is an admin-kit component with its own Save, used on the organization and
customer screens and elsewhere.

- **A — Make it able to take part (FR-062) and keep its own Save where the host does not adopt.**
- **B — Convert it everywhere it is used**, adopting a session on each of those hosts too.

**Recommendation: A** (only if OQ-9 = A; moot otherwise).
