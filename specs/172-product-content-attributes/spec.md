# Feature Specification: Product content attributes (Page Builder documents on the product page)

**Feature Branch**: `feat/172-product-content-attributes`
**Created**: 2026-11-04
**Status**: Implemented
**Issue**: #730
**Input**: Owner request (2026-11-04): operators can define product attributes whose value is a
**Page Builder document** — the same Page Builder the CMS pages use. The values are edited on the
product's edit screen in the admin. On the storefront they are shown in the product page's
**"Opis"** (description) tab, below the plain-text description, ordered by attribute position, and
**never** in the **"Parametry"** (parameters) tab. Plus the owner's rulings recorded below.

**Related**: commit `fcf6daa76` *"feat(catalog): author Page Builder content for a category's
storefront page"* — the direct precedent, which has no spec directory of its own; its module page
is `packages/modules/catalog/docs/catalog/category-content.md`. `specs/151-page-builder-translate/`
(the Page Builder **Translate** action), `specs/163-product-data-scopes/` (per-channel product
values), `specs/166-asset-reference-visibility/` (asset references), feature 061 (product
attributes as catalogue extensions of custom-field definitions) and feature 012 FR-030 (the
"Parametry produktu" visibility flag) — both pre-migration, cited for provenance.

## Context

Measured on `master` at `aaaf3ee87`:

- **A product's long-form copy is one plain-text field.** The storefront product page
  (`storefront/app/(catalog)/p/[slug]/page.tsx`) renders `product.description` as a single
  pre-wrapped paragraph in the "Opis" tab, and adds that tab only when the description is
  non-empty. There is no way to give a product formatted content — a buying guide, a feature
  banner, a comparison table, an embedded video — short of a CMS page linked from elsewhere.
- **Categories already have exactly this.** Since `fcf6daa76` an operator authors a Page Builder
  document per language for a category; the catalogue owns and stores the document, the CMS module
  contributes the editing canvas into an admin zone the catalogue mounts, and the storefront draws
  it through the same render boundary CMS pages use. The catalogue cannot be switched off and the
  CMS can, so the catalogue neither depends on nor imports the CMS.
- **Product attribute values are a flat map read by many consumers.** A product's attribute values
  are read by search indexing, product feeds, product comparison, promotions, price lists, carts,
  quote requests and the storefront "Parametry" tab. Each of them expects a short scalar value; a
  structured document passed through any of them would be rendered as meaningless text (the
  storefront value coercion turns an object into `"[object Object]"`) or would bloat list and
  index reads.
- **Defect — the "Parametry" tab ignores the visibility flag.** The product page renders, inside
  the "Parametry" tab, a raw table of **every** entry of `product.attributeValues` — technical keys
  as row headers, `String(value)` as cells — *above* the filtered list
  (`storefront/components/attributes/ParametryTab.tsx`) that shows only attributes the operator
  marked visible on the product page. The raw table therefore publishes attributes the operator
  deliberately hid, which is what feature 012 FR-030 forbids, and it makes the tab appear for a
  product whose only values are hidden ones. Confirmed by reading the page at the commit above
  (the `hasAttributeValues` branch of the `parameters` tab).

## Owner rulings *(binding; recorded 2026-11-04, not to be reopened by this feature)*

- **OR-1 — Storefront placement.** Content attributes render inside the "Opis" tab, **below** the
  existing plain-text description, in attribute-position order. The "Opis" tab is shown when a
  product has page-builder content and no plain description.
- **OR-2 — Attribute sets.** Content attributes join attribute sets like any other attribute; a
  product carries the content attributes its attribute set names.
- **OR-3 — Block palette.** The editor offers the **full** CMS block palette; there is no
  restricted "product content" block context.
- **OR-4 — No label heading.** The storefront prints no heading of its own above a content
  attribute; the document is shown exactly as authored, and an operator who wants a heading adds a
  heading block to the document.

Recorded 2026-11-04 at the plan stage (Alan), on points the plan raised:

- **OR-5 — Attribute deletion for every type (FR-007 – FR-009).** The attributes screen gains a
  delete action for **every** attribute value type, not only for content attributes, with a
  confirmation that shows the attribute's usage counts before the operator confirms. The scope
  growth is accepted, as the plan proposed.
