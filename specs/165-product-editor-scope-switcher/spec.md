# Feature Specification: One scope switcher for the product editor

**Feature Branch**: `feat/165-product-editor-scope-switcher`
**Created**: 2026-10-29
**Status**: Draft — open for `/speckit.clarify` (markers below are deliberate and uncapped by owner
instruction; clarify runs until they are exhausted)
**Input**: GitHub issue #523 — "one Magento-style scope switcher in the product editor header (Global →
Sales channel → Sales channel × Language); the whole form, every tab, shows and edits the effective values
at the chosen scope. Every scopable field gets 'Use inherited' showing the inherited value and its source;
untick = create override at the current scope, tick = remove the override (163 FR-012). Global-only fields
(SKU, type, attribute set…) read-only outside Global, labelled 'global only'. Persistent banner / colour
outside Global. Flagged user attributes (`channelScoped` / `languageScoped`) editable per scope in the
attributes section. The Scopes tab stays as the overview map; clicking a cell switches the editor scope
(delivers 163 L7). Keep the 163 API; every write stays an audited Command; backend changes small or none."

**Primary evidence**: `specs/165-product-editor-scope-switcher/design-audit.md` (designer audit of
`origin/master` at `1530b2b84`; findings F1–F15, N1–N4, open questions Q1–Q14, API gaps G1–G9). This spec
cites the audit by those ids and does not restate its file-level evidence except where a requirement
depends on it.

**Builds on**: `specs/163-product-data-scopes/` — the scope model, the field table (163 FR-009), the
inheritance chain (163 FR-008), "Use inherited" (163 FR-012), the scope overview (163 FR-041, OV-1, UX-1,
UX-3), the completeness gate (163 FR-060), auditing (163 FR-080, FR-081) and the deferred cell-to-field
link (163 Session 2026-10-27, L7). Those requirements are referenced by id and are **not** restated; where
this spec changes one of them it says so explicitly.

## Clarifications

### Owner decisions before specification (2026-10-29)

- **F1 / F2 inside 165.** The data-loss defects found by the audit — F1 (the editor keeps only `en-US` and
  `pl-PL` for name and description; any other language is silently dropped) and F2 (a language-scoped user
  attribute is likely rendered as `[object Object]` and a save may overwrite its translations) — are fixed
  **inside this feature**, not as a separate issue. They get their own requirements (FR-001…FR-004) and the
  P1 user story (US1). F2 is unverified and its requirement is written so that the plan verifies it first.
  This settles the audit's Q14 against its own recommendation (which was a separate bug fix).

*(Sessions of `/speckit.clarify` append below.)*

## Corrections to the issue

The audit proved two statements of issue #523 inaccurate. The spec follows the audit, not the issue text:

1. **SEO is not edited in the product editor today.** The issue says SEO "has its own scope selector" in the
   editor. It does not: the product editor's SEO tab holds only a link to the `/seo` screen
   (`packages/modules/seo/src/admin/zones/ProductSeoLink.tsx:27`), contributed by `seo` and shown only while
   `seo` is on and the admin holds `catalog:write` — exactly as 163 decided (163 Session 2026-10-26, "SEO
   stub" = A; UX-4). SEO's scope selectors live on the separate `/seo` screen. Bringing SEO into the editor
   is therefore **new scope** that reverses a 163 owner decision, not a unification of an existing
   selector; it is held open as a clarification (FR-060).
2. **The editor holds five scope selectors, not one per tab.** Details chips, the gallery "Scope" select,
   the gallery "Language" select, the URL keys "Add override" select, and `/seo`'s channel + locale — each
   with independent state — plus three dialogs that show every language at once (audit §1, F9).

The issue's three levels (Global → Channel → Channel × language) versus 163 FR-009's four (with
language-only) is an open decision, not a correction (FR-010).

## Current state (origin/master `1530b2b84`)

Paths are relative to `packages/modules/catalog/src/admin/` unless they start with `packages/`.

| Fact | Evidence |
| --- | --- |
| The editor hard-codes `LOCALES = ['en-US', 'pl-PL']`; on load it copies only those two keys of `name` / `description` into page state, and on Save it trims to them | `pages/ProductEditor.tsx:59`, `:281-290`, `:344-347` |
| The scope editor's change callbacks keep only `en-US` / `pl-PL`, although its language chips offer every language of the product's channels | `pages/ProductEditor.tsx:810-820`; `components/ProductScopeEditor.tsx:547-553` |
| The product `PATCH` **replaces** the whole `name` / `description` map (bulk import merges) and the contract accepts any language key | `packages/modules/catalog/src/backend/services/catalog-admin.service.ts:655-656` vs `catalog-bulk-import.service.ts:221`; `packages/contracts/src/common.ts:48` (`multilingualStringSchema`) |
| Consequence (verified by reading, stronger than the audit's F1): a product whose name exists in a third language — set by import, PIM or the API — **loses that language on any editor Save**, even if the operator never touched the name | the three rows above |
| A language-scoped user attribute's baseline is a `{language: value}` map; the attributes tab renders a single control with `String(value)` and writes the whole `attributeValues` object back | `packages/contracts/src/product-value-resolver.ts:79-83` (`pickLang`); `components/ProductAttributesTab.tsx:19, 216, 277`; `pages/ProductEditor.tsx:354, 381` |
| The create form offers name / description in `en-US` and `pl-PL` only | `pages/ProductEditor.tsx:990-1020` |
| Channel and channel × language values of user attributes have no admin input at all | `components/ProductAttributesTab.tsx:154-170` |
| The API refuses a channel-only `(C, no language)` override of `name` / `description`, while the resolver honours such a row and 163 FR-009 lists Channel = yes | `packages/contracts/src/catalog.ts:3059-3062`; `packages/modules/catalog/src/backend/services/product-overrides.service.ts:194-201`; `packages/contracts/src/product-value-resolver.ts:127-134` |
| Clearing a C×L name override stages a write of `''` instead of removing it | `components/ProductScopeEditor.tsx:321-338` (audit F8) |
| Name / description overrides and attribute values are editable without `catalog:write`; the header Save is always shown | audit F4 |
| Switching tab unmounts the Details panel and discards staged override and availability drafts without a prompt | audit F5 |
| Seven different save behaviours across the editor | audit F6 |
| Five idioms for "inherit", one of them of opposite polarity ("Set a window for this channel") | audit F7; `packages/modules/catalog/i18n/en.json:1169, 1181` |
| The editor remembers the last channel and language per (admin, product) in `product_editor_preferences`; `lastLanguageCode = NULL` already means "the primary admin language", so "channel, all languages" cannot be stored | `packages/modules/catalog/src/backend/entities/product-editor-preference.entity.ts` (audit G3) |
| The SEO meta read is gated `catalog:write` | `packages/modules/seo/src/backend/routes.ts:349` (audit G4) |

## Terms used in this spec

Scope, scoped value, override, inheritance, "use inherited", status and archived have the meanings of 163
*Terms used in this spec*. In addition:

- **G / L / C / C×L** — Global; Language (every channel); Sales channel (every language); Sales channel ×
  language.
- **Editor scope** — the one scope the product editor currently shows and edits, chosen in the scope
  switcher.
- **Scope switcher** — the single control in the editor header that sets the editor scope.
- **Scope banner** — the persistent indication, inside the switcher area, that the editor scope is not
  Global and that changes apply only there.
- **Effective value at the editor scope** — the value 163 FR-008 resolves at that scope, with its
  **source** (the scope it comes from).
- **Global-only field** — a field 163 FR-009 keeps global (SKU, type, attribute set, categories, prices,
  variants / grouped / bundle structure, product links, stock, warehouses, fulfilment strategy, channel
  membership, user attributes with neither scope flag, the image set, attachment files and order,
  packaging-unit quantities and order).
- **Not at this level** — a scoped field the editor scope does not support (163 FR-009), e.g. status at L,
  alt text at C.
- **Staged change** — an edit made in the editor and not yet saved.
- **Own text in a language** — a product's baseline value of a language-scoped field (name, description,
  language-scoped attribute) in one language; it is not an override (163 OV-1).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saving a product never loses its text in any language (Priority: P1)

An operator opens a product whose name, description or a language-scoped attribute exists in more languages
than English and Polish (for example German, set by a PIM import), edits anything — or nothing in
particular — and saves. Every language the product holds survives. The operator can also read and edit the
text in every language the platform offers, not only English and Polish.

**Why this priority**: The editor silently destroys data today (F1, and probably F2). Every other story
builds on the editor's Save; it must not lose data first.

**Independent Test**: Seed a product with name and description in `en-US`, `pl-PL` and `de-DE` and a
language-scoped string attribute with values in those three languages; open it in the editor, change an
unrelated field (e.g. stock mode), save; read the product back and assert all three languages of every
field are unchanged.

**Acceptance Scenarios**:

1. **Given** a product with a name in `en-US`, `pl-PL` and `de-DE`, **When** the operator changes an
   unrelated field and saves, **Then** the `de-DE` name is still there and unchanged.
2. **Given** a platform with `de-DE` active, **When** the operator enters a German name at the German
   language level and saves, **Then** the German name is stored and shown after reload.
3. **Given** a product with a language-scoped string attribute holding values in three languages, **When**
   the operator opens the attributes section, **Then** no control shows `[object Object]` or any serialised
   map, and each language's value is reachable.
4. **Given** the same product, **When** the operator changes the attribute's value in one language and
   saves, **Then** only that language's value changes and the others are unchanged.
5. **Given** a product in no channel and a platform with three active languages, **When** the operator
   creates or edits it, **Then** name and description can be entered in all three languages.

---

### User Story 2 - One switcher sets the scope of the whole editor (Priority: P2)

An operator chooses a scope once, in the editor header, and every tab — details, attributes, media,
attachments, packaging units, order rules, URL keys — shows the effective value of every field at that
scope, with where it comes from. Outside Global a persistent banner says that changes apply only to the
chosen scope. The per-tab selectors are gone.

**Why this priority**: This is the issue's core request; it removes five independent selectors (F9) and the
risk of editing one scope on one tab and another on the next.

**Independent Test**: Seed overrides of name at C×L, status at C, image roles at C and alt text at L; pick
each scope in the switcher and assert every tab shows the matching effective value and source; assert no
other scope selector is present on any tab.

**Acceptance Scenarios**:

1. **Given** the editor at Global, **When** the operator picks channel "B2B PL" and language "Polish",
   **Then** every tab shows effective values at B2B PL × Polish and the scope banner reads that changes
   apply only to B2B PL × Polish.
2. **Given** the editor at B2B PL × Polish, **When** the operator moves from Details to Media, **Then**
   Media shows image roles and visibility for B2B PL and no own scope or language selector.
3. **Given** the editor at any non-Global scope, **Then** the banner is visible on every tab, uses text and
   an icon (not colour alone), and is announced to assistive technology when the scope changes.
4. **Given** a channel that offers only some languages, **When** the operator picks that channel while a
   language it does not offer is selected, **Then** the language falls back as defined and the fallback is
   announced.
5. **Given** a product that is a member of no channel, **Then** the switcher offers only the scopes valid
   for it (163 US4 #4) and says why.
6. **Given** the header status indicator, **When** the editor scope changes, **Then** it shows the effective
   status at that scope and its source.

---

### User Story 3 - Each scoped field says whether it inherits, and "Use inherited" works one way everywhere (Priority: P3)

At any scope the operator sees, for every scoped field supported there, whether the value is inherited (and
from where) or set at this scope. Unticking "Use inherited" makes the field editable, pre-filled with the
inherited value; saving creates the override. Ticking it on an override stages the override's removal;
saving removes it and the field shows the inherited value again. The same control and polarity are used for
text, select, date and list fields.

**Why this priority**: The issue's per-field model; it also removes five inherit idioms (F7) and the
empty-string "inherit" that breaks 163 FR-012 (F8).

**Independent Test**: At C×L, untick "Use inherited" on name, enter a value, save, assert one override row
and its audit entry; tick it again, save, assert the row is gone (not empty) and the field shows the
inherited value and its source.

**Acceptance Scenarios**:

1. **Given** a field inheriting from Global at C×L, **Then** its control is read-only, shows the Global
   value and the source "Inherited from Global", and "Use inherited" is ticked.
2. **Given** that field, **When** the operator unticks "Use inherited", **Then** the control becomes
   editable, pre-filled with the inherited value, and receives focus.
3. **Given** an override at the editor scope, **When** the operator ticks "Use inherited" and saves,
   **Then** the override is removed (163 FR-012), no empty value is stored, and the field shows the
   inherited value and its source.
4. **Given** the operator ticks "Use inherited" and then unticks it before saving, **Then** the original
   override value is restored and nothing is written.
5. **Given** a select field (status, returnable, audience), **Then** it uses the same "Use inherited"
   control as a text field and offers no "Inherit (…)" option.
6. **Given** a screen reader user, **Then** every scoped control has an accessible name, its "Use
   inherited" checkbox names the field it belongs to, and its source line is announced as the control's
   description.

---

### User Story 4 - Fields that cannot change at this scope say why and where to go (Priority: P4)

Outside Global, global-only fields (SKU, type, attribute set, …) are shown read-only, labelled "Global
only", with a way to jump to Global. Scoped fields that the editor scope does not support (status at
language level, alt text at a channel) are read-only with the reason and a way to jump to a scope where they
can be edited. Tabs that hold only global-only data show one notice instead of greying every field.

**Why this priority**: Without it the operator either edits a value they think is scoped and changes it
everywhere, or cannot find where a field is set.

**Independent Test**: At B2B PL × Polish assert SKU, type and attribute set are read-only with the "Global
only" label and a jump to Global; assert status at Polish (L) is read-only with a reason and a jump to a
channel scope; assert the Pricing tab shows one notice.

**Acceptance Scenarios**:

1. **Given** the editor at any non-Global scope, **Then** every global-only field is read-only, labelled
   "Global only", and offers "Edit at Global".
2. **Given** the editor at L, **Then** status is read-only with the text that status is set globally, per
   channel or per channel × language, and offers a jump to such a scope.
3. **Given** the editor at C, **Then** alt text, attachment names and packaging-unit names are read-only
   with their reason and a jump to a scope that supports them.
4. **Given** the editor at a non-Global scope, **When** the operator opens a tab whose fields are all
   global-only (Pricing, Variants, Grouped items / Bundle slots, Related, Channels), **Then** one notice at
   the top of the tab says the tab is global-only and offers "Edit at Global".
5. **Given** the editor at a non-Global scope, **Then** Archive / Restore, Duplicate and Delete stay global
   actions and say so.

---

### User Story 5 - Flagged user attributes are editable per scope (Priority: P5)

An operator edits a channel-scoped user attribute at a channel scope, and a language-scoped one at a
language or channel × language scope, in the attributes section — using the same per-field inherited state
as every other field. Attributes with neither flag are global-only.

**Why this priority**: 163 FR-040 requires every scoped field to be settable at every supported scope; for
user attributes the admin offers no channel or channel × language input today (audit §1 rows 3–4), so that
requirement is not met.

**Independent Test**: Define one channel-scoped and one language-scoped attribute; at C set the first, at L
set the second, at C×L override the second; save; assert the values resolve on the storefront at the
matching scopes and each write is one audited Command.

**Acceptance Scenarios**:

1. **Given** a `channelScoped` attribute, **When** the editor is at B2B PL and the operator unticks "Use
   inherited" and enters a value, **Then** saving creates a channel override for that attribute.
2. **Given** a `languageScoped` attribute, **When** the editor is at Polish (L), **Then** the operator edits
   the attribute's own text in Polish (FR-020 decides whether it carries a "Use inherited" control).
3. **Given** an attribute flagged both ways, **When** the editor is at B2B PL × Polish, **Then** a C×L
   override can be set and removed.
4. **Given** an attribute with neither flag, **When** the editor is at any non-Global scope, **Then** it is
   read-only and labelled "Global only".
5. **Given** an attribute flagged only `channelScoped`, **When** the editor is at L, **Then** it is shown as
   not editable at this level with the reason.

---

### User Story 6 - A read-only operator can browse every scope; staged work survives navigation (Priority: P6)

An operator without `catalog:write` uses the switcher to read effective values at every scope, but nothing
is editable and no Save is offered. An operator with `catalog:write` switches tabs and scopes freely without
losing staged changes, and is warned before leaving the page with unsaved changes anywhere in the editor.

**Why this priority**: Closes a permission leak (F4, against 163 FR-042) and a silent loss of staged work
(F5).

**Independent Test**: As a `catalog:read` admin, switch through all scopes and assert no editable control
and no Save; as a `catalog:write` admin, stage a C×L name override, switch to Media and back, assert the
draft is still there; try to leave the page and assert the unsaved-changes prompt.

**Acceptance Scenarios**:

1. **Given** an admin without `catalog:write`, **Then** the switcher works, every control is read-only, the
   "Use inherited" controls are replaced by the source text, and Save, Archive / Restore and Delete are not
   offered; a line in the switcher area says the view is read-only.
2. **Given** a staged change on one tab, **When** the operator switches to another tab and back, **Then**
   the staged change is still there.
3. **Given** a staged change anywhere in the editor (any tab, any scope), **When** the operator navigates
   away from the product, **Then** the unsaved-changes prompt appears.
4. **Given** staged changes at one scope, **When** the operator switches scope, **Then** the behaviour of
   FR-047 applies.

---

### User Story 7 - One Save, with a clear result (Priority: P7)

The editor has one Save. Saving writes the staged changes (FR-045 decides which), each as the audited
Command it already is, gate-bearing status writes first, and then reports per section what was saved and
what was not. A completeness refusal writes nothing that the refusal covers; a later failure is reported
and leaves that section's changes staged.

**Why this priority**: Seven save behaviours today (F6) make it impossible to predict what a Save writes.

**Independent Test**: Stage a C status change that the gate refuses (refuse mode) plus a C×L name override;
save; assert no status change was written, the result states what was and was not saved, and the
remaining staged changes are still staged.

**Acceptance Scenarios**:

1. **Given** staged changes in several sections, **When** the operator saves and all succeed, **Then** the
   editor shows that everything was saved and no change remains staged.
2. **Given** the completeness gate in *refuse* mode and a staged status change that turns the product on at
   an incomplete pair, **When** the operator saves, **Then** the status change is refused with the missing
   fields named (163 FR-060) and the operator sees which other staged changes were or were not written.
3. **Given** the gate in *warn* mode, **When** a save turns the product on at an incomplete pair, **Then**
   the warnings are shown in place of the plain saved message (163 G-2).
4. **Given** one section fails after earlier ones succeeded, **Then** the result names the failed section
   and its reason, the succeeded sections are no longer staged, and the failed section's changes remain
   staged.
5. **Given** a concurrent edit (`409 VERSION_CONFLICT`, 163 R2), **Then** the editor says to reload and try
   again and nothing of that section is written.
6. **Given** any Save, **Then** every scoped write it performs appears in the audit log with the product,
   field, scope and before / after values (163 FR-080).

---

### User Story 8 - The operator sees what is missing at the current scope (Priority: P8)

At the chosen scope the editor tells the operator which values the completeness gate would report missing
there (163 FR-041 vocabulary), each linked to the field, so the product can be completed before it is
switched on.

**Why this priority**: Prevents a refused or warned status change; reuses the overview's existing data.

**Independent Test**: Seed a product missing a Polish URL key at B2B PL × Polish; switch there and assert the
missing field is named and its link opens the URL-key field at that scope.

**Acceptance Scenarios**:

1. **Given** the editor at C×L where the gate would report name and URL key missing, **Then** the editor
   names both, each with a link that opens the owning tab and focuses the field.
2. **Given** the editor at C, L or Global, **Then** the missing values are summarised as FR-050 decides.
3. **Given** a complete scope, **Then** no missing-value message is shown.

---

### User Story 9 - The scope map switches the editor scope (Priority: P9)

On the Scopes tab, the overview stays the map of every scope. Each cell, the "whole channel" column, the
"every channel" row and the Global corner offer "Edit at <scope>", which sets the editor scope and opens
the editor on it; each field named in a cell links to that field at that scope. The links are real links
(keyboard, new tab, shareable). This delivers the cell-to-field link 163 deferred (L7).

**Why this priority**: Closes 163's deferred L7 and makes the map actionable.

**Independent Test**: Seed a C×L override; on the Scopes tab activate the cell's field link and assert the
editor is at that C×L scope with that field's tab open and the field focused; open the same link in a new
tab and assert the same result.

**Acceptance Scenarios**:

1. **Given** the Scopes tab, **When** the operator activates "Edit at B2B PL × Polish" on a cell, **Then**
   the editor scope becomes B2B PL × Polish and Details opens.
2. **Given** a cell naming "URL key" as overridden, **When** the operator activates that name, **Then** the
   URL-key field opens at that scope.
3. **Given** a link to the editor at a scope, **When** it is opened in a new tab or shared, **Then** the
   editor opens at that scope (if valid for the product and the admin).
4. **Given** the overview's existing reset and orphan-deletion actions (163 FR-041, UX-1), **Then** they keep
   working unchanged.

---

### User Story 10 - SEO fields at the editor scope (Priority: P10)

*Conditional on FR-060.* The SEO tab shows the product's SEO title, description and OG fields at the editor
scope with the same per-field inherited state, contributed by the `seo` module, instead of a link to
another screen.

**Why this priority**: Completes "the whole form at a scope" but reverses a 163 owner decision and crosses
into another module; lowest priority until clarified.

**Independent Test**: With `seo` on, at B2B PL × Polish set an SEO title override in the SEO tab, save,
assert one `seo` Command audit entry and the value on the storefront page at that scope; switch `seo` off
and assert the SEO section is absent and the editor raises no error.

**Acceptance Scenarios**:

1. **Given** `seo` on and the editor at any scope, **Then** the SEO tab shows the effective SEO values at
   that scope with their source.
2. **Given** `seo` off, **Then** the SEO tab's SEO section is absent and nothing else in the editor changes
   (Constitution XVII).
3. **Given** a staged SEO change, **When** the operator saves, **Then** it is written by `seo`'s own
   Command, never by a `catalog` Command.

---

### Edge Cases

- **Language not offered after a channel change** — the language selection falls back (the channel's
  default language, or "All languages" — the plan picks one and states it) and the fallback is announced in
  the switcher's live region.
- **Remembered or linked scope no longer valid** (product left the channel, channel dropped the language,
  channel deleted) — the editor opens at the nearest valid scope (Global if none) and says so; it never
  shows an error page.
- **Orphaned override at the editor scope** (163 FR-015) — not editable as a live value; the field says an
  orphaned override exists and links to the Scopes tab, where it can be deleted.
- **Archived product** — the archived notice takes precedence; the switcher still works for reading and,
  with `catalog:write`, for editing (163 FR-019: archive is independent of scoped values).
- **Product in no channel** — only Global and (subject to FR-010) Language scopes are offered (163 US4 #4).
- **Channel offering one language** — the language select offers that language and, if FR-010 keeps the
  Channel level, "All languages"; the two scopes stay distinct because they hold different overrides.
- **Many channels** — the channel selector stays usable with a large number of member channels (searchable
  past a threshold the plan sets).
- **Audience override naming organizations outside the channel** — the save is not refused; the warning of
  163 FR-030 is shown at C.
- **Gate refusal in the middle of a multi-section Save** — see US7 #2 and FR-046.
- **Partial Save failure** — see US7 #4.
- **`409 VERSION_CONFLICT`** — see US7 #5.
- **Permission lost mid-session** — a write refused with 403 is reported per section; the editor does not
  claim it saved.
- **PIM field protection** (`product.editor.field.after` zone contributors) — they receive the editor scope
  and keep working when they ignore it (FR-071).
- **A third language entered on create** — FR-001 applies to the create form too.
- **Clearing a text override's content** — an empty override value is not a way to inherit (163 FR-012);
  the editor refuses or ignores an empty override and points to "Use inherited" (the plan states which;
  either way no `''` override row is written).

## Requirements *(mandatory)*

### Functional Requirements

#### Data integrity — fixed first (US1)

- **FR-001** *(F1)*: The product editor (create and edit) MUST NOT drop, trim or overwrite a product's name
  or description in any language it did not change. Loading a product MUST keep every language the product
  holds, and saving MUST send back every language unchanged unless the operator changed or cleared it. The
  languages offered for entry MUST be derived from the platform's and the product's channels' languages
  from one shared source, never from a hard-coded list; this applies equally to the attributes section
  (`ProductAttributesTab.tsx:19`) and every other place the editor enumerates languages.
- **FR-002** *(F1 regression guard)*: A test MUST seed a product with name and description in at least one
  language other than `en-US` and `pl-PL`, perform an editor Save that does not touch them, and assert they
  are unchanged.
- **FR-003** *(F2 — verify first)*: The plan's **first** task for this requirement MUST verify, on a seeded
  product with a language-scoped string user attribute holding values in at least two languages, (a) what
  the attributes section renders today and (b) what an editor Save writes to that attribute; and (c) whether
  the product write accepts and validates a per-language map for a language-scoped attribute (audit G8).
  The verification result MUST be recorded in the plan before any fix is designed. Whatever it shows, after
  this feature: the editor MUST NOT render a language-scoped attribute's baseline as a serialised object,
  and MUST NOT replace its per-language map with a single value or drop a language it did not change.
  [NEEDS CLARIFICATION: How much of F2 belongs to US1? (a) US1 only stops the corruption — each language's
  value is shown and edited in place without loss, and per-scope editing of attributes arrives with US5;
  (b) US1 delivers full per-language attribute inputs driven by the scope switcher, i.e. US5's language part
  moves into P1. Audit: no explicit recommendation (§3 F2 points to the switcher-driven inputs of §4.4);
  owner placed F2 in a P1 story.]
- **FR-004**: The same no-loss rule as FR-001 MUST hold for every other translatable map the editor writes
  (image alt text, attachment name / description, packaging-unit name): a Save MUST NOT remove a language
  the operator did not change.

#### Scope switcher (US2)

- **FR-010**: The editor header MUST hold one scope switcher, visible on every tab, which sets the editor
  scope. [NEEDS CLARIFICATION: Which levels does the switcher offer? (a) Global → Sales channel → Sales
  channel × language, as the issue says; (b) all four levels of 163 FR-009 including Language-only (L), via
  two selects "Sales channel" (All channels + member channels) and "Language" (All languages + languages
  available). Audit Q1 recommends (b): L is the translation scope 163 FR-009 gives to name, description,
  language-scoped attributes, URL key, SEO, alt text, attachment and packaging-unit names; under (a) those
  translations have no home in the switcher. Consequence for the answer: under (a) the Global level MUST
  offer every language's own text inline for language-scoped fields (name, description, language-scoped
  attributes); under (b) Global shows the primary language and L edits each language. US1 #2 and US5 #2 are
  written for (b) and are restated if (a) is chosen.]
- **FR-011**: The switcher MUST offer only scopes valid for the product (163 FR-014 and *Terms*): member
  channels only, and only languages the chosen channel offers; orphaned scopes stay on the Scopes tab.
  Under "All channels", the languages offered MUST be every language active on the platform.
- **FR-012**: Every tab MUST show and edit values at the editor scope; the separate scope or language
  selectors of today — Details channel / language chips, gallery "Scope" select, gallery "Language" select,
  URL-keys "Add override" select — MUST be removed and their fields driven by the switcher.
  [NEEDS CLARIFICATION: Rollout — (a) every per-tab selector is retired in 165; (b) Details and Attributes
  first, other tabs in a follow-up. Audit Q13 recommends (a): a half-migrated editor keeps F9 alive and
  doubles the mental model.] The three dialogs that show every language at once (attachment scopes,
  packaging-unit translations) MUST either be driven by the editor scope or explicitly listed by the plan as
  kept, with the reason.
- **FR-013**: Outside Global the switcher area MUST show the scope banner: the sentence "Changes apply only
  to <scope in words>", an icon and the warning treatment — never colour alone (WCAG 1.4.1). The banner's
  text MUST be announced when the scope changes, through a live region present before its text is set
  (WCAG 4.1.3).
- **FR-014**: The switcher area MUST show the editor scope in words and a link to the Scopes tab.
- **FR-015**: The header status indicator MUST show the effective status at the editor scope and its source
  (audit Q12 (a), adopted as default).
- **FR-016**: The switcher's selects MUST be admin-kit primitives with visible labels (Constitution IX;
  WCAG 1.3.1, 4.1.2); no hard-coded colours; language names, not raw codes, as visible labels.