- **OR-6 — Product deletion stays a soft delete (FR-062).** Deleting a product does not physically
  delete its content. The content becomes unreachable everywhere, its asset references are no
  longer reported, and it is physically removed when the product row itself is purged.
- **OR-7 — Product content is hidden while the CMS is off (FR-051), even though category content
  still renders in that state.** The inconsistency is accepted for this feature. Aligning category
  content with the product rule is a separate follow-up and out of scope here.
- **OR-8 — The catalogue may probe the CMS module's presence without a port.** The catalogue's
  decision to omit product content while the CMS is off is a presence check with no port and no
  declared dependency. The ruling accepts this. The code that makes the check carries a comment
  explaining why no port or dependency is declared: the catalogue cannot be deactivated, the CMS
  can, and the check only gates a projection of the catalogue's own data.

## Clarifications

### Session 2026-11-04

- Q: Where is a content attribute shown on the storefront? → A: In "Opis", below the plain
  description, by attribute position; never in "Parametry" (OR-1).
- Q: Do content attributes take part in attribute sets? → A: Yes, like every attribute (OR-2).
- Q: Which blocks may an operator use? → A: The full CMS palette (OR-3).
- Q: Is each content attribute's label printed as a heading above its content in "Opis"? → A: No;
  the content is shown as authored, and a heading is a block the operator adds (OR-4).
- Q: Is the Page Builder **Translate** action (feature 151) in scope? → A: Yes. It is a property of
  the CMS editor the catalogue hosts, and it costs this feature only telling the editor which
  language is being edited — exactly what category content does. Its own on/off switch, credentials
  and permission rules (feature 151) apply unchanged.
- Q: Are per-sales-channel values, import/export, PIM/ERP connectors, bulk edit, product feeds and
  search indexing of the content in scope? → A: No — phase 1 excludes them, each with an explicit
  "rejected or skipped, never passed through" behaviour (FR-040 – FR-047).

### Session 2026-11-04 (plan stage)

- Q: The admin has no attribute delete action today. Is it added only for content attributes, or
  for every attribute type? → A: For every attribute type. The confirmation shows usage counts.
  This scope growth is accepted (OR-5, FR-007 – FR-009).
- Q: Product deletion is a soft delete. Must content be physically deleted when the product is
  deleted? → A: No. The content becomes unreachable everywhere, its asset references stop being
  reported, and it is physically removed when the product row is purged (OR-6, FR-062).
- Q: Category content keeps rendering while the CMS is off, but FR-051 hides product content in
  that state. Should the two be aligned in this feature? → A: No. The inconsistency is accepted
  here, and aligning category content is a separate follow-up (OR-7).
- Q: May the catalogue check whether the CMS is present without declaring a port or a dependency?
  → A: Yes, as long as the code explains why no port or dependency is declared (OR-8).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Define a content attribute and add it to an attribute set (Priority: P1)

A catalogue manager opens **Catalog → Attributes**, creates an attribute named "Buying guide"
(pl: "Poradnik zakupowy") and chooses the value type **Page Builder content**. The form no longer
offers the switches that make no sense for a document — searchable, filterable, variant axis,
slider, comparable, quick-searchable, promotion rule, price rule, mass-editable, required, shown in
"Parametry", per-channel values — and states that the value is kept per language. They save it and
add it to the "Power tools" attribute set at the position they want.

**Why this priority**: without a definition there is nothing to edit or render; it is the
foundation of every other story.

**Independent Test**: create an attribute of the new type, attempt to switch on each excluded
capability through the screen and through the API, add the attribute to a set, and verify that
the attribute is stored with every excluded capability off, is language-scoped, and appears in the
set at its position.

**Acceptance Scenarios**:

1. **Given** the attribute form, **When** the operator picks **Page Builder content**, **Then** the
   excluded capability switches are not offered and the form states that the content is kept per
   language.
2. **Given** a request that creates or updates a content attribute with any excluded capability
   switched on, **When** it is submitted, **Then** it is refused with a validation error naming the
   capability, and nothing is stored.