- **FR-017**: The editor scope MUST be expressible in the editor's URL so a link opens the editor at a scope
  (needed by US9 and for sharing). [NEEDS CLARIFICATION: What does the switcher remember when no scope is
  in the URL? (a) the last scope per admin × product (today's `product_editor_preferences`, which cannot yet
  express "channel, all languages" — audit G3, needs a small migration or sentinel); (b) the last scope per
  admin across all products (164's per-admin server preferences — a contract change); (c) nothing — a
  product opened without a URL scope starts at Global; (d) URL as source of truth, with (a) only as the seed
  when the URL has none. Audit Q6 recommends (d) = "(c)+(a)" in its wording: deep-linkable, and a product
  never opened starts at Global, which with the banner prevents editing a wrong scope unknowingly.]
- **FR-018**: While a scope switch re-reads values, fields MUST keep their layout and the tab panel MUST
  signal it is busy; the editor MUST NOT show stale values of the previous scope as if they were current.

#### Per-field inherited state (US3)

- **FR-020**: Every scoped field supported at the editor scope MUST show either "inherited, from <source>"
  or "set at this scope", and — where an override can exist at that scope — a "Use inherited" checkbox
  whose ticked state means *inherit* (one polarity everywhere, matching 163 UX-3's vocabulary).
  [NEEDS CLARIFICATION: At the Language level (L), name, description and language-scoped attributes hold the
  product's **own text** in that language (not an override, 163 OV-1). (a) At L these show no "Use
  inherited" checkbox, only "Own text in <language> · falls back to <primary language> when empty"; URL key
  and SEO at L are real overrides and keep the checkbox; (b) treat an empty language value as "inherit the
  primary language" behind a checkbox that clears it. Audit Q4 recommends (a): (b) re-creates the
  empty-means-inherit pattern 163 FR-012 forbids.]
- **FR-021**: Unticking "Use inherited" MUST make the control editable, pre-fill it with the inherited value
  and move focus into it; saving MUST create the override at the editor scope through the field's existing
  audited write.
- **FR-022**: Ticking "Use inherited" on an existing override MUST stage its **removal**; saving MUST remove
  the override (163 FR-012). The editor MUST NOT store an empty value as a way to inherit (fixes F8).
  Unticking again before Save MUST restore the staged-away value and write nothing.
- **FR-023**: Select-type fields (status, returnable, audience) MUST use the same "Use inherited" control;
  "Inherit (…)" options and "Set a … for this channel" checkboxes MUST be retired (audit Q9 (a), adopted as
  default: it follows 163 UX-3's one-vocabulary ruling).
- **FR-024**: While inheriting, a control MUST be read-only (not disabled) so its value stays perceivable;
  the source line MUST be the control's accessible description; every control MUST have an accessible name
  from a visible label; every "Use inherited" checkbox MUST have an accessible name that includes the field
  name; overridden state MUST be shown by text or icon in addition to colour (fixes F3; WCAG 1.3.1, 1.4.1,
  2.4.6, 3.3.2, 4.1.2).
- **FR-025**: Validation errors MUST be associated with their control (`aria-invalid` and a described-by
  error) and named in text.
- **FR-026**: A field whose inheritance yields no value (e.g. no Global value) MUST say so in text, not by a
  destructive colour alone.

#### Fields not editable at the editor scope (US4)

- **FR-030**: Outside Global, every global-only field MUST be shown read-only with the label "Global only"
  and an "Edit at Global" action, and MUST NOT be hidden (audit Q8 (a), adopted as default: hiding makes the
  form change shape per scope). A tab whose fields are all global-only MUST show one notice at its top with
  "Edit at Global" instead of labelling each field.
- **FR-031**: A scoped field not supported at the editor scope (163 FR-009) MUST be shown read-only with its
  effective value, a reason naming the levels it is set at, and an action that switches to the nearest
  scope where it can be edited.
- **FR-032**: Archive / Restore, Duplicate and Delete MUST stay global actions and MUST NOT be presented as
  scoped.

#### User attributes per scope (US5)

- **FR-035**: The attributes section MUST offer, for each user attribute, editing at every scope its flags
  allow (163 FR-009 "per attribute flags"), with the per-field inherited state of FR-020…FR-026; an
  attribute with neither flag is global-only (FR-030).
- **FR-036**: Channel and channel × language values of user attributes MUST be written through the existing
  audited value-override write (163 FR-080).

#### Permissions and staged work (US6)

- **FR-040**: The editor MUST compute one write permission (`catalog:write`) and, without it, MUST render
  every control read-only, replace "Use inherited" controls by the source text, and not offer Save,
  Archive / Restore, Duplicate or Delete; the switcher MUST remain usable. This MUST include name /
  description overrides and user attributes, which leak today (fixes F4; 163 FR-042). No new permission code
  is introduced (163 FR-084).
- **FR-041**: Staged changes MUST be held at editor level and survive tab switches and, per FR-047, scope
  switches (fixes F5).
- **FR-042**: The unsaved-changes prompt MUST consider every staged change on every tab and every scope.

#### Save (US7)

- **FR-045**: The editor MUST have exactly one Save action, in the header; every per-section Save, every
  auto-save on toggle and every dialog Save that writes product data MUST be retired or folded into it.
  [NEEDS CLARIFICATION: Save model — (A) one header Save that runs the existing per-endpoint audited
  Commands in a fixed order, status-bearing writes first, stopping on a gate refusal, then reports per
  section (not atomic across sections); (B) keep per-section Saves with a unified look; (C) one new
  orchestrating catalog Command applying everything in one transaction (atomic, one audit entry, but cannot
  include SEO without a write port, and is a larger backend change against the issue's "backend changes
  small or none"). Audit Q2 recommends (A). Note that this requirement's "exactly one Save" assumes A or C.]
  [NEEDS CLARIFICATION: Save reach — does Save write (a) the staged changes of **every** scope, listed in the
  switcher area as "Unsaved: Global, B2B PL × Polish", or (b) only the current scope's? Audit Q3 recommends
  (a): it matches today's per-channel drafts and avoids a forced save on every switch.]
- **FR-046**: Under any save model, a completeness-gate refusal (163 FR-060, *refuse* mode) MUST leave every
  write the refusal covers unwritten, MUST name the missing fields per pair, and MUST tell the operator which
  other staged changes were and were not written. The editor MUST pre-check, before Save, the pairs a staged
  status change would turn on, and show their gaps (audit §4.6 mitigation of the two gate-bearing writes).
- **FR-047**: Switching scope with staged changes MUST NOT lose them. [NEEDS CLARIFICATION: (a) keep drafts
  per scope and list unsaved scopes in the switcher area; (b) block the switch with a Save / Discard / Stay
  dialog. Audit Q7 recommends (a) if Save reach is "every scope", otherwise (b).]
- **FR-048**: After Save the editor MUST report per section what was saved and what was not, with the
  reason; failed sections MUST stay staged; succeeded sections MUST NOT. A `409 VERSION_CONFLICT` MUST say to
  reload and try again (163 R2).
- **FR-049**: Every write a Save performs MUST stay an audited Command with one audit entry per product per
  Command (163 FR-080), restorable from its before-state (163 FR-081). Whether the entries of one Save carry
  a shared correlation id is decided by the plan from what the Command Bus supports; if it does not,
  separate entries are accepted (audit G7, adopted as default).

#### Completeness at the editor scope (US8)

- **FR-050**: The editor MUST show the values the completeness gate would report missing at the editor
  scope, in the gate's own vocabulary (163 FR-041, FR-060), each linked to its field at that scope, as text
  with an icon (not colour alone); with no missing values, nothing is shown. [NEEDS CLARIFICATION: How is it
  shown at coarser scopes? (a) at C×L the missing fields; at C the union over the channel's languages; at L
  the union over the channels offering it; at Global a count of incomplete scopes linking to the Scopes tab,
  all inside the switcher area; (b) only at C×L, nothing elsewhere; (c) a different placement (e.g. per
  tab). Audit §4.7 proposes (a) and needs no new API (reads the overview's `cells[].missing`).]
- **FR-051**: After a Save that returns completeness warnings in *warn* mode, the editor MUST show them as
  today (163 G-2), announced to assistive technology.

#### Scope map → switcher (US9; delivers 163 L7)

- **FR-055**: On the Scopes tab, each cell (C×L), each "whole channel" entry (C), each "every channel" entry
  (L, if FR-010 offers L) and the Global corner MUST offer "Edit at <scope>" that sets the editor scope; each
  field named in a cell MUST link to that field at that scope. These MUST be real links (keyboard operable,
  openable in a new tab).
- **FR-056**: The overview's existing resets and orphan deletion (163 FR-041, UX-1) MUST keep working
  unchanged. This amends 163 *Out of Scope* (L7): the cell-to-field link is delivered here.

#### SEO (US10)

- **FR-060**: [NEEDS CLARIFICATION: SEO in the editor — (a) `seo` contributes an inline SEO section to the
  product editor's SEO tab that receives the editor scope and stages into the editor's Save (reverses 163's
  "SEO stub" = A decision; needs audit G5); (b) keep the link, opened pre-scoped to the editor scope on the
  `/seo` screen. Audit Q10 recommends (a).] Under either option, SEO values MUST be written only by `seo`'s
  own Commands (Constitution I, XIII), and with `seo` off the editor MUST show no SEO section and raise no
  error (Constitution XVII).
- **FR-061**: [NEEDS CLARIFICATION: SEO for read-only operators — today the SEO read is gated `catalog:write`
  (audit G4), so an operator without it sees no SEO at any scope. (a) Relax the SEO read to `catalog:read`
  (a `seo`-owned change needing security review); (b) hide SEO from read-only operators with an explanation.
  Audit Q11 recommends (a).]

#### Channel-only name and description (163 FR-009 reconciliation)

- **FR-065**: [NEEDS CLARIFICATION: 163 FR-009 lists name and description as settable at Channel (C), and
  the resolver honours such a value, but the API refuses it (audit G1), so it has never been reachable.
  (a) Lift the refusal for name and description so they can be set at C; (b) amend 163 FR-009 to drop the
  Channel level for name and description and show them read-only at C with the reason (FR-031). Audit Q5
  recommends (b): a channel-wide name across languages is rarely meaningful and (b) needs no backend change.]

#### Cross-cutting

- **FR-070**: Every new operator-facing label, message, banner text and notice MUST exist in Polish and
  English (163 FR-043); the editor's tab and header labels that are literal English today MUST be translated
  as part of this feature (audit N1).
- **FR-071**: The product editor's field zone (`product.editor.field.after`) MUST receive the editor scope
  (channel and language) as optional props, so contributors such as PIM field protection can tell which
  scope a field shows; contributors that ignore them MUST keep working (audit G6, adopted as default).
- **FR-072**: The product editor's tab list MUST meet the keyboard and naming rules of the WCAG 2.2 AA floor
  in `.claude/skills/ux-laws/SKILL.md` (audit N2).
- **FR-073**: The product editor MUST remain reachable from the command palette (Constitution XVI; 163
  FR-042); no new admin route or permission code is introduced.
- **FR-074**: Effective values and their sources at a scope MUST be computed by one shared definition used by
  both the server's resolver and the editor (163 FR-008: no second fallback chain); whether this is a
  read endpoint or shared functions is decided below (audit G2).
  [NEEDS CLARIFICATION: How does the editor obtain effective values and sources at one scope? (a) a new
  read-only scoped-values endpoint returning effective value + source for every catalog field at one scope
  (one request per switch instead of 6–8); (b) pure effective-value-and-source functions in the shared
  contracts beside the existing resolver, no new endpoint. Audit G2 offers both (size small–medium); (b)
  keeps the issue's "backend changes none", (a) is a small backend addition.]

### Key Entities

- **Editor scope** — the (channel or "all channels", language or "all languages") pair the editor shows;
  carried in the URL; may be seeded from a remembered preference (FR-017).
- **Product editor preference** — existing per-(admin, product) memory of the last channel and language
  (`product_editor_preferences`); may need to express "channel, all languages" (audit G3), depending on
  FR-017.
- **Staged change** — an unsaved edit of one field at one scope, or the staged removal of an override; held
  at editor level until Save or discard.
- **Effective value with source** — the value 163 FR-008 resolves for one field at one scope and the scope
  it comes from.
- Product, value override, scope overview cell, completeness-gate setting — unchanged, as defined by 163.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero data loss: for a product holding name, description and every translatable map in at
  least three languages, an editor Save that does not touch them leaves 100% of their language values
  unchanged.
- **SC-002**: The editor offers exactly **one** scope selection control and exactly **one** Save action
  for product data (down from five selectors and seven save behaviours).
- **SC-003**: At any editor scope, 100% of scoped fields on every tab show either their inherited source or
  "set at this scope"; 100% of global-only and not-at-this-level fields show their reason.
- **SC-004**: "Use inherited" removes the override in 100% of cases; no Save writes an empty value as an
  override.
- **SC-005**: An operator sets a channel × language override of the name and a channel override of a
  channel-scoped attribute, and saves, in under 1 minute from opening the product, without leaving the
  editor.
- **SC-006**: From the Scopes tab, an operator reaches the field behind any overridden cell in one action.
- **SC-007**: An operator without the product-edit permission can view every scope and cannot stage any
  change (0 editable controls).
- **SC-008**: Switching scope shows the new scope's values within the responsiveness the admin already
  achieves for a product page load (no perceptible regression), with no stale values presented as current.
- **SC-009**: Every new and changed screen state meets WCAG 2.2 AA as set out in
  `.claude/skills/ux-laws/SKILL.md` (automated accessibility check with zero violations on the editor at
  Global and at a C×L scope).
- **SC-010**: Every write performed by a Save appears in the audit log with product, field, scope, before
  and after (100% coverage of the writes made).

## Assumptions

- **163's API is kept.** Every write uses an existing audited endpoint / Command unless a clarification
  above (FR-045 option C, FR-061, FR-065 option a) chooses otherwise; backend changes are expected to be
  small (G2 read support, G3 preference expression, G6 zone props).
- **Adopted defaults** (low impact, from the audit's recommendations): global-only fields are shown
  read-only, not hidden (Q8 a); select fields use the same "Use inherited" checkbox (Q9 a); the header status
  shows the effective status at the editor scope (Q12 a); zone props gain optional scope (G6); audit entries
  of one Save are correlated only if the Command Bus already supports it (G7); the overview needs no reset
  for SEO, hide, alt, attachment or packaging values because its cells now link into the editor (G9).
- **Languages offered** under "All channels" are every language active on the platform; under a channel,
  the languages that channel offers (163 *Terms*).
- **The completeness-gate setting** stays platform-level and is not shown on this screen (163 FR-060).
- **No new permission code**; `catalog:write` gates every write and `catalog:read` the screen (163 FR-084).
- **No new runtime dependency** (Constitution IV); admin-kit primitives listed in audit §4.10 are reused;
  the multi-select `ScopePicker` is not the right primitive for a single current scope.
- **Prototype review**: the audit advises a designer review of a clickable prototype of the switcher area's
  warning treatment before `/speckit.tasks`.
- **Testing**: F1 / F2 regression tests are written failing first (Constitution III); F2 is verified on a
  seeded product before any fix (FR-003).

## Findings against 163 recorded by this specification

These are spec-versus-code inconsistencies in 163 that this feature resolves; they are listed so the 163
record is not read as fully delivered:

- 163 FR-040 ("for every scoped field, a way to set it at each supported scope") is **not met** for user
  attributes at C and C×L (no admin input) and for name / description at C (API refusal) — resolved by US5
  and FR-065.
- 163 FR-042 (read-only without the product-edit permission) is **not met** for name / description
  overrides and user attributes (F4) — resolved by FR-040.
- 163 FR-012 ("storing an empty value MUST NOT be the way to inherit") is **violated** by the C×L name
  clear (F8) — resolved by FR-022.
- 163 UX-3 (one "Use inherited" vocabulary) is **not met**: the channel window and audience checkboxes read
  "Set a … for this channel" with the opposite polarity (F7) — resolved by FR-023.
- 163 FR-009 Channel = yes for name / description is **unreachable** (G1) — FR-065.

## Out of Scope

- Bulk editing of scoped fields other than status (163 FR-050 stays).
- A new scope level, a "store view" entity or any change to the fallback chain (163 FR-008).
- Making any global-only field scoped.
- A generic one-click undo of a single Command (163 FR-081).
- Changes to the storefront's resolution of scoped values.
- Moving the completeness-gate setting onto the product editor.
- Per-deployment overlays (Constitution XV).

## Constitution constraints

- **I** — `catalog` owns the editor and the product's scoped data; SEO is written only by `seo`'s Commands;
  an inline SEO section, if chosen (FR-060), is a `seo` zone contribution, not a `catalog` import.
- **III** — F1 and F2 regression tests are written failing first; every FR traces to a test.
- **IX** — admin-kit primitives (`Select`, `Label`, `Checkbox`, `Badge`, `Alert`, `Button`, combobox,
  `StickyFormActions`, `useUnsavedChangesPrompt`, `ScopedDialogParts`) before anything new.
- **XI** — scoped product data stays platform-global (163 FR-083); no tenant semantics change.
- **XIII** — every write a Save performs stays an audited Command, one entry per product per Command.
- **XVI** — the product editor stays in the command palette; editor-scope links are plain, shareable URLs.
- **XVII** — `seo` off removes its SEO section and nothing else breaks; `catalog` off removes the editor.
- **WCAG 2.2 AA** — the floor in `.claude/skills/ux-laws/SKILL.md` (FR-013, FR-016, FR-024, FR-025, FR-072).