3. **Given** a content attribute, **When** the operator adds it to an attribute set and reorders the
   set, **Then** it keeps its position like any other member.
4. **Given** an existing attribute of another type, **When** the operator tries to change its type
   to **Page Builder content** (or a content attribute's type to anything else), **Then** the change
   is refused.
5. **Given** a custom field definition for any entity other than a product (an order, an
   organization, a customer…), **When** an operator or a request tries to give it the Page Builder
   content type, **Then** the type is not offered and the request is refused.

---

### User Story 2 — Author a product's content in the admin (Priority: P1)

The catalogue manager opens a product of the "Power tools" set. In the attributes area, instead of
an input, the "Buying guide" attribute shows a compact card: its name, a filled/empty status per
language (English, Polish), a short summary of what is stored, and an **Edit content** action. The
action opens a full-width editing screen for that one attribute of that one product: a language
switch, the Page Builder canvas with the full block palette, and **Save content**, which stores
every language edited. Back on the product, the card shows the new status.

**Why this priority**: it is the operator half of the feature; together with User Story 3 it is the
MVP.

**Independent Test**: on a product whose set contains a content attribute, open the editor from the
card, build a document in two languages, save, return, and verify the card's per-language status
and summary, the audit entry, and that the product's other attribute values are unchanged.

**Acceptance Scenarios**:

1. **Given** a product whose attribute set contains content attributes, **When** the operator opens
   its attributes area, **Then** each content attribute is shown as a card (name, per-language
   filled/empty status, summary, **Edit content**) in attribute-set position order — never as an
   inline canvas inside the product form.
2. **Given** the card, **When** the operator chooses **Edit content**, **Then** a dedicated editing
   screen opens for that product and attribute, with a language switch covering the catalogue's
   editing languages plus any language already stored, the Page Builder canvas offering the full
   CMS block palette, and a way back to the product.
3. **Given** edits in several languages, **When** the operator saves, **Then** all edited languages
   are stored in one save, the operator is told it succeeded, and the save is recorded in the audit
   log naming the product, the attribute and the languages saved — not the documents.
4. **Given** unsaved edits on the editing screen, **When** the operator tries to leave it, **Then**
   they are warned that unsaved changes will be lost.
5. **Given** an operator without catalogue write permission, **When** they open the editing screen,
   **Then** they can see the content but cannot save it.
6. **Given** the Page Builder **Translate** action is switched on and configured (feature 151),
   **When** the operator edits a language, **Then** the canvas offers **Translate** into that
   language, and its result is stored only when the operator saves.
7. **Given** a product that has not been saved yet (being created), **When** the attributes area
   shows a content attribute, **Then** the card says the content can be edited once the product is
   saved, and offers no editing action.
8. **Given** a document emptied of every block in a language, **When** the operator saves, **Then**
   that language counts as empty and the card shows it as empty.

---

### User Story 3 — Customers see the content in the product page's "Opis" tab (Priority: P1)

A customer opens the product page of a drill. The "Opis" tab shows the plain description first,
then the "Buying guide" content, then any further content attribute of the product, in attribute
position order. A second product has no plain description but has a buying guide — its "Opis" tab
is still there and shows the guide. Neither appears in "Parametry".

**Why this priority**: it is what the feature exists for; without it the authored content is
invisible.

**Independent Test**: seed products with (a) a description and two content attributes in a known
set order, (b) content only, (c) neither; load each product page and verify the tab's presence,
the order, the language resolution, that the page's server-rendered HTML contains the content, and
that "Parametry" contains none of it.

**Acceptance Scenarios**:

1. **Given** a product with a plain description and content attributes, **When** a customer opens
   its page, **Then** the "Opis" tab shows the description first and then each non-empty content
   attribute, ordered by the attribute's position in the product's attribute set (ties: by the
   attribute's key).
2. **Given** a product with content and no plain description, **When** a customer opens its page,
   **Then** the "Opis" tab is shown and holds the content.
3. **Given** a product with neither a description nor any non-empty content, **When** a customer
   opens its page, **Then** no "Opis" tab is shown — exactly as today.
4. **Given** content stored in Polish and English, **When** the page is requested in Polish, **Then**
   the Polish document is shown; **When** it is requested in a language with no document, **Then**
   the document is resolved in the order the category content uses: the visitor's language, the
   sales channel's default language, English, then any language that has content; a language
   whose document holds no block is skipped.
5. **Given** any product, **When** the "Parametry" tab is rendered, **Then** it shows no content
   attribute, under any circumstances.
6. **Given** content containing operator-typed HTML or a block owned by a switched-off module,
   **When** it is rendered, **Then** the HTML is sanitised and the block is not drawn, exactly as
   on a CMS page.
7. **Given** a saved change, **When** a customer next loads the product page, **Then** the change
   is shown.

---

### User Story 4 — The "Parametry" tab shows only attributes marked visible (Priority: P1)

A product carries an internal attribute "Supplier code" that the operator did **not** mark as shown
on the product page. Today the "Parametry" tab lists it in a raw table with its technical key.
After this feature the tab shows only the filtered "Parametry produktu" list, and a product whose
only values are hidden ones shows no "Parametry" tab at all.

**Why this priority**: it is a live disclosure defect on every product page, independent of the
rest of the feature, and the content-attribute rule "never in Parametry" depends on the tab
honouring its filter.

**Independent Test**: seed a product with one visible and one hidden attribute and another with
only hidden attributes; verify the first product's tab lists only the visible one with its label,
and the second product has no "Parametry" tab.

**Acceptance Scenarios**:

1. **Given** a product with attributes visible and not visible on the product page, **When** the
   "Parametry" tab renders, **Then** only the visible attributes are listed, by their labels and
   rendered values, and no technical key or raw value appears.
2. **Given** a product whose only attribute values belong to attributes not visible on the product
   page, **When** its page renders, **Then** no "Parametry" tab is shown.

---

### User Story 5 — Switching the CMS off is safe and reversible (Priority: P2)

A deployment's operator switches the CMS module off. Product content already authored is kept
untouched. In the admin, each content attribute card still shows its per-language status, and says
that editing the content requires the CMS module; the editing screen says the same instead of an
empty canvas. On the storefront, products show no page-builder content and no empty "Opis" tab
because of it. When the CMS is switched back on, everything is as it was.

**Why this priority**: required by constitution Principle XVII, but it concerns an uncommon
operation; the MVP is usable without it being exercised.

**Independent Test**: author content on two products, switch the CMS off, verify admin and
storefront behaviour and that the stored content is byte-identical, switch it on, verify the
content renders and edits again.

**Acceptance Scenarios**:

1. **Given** the CMS module is off, **When** the operator opens a product with content attributes,
   **Then** each card shows its per-language status and a notice that editing requires the CMS
   module, and offers no editing action.
2. **Given** the CMS module is off, **When** the operator opens the editing screen directly,
   **Then** it shows the same notice and no canvas, and offers no save.
3. **Given** the CMS module is off, **When** a customer opens a product page, **Then** no
   page-builder content is drawn, and a product whose only "Opis" material is page-builder content
   shows no "Opis" tab; the plain description is unaffected.
4. **Given** the CMS module is switched back on, **When** the admin and the storefront are used,
   **Then** the content is editable and rendered exactly as before, with nothing lost.

---

### User Story 6 — Content follows the product's lifecycle (Priority: P3)

The catalogue manager duplicates a product; the copy carries the original's content. They remove the
content attribute from the product's set; the content stops showing on the storefront and in the
editor, but comes back if the attribute is added again. They try to delete an image from the
assets library that a product's content embeds; the deletion is blocked and names the product.
They clean up the attributes screen: for any attribute — a content attribute or an ordinary one —
**Delete** shows where the attribute is still used before they confirm (OR-5).

**Why this priority**: correctness at the edges; none of it is needed to author and show content.

**Independent Test**: exercise duplication, set membership changes, product deletion, attribute
deletion (content and non-content types) and asset deletion against products with content, and
verify each outcome below.

**Acceptance Scenarios**:

1. **Given** a product with content, **When** it is duplicated, **Then** the duplicate carries an
   identical copy of every content attribute value.
2. **Given** a product with content for an attribute, **When** that attribute leaves the product's
   attribute set (or the product moves to a set without it), **Then** the content is neither shown
   on the storefront nor offered in the admin, and is kept; **When** the attribute is a member
   again, **Then** the content is shown again.
3. **Given** a product with content, **When** the product is deleted, **Then** its content can no
   longer be reached through any admin or storefront read, and the assets it embedded are no
   longer reported as referenced by it (OR-6).
4. **Given** a content attribute with stored content on N products, **When** the operator deletes
   the attribute, **Then** they are told N products carry content for it before confirming, and
   on confirmation the content is deleted with the attribute.
5. **Given** a library asset embedded in a product's content, **When** someone tries to delete the
   asset, **Then** the deletion is blocked and the blocking reference names the product.
6. **Given** an attribute of any type (text, number, select, boolean, Page Builder content…),
   **When** the operator chooses **Delete** on the attributes screen, **Then** a confirmation
   shows how many attribute sets contain it, how many products hold a value for it and how many
   carry content for it, before anything is deleted (OR-5).
7. **Given** an attribute that is still in an attribute set, or for which a product holds a
   value — a value on the product, a per-sales-channel value or a variant value — **When** the
   operator tries to delete it, **Then** the confirmation says why and offers no confirm, and a
   delete request is refused with nothing changed.
8. **Given** a select attribute with options that is in no set and has no product values, **When**
   the operator confirms the deletion, **Then** the attribute, its options and its definition are
   removed together in one audited operation, and promotion conditions, price-list rows and feed
   selection rules that name its key stop matching any product.

### Edge Cases

- **Oversized content**: a save whose content for one product and attribute exceeds the size
  ceiling across all its languages is refused with an error that names the limit; nothing is
  stored.
- **Two operators** edit the same product's content at once: the last save wins for that attribute,
  as for category content; other attributes and the product's own fields are not affected.
- **Content attribute and product form together**: saving the product form never changes content
  values, and saving content never changes the product's other fields or attribute values.
- **A content value sent through the ordinary attribute-values path** (product create/update, the
  bulk editor, an import, an integration) is refused for that attribute rather than stored.
- **The operator may edit the catalogue but lacks the CMS read permission** that the editing canvas
  requires: the editing screen shows the same "no editor available" notice as when the CMS is off.
- **Archived or inactive product**: content is kept; the storefront shows nothing because the
  product page is not served.
- **Configurable products**: content belongs to the product, not to its variants; selecting a
  variant does not change the content shown.
- **A product without an attribute set** has no content attributes, as it has no other attributes.
- **A document holding only blocks of switched-off modules** draws nothing visible; it does not on
  its own make an otherwise empty "Opis" tab appear.
- **Product visible in some sales channels or languages only** (feature 163 scopes): content is
  shown wherever the product page is served and nowhere else; it adds no visibility rule of its own.

## Requirements *(mandatory)*

### Functional Requirements

**Attribute definition**

- **FR-001**: Operators MUST be able to create a product attribute whose value type is **Page
  Builder content**, with the same identity fields as any attribute (key, per-language label).
- **FR-002**: The Page Builder content type MUST be admissible only for product attributes; every
  other custom-field host MUST neither offer nor accept it.
- **FR-003**: For a content attribute the system MUST hold these capabilities off and refuse any
  request that switches one on: searchable, filterable, variant axis, slider display, comparable,
  quick-order searchable, promotion rule, price rule, mass-editable, required, shown in "Parametry",
  per-sales-channel values.
- **FR-004**: A content attribute MUST always be language-scoped; the setting MUST NOT be
  switchable off.
- **FR-005**: The value type of an existing attribute MUST NOT be changed to or from Page Builder
  content.
- **FR-006**: Content attributes MUST be assignable to attribute sets, positioned and reordered
  within them exactly like other attributes (OR-2).
- **FR-007**: Operators MUST be able to delete an attribute of **every** value type from the
  attributes screen (OR-5). Before confirmation the system MUST show the attribute's usage: how
  many attribute sets contain it, how many products hold a value for it, and how many products
  carry content for it. Deleting a content attribute MUST delete that content with the attribute.
- **FR-008**: The deletion MUST be refused, with nothing changed, while the attribute is a member
  of any attribute set or while any product that has not been deleted holds a value for it — on
  the product, as a per-sales-channel value, or on one of its variants. The confirmation MUST say
  which of these blocks it and MUST offer no confirm. The attribute's definition, its catalogue
  settings and its options MUST be removed together in one audited operation.
- **FR-009**: Promotion conditions, price-list rows and product feed rules that name a deleted
  attribute's key MUST stop matching products. They MUST NOT be deleted by the attribute deletion,
  and they MUST NOT block it. The confirmation MUST state this.

**Storage and validation**

- **FR-010**: Each product × content attribute MUST hold at most one value: one Page Builder
  document per language, in the same per-language shape category content uses.
- **FR-011**: Content values MUST be stored apart from the product's ordinary attribute values, so
  that no consumer of ordinary attribute values (search, product feeds, comparison, promotions,
  price lists, carts, quote requests, the "Parametry" tab, product list reads) ever receives them.
- **FR-012**: The system MUST refuse a content value whose JSON size across all its languages
  exceeds the ceiling category content uses (1 MiB), and MUST refuse a value for an attribute that
  is not a content attribute of a set the product belongs to.
- **FR-013**: A language whose document holds no block MUST be treated as empty; a value whose every
  language is empty MUST be treated as no value.
- **FR-014**: The system MUST refuse a content value submitted through the ordinary attribute-values
  path of product create/update, rather than storing or coercing it.

**Admin editing**

- **FR-020**: The product editor's attributes area MUST show each content attribute of the
  product's set as a compact card with the attribute's label, a filled/empty status per editing
  language, a short summary of the stored content, and an **Edit content** action — never an inline
  canvas.
- **FR-021**: **Edit content** MUST open a dedicated full-width editing screen for one product and
  one attribute, with a language switch (the catalogue's editing languages plus any language
  already stored), the Page Builder canvas, a save that stores every edited language at once, a
  warning before unsaved changes are discarded, and a way back to the product.
- **FR-022**: The editing canvas MUST offer the full CMS block palette (OR-3), MUST be the CMS
  module's own editor contributed into a place the catalogue owns, and the catalogue MUST NOT
  depend on or import the CMS module.
- **FR-023**: Reading content in the admin MUST require catalogue read permission; saving it MUST
  require catalogue write permission. No new permission is introduced.
- **FR-024**: Every content save MUST run as an audited catalogue command whose audit entry names
  the product, the attribute and the languages saved, without the documents themselves.
- **FR-025**: The Page Builder **Translate** action (feature 151) MUST be available on the editing
  canvas for the language being edited, under feature 151's own enablement and permission rules,
  and its result MUST be stored only by the operator's save.
- **FR-026**: For a product not yet saved, the card MUST state that content can be edited after the
  product is saved and MUST offer no editing action.
- **FR-027**: Every new admin string (type name, card, editing screen, notices, errors, audit
  labels) MUST ship in English and Polish.

**Storefront**

- **FR-030**: The product page MUST render, in the "Opis" tab and below the plain description, each
  content attribute of the product's current attribute set that has a non-empty document in the
  resolved language, ordered by attribute-set position, ties broken by attribute key (OR-1).
- **FR-031**: The "Opis" tab MUST be shown when the product has a plain description **or** at least
  one content attribute that renders; it MUST NOT be shown when it has neither.
- **FR-032**: Content MUST NOT appear in the "Parametry" tab or in any other product surface
  (listings, quick views, comparison, cart, quotes, feeds, search results) in this feature.
- **FR-033**: Each content document MUST be resolved to one language in this order: the visitor's
  language, the sales channel's default language, English, then any language with content;
  languages with no block are skipped.
- **FR-034**: Content MUST be drawn by the storefront's single Page Builder render boundary, with the
  same blocks, HTML sanitisation and module-presence rule as CMS pages, and MUST be part of the
  server-rendered product page (Principle VII).
- **FR-035**: A saved content change MUST be visible on the next product page load, and saving
  content MUST NOT cause a product re-index or a product feed regeneration.
- **FR-036**: Content MUST be exposed to customers only on the product page response that already
  carries the product's description; the response size of product list reads MUST NOT grow because
  of content.
- **FR-037**: The storefront MUST NOT print the attribute's label, or any other heading of its own,
  above a content attribute's content in the "Opis" tab; the content is rendered exactly as
  authored (OR-4).

**"Parametry" defect**

- **FR-038**: The "Parametry" tab MUST list only attributes marked visible on the product page,
  shown by label and rendered value; the raw listing of every attribute value by technical key MUST
  be removed.
- **FR-039**: The "Parametry" tab MUST be shown only when at least one attribute visible on the
  product page has a value for the product.

**Phase-1 exclusions — explicit behaviour, never pass-through**

- **FR-040**: **Per-sales-channel overrides**: a request to give a content attribute a channel
  override MUST be refused.
- **FR-041**: **Product export**: content attributes MUST be omitted from every export; **product
  import**: a column or field targeting a content attribute MUST be rejected with a per-row error
  naming the attribute, and the rest of the row processed as today.
- **FR-042**: **PIM/ERP connectors and the external (integration) API**: content attributes MUST
  NOT be offered for mapping, MUST NOT appear in outbound product data, and an inbound value
  targeting one MUST be rejected and reported, never stored.
- **FR-043**: **Bulk edit**: content attributes MUST NOT be offered by the products bulk editor,
  and a bulk request naming one MUST be refused.
- **FR-044**: **Product feeds**: content attributes MUST NOT be offered as feed fields and MUST NOT
  appear in any generated feed.
- **FR-045**: **Search**: content MUST NOT be indexed or matched by storefront search, quick-order
  search or the admin product search.
- **FR-046**: **Promotions, price lists, comparison, filters**: content attributes MUST NOT be
  offered in any of their pickers.
- **FR-047**: Each exclusion above MUST have a test asserting the refusal or omission.

**Module presence (Principle XVII)**

- **FR-050**: With the CMS module off, every stored content value MUST be kept unchanged; the admin
  card MUST show its per-language status and a notice that editing requires the CMS module, and the
  editing screen MUST show that notice instead of a canvas and offer no save.
- **FR-051**: With the CMS module off, the storefront MUST show no page-builder content and MUST
  NOT show an "Opis" tab that would hold only page-builder content; the plain description is
  unaffected. This is stricter than category content, which keeps rendering while the CMS is off.
  The inconsistency is accepted (OR-7), and aligning categories is a follow-up outside this
  feature.
- **FR-052**: Switching the CMS module back on MUST restore editing and rendering with no data loss
  and no operator action.

**Lifecycle**

- **FR-060**: Duplicating a product MUST copy its content values.
- **FR-061**: Content for an attribute that is no longer a member of the product's attribute set
  MUST be kept, and MUST be neither rendered nor offered for editing until the attribute is a
  member again.
- **FR-062**: Once a product is deleted, its content values MUST be unreachable through every admin
  and storefront read, and the assets they embed MUST no longer be reported as referenced by it.
  Product deletion stays a soft delete (OR-6). The content values MUST be physically removed when
  the product row itself is purged.
- **FR-063**: A library asset embedded in a product's content MUST be reported as referenced by that
  product and MUST NOT be deletable while referenced, as for category content.

### Key Entities

- **Content attribute**: a product attribute whose value type is Page Builder content. Its identity
  (key, per-language label, value type) lives where every product attribute's identity lives — a
  product-host custom-field definition — and its catalogue behaviour on the catalogue's attribute
  extension, with every capability of FR-003 held off and language scoping held on. Member of
  attribute sets with a position.
- **Product content value**: owned by the catalogue; one per product × content attribute; holds one
  Page Builder document per language (the per-language envelope CMS pages and category content
  use), capped at 1 MiB across its languages. Stored apart from the product's ordinary attribute
  values; read only by the product page and the admin editing screen. Deleted with its attribute;
  unreachable once its product is soft-deleted, and physically removed when the product row is
  purged (OR-6); kept, unrendered, while its attribute is outside the product's set.
- **Content editor contribution**: the CMS module's Page Builder canvas, contributed into an
  editing place the catalogue owns — the same seam category content uses. The catalogue holds the
  draft and does the save; the contributor never saves.
- **Asset reference (product content)**: a new kind of library-asset reference recording that a
  product's content embeds an asset.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can create a content attribute, add it to a set, author a two-language
  document on a product and see it on the storefront in under 10 minutes, with no developer help.
- **SC-002**: On every product page, 100 % of content attributes appear in "Opis" in set-position
  order and 0 % appear in "Parametry" — verified across products with description only, content
  only, both and neither.
- **SC-003**: 0 attributes not marked visible on the product page appear anywhere in the "Parametry"
  tab, across the whole seeded catalogue.
- **SC-004**: Switching the CMS module off and on again leaves 100 % of stored content
  byte-identical and renderable.
- **SC-005**: For every phase-1 exclusion (FR-040 – FR-046), an attempt to route content through
  the excluded path is refused or omitted — never stored, emitted or coerced to text — in 100 % of
  the tested paths.
- **SC-006**: Product listing pages and search results are no larger and no slower for a catalogue
  where every product carries content than for one where none does (within normal measurement
  noise).
- **SC-007**: A product page carrying content is fully readable with scripting disabled, i.e. the
  content is in the page as served.

## Assumptions

- **Ownership follows the category-content precedent.** The catalogue owns content attributes,
  their values, their storage, their admin screens and their save; the CMS module only contributes
  the canvas. No new module is created: the requirement is a new value type of an existing
  catalogue concept.
- **Dedicated editing screen rather than a drawer.** A Page Builder canvas needs a page's width —
  the reason category content has its own screen — and a screen can be linked to directly and keeps
  the product form's own unsaved-changes handling separate from the content's.
- **The card's summary is text, not a rendered preview** (for example the number of blocks and the
  opening words of the first text), so the product form neither loads the storefront renderer nor
  the documents of every language at full size. The operator sees the real rendering on the
  storefront preview they already use.
- **Editing languages** are those the product editor already edits product copy in (English and
  Polish today), plus any language already stored, as on the category content screen.
- **Product-level only.** Content belongs to the product, not to variants; variant-level content is
  out of scope.
- **Creating a content attribute is allowed while the CMS is off**; the attribute form says that
  editing its values requires the CMS module. Creation is harmless and matches "off is
  non-destructive and reversible".
- **Customer audience.** Content attributes follow the same audience rule as other product
  attributes for what reaches customers; no new audience setting is introduced.
- **No new command-palette action and no new navigation entry.** The feature adds no top-level
  admin surface: the attributes screen is already reachable, and the editing screen is a
  sub-screen of a product, like the category content screen of a category.
- **No new Settings entry.** The size ceiling is a fixed product rule as for category content; the
  Translate action's switch and credentials are feature 151's existing settings.
- **Tenancy.** Product content is catalogue data, global like the product it belongs to; it is
  reached by customers only through the product page's existing channel and visibility rules
  (Principles XI and XII are satisfied by not adding a new read path around them).
- **"Opis" and "Parametry"** are the Polish labels of the storefront's "Description" and
  "Parameters" product tabs; the requirements apply in every storefront language.
- **Attribute deletion covers every attribute type** (OR-5). This is scope added beyond content
  attributes: the attributes screen had no delete action before this feature, and FR-007 cannot be
  met for one type alone without the other types having none.
- **Out of scope**, beyond FR-040 – FR-046: a restricted product-content block palette (OR-3
  rejects it), required content attributes, default content per attribute, showing content outside
  the product page, versioning or scheduling of content, "copy from another product", and a purge
  of soft-deleted products (OR-6 relies on one, but this feature does not add it).

## Follow-ups *(outside this feature)*

- **Align category content with FR-051 (OR-7).** Category content keeps rendering while the CMS is
  off; product content does not. Making categories follow the product rule is a separate change.
  It touches the catalogue's category page read, the storefront category page and the category
  content documentation. It is tracked as an issue opened by this feature's tasks.

## Open Questions

None. Q1 (attribute label as a heading, FR-037) was answered by the owner on 2026-11-04 — see OR-4.
The four points the plan raised were answered the same day — see OR-5 – OR-8.
