# Feature Specification: Three-level product scope model and one scope switcher for the product editor

**Feature Branch**: `feat/165-product-editor-scope-switcher`
**Created**: 2026-10-29
**Status**: Draft — clarify round 1 recorded; open markers remain for the next `/speckit.clarify` round (the
speckit 3-marker cap is lifted by owner instruction)
**Input**: GitHub issue #523 — "one Magento-style scope switcher in the product editor header (Global →
Sales channel → Sales channel × Language); the whole form, every tab, shows and edits the effective values
at the chosen scope. Every scopable field gets 'Use inherited' showing the inherited value and its source;
untick = create override at the current scope, tick = remove the override (163 FR-012). Global-only fields
(SKU, type, attribute set…) read-only outside Global, labelled 'global only'. Persistent banner / colour
outside Global. Flagged user attributes (`channelScoped` / `languageScoped`) editable per scope in the
attributes section. The Scopes tab stays as the overview map; clicking a cell switches the editor scope
(delivers 163 L7). Keep the 163 API; every write stays an audited Command; backend changes small or none."
— **widened by clarify round 1 (2026-10-29)**: the feature also unifies the backend scope model to three
levels, migrates existing data, adapts every reader module and maps PIM / import locales. "Keep the 163 API;
backend changes small or none" no longer holds.

**Primary evidence**: `specs/165-product-editor-scope-switcher/design-audit.md` (designer audit of
`origin/master` at `1530b2b84`; findings F1–F15, N1–N4, questions Q1–Q14, API gaps G1–G9). The audit was
written against 163's four-level model; its Language-level recommendations (Q1, Q4, §4.2) are **void** after
clarify round 1.

**Builds on and amends**: `specs/163-product-data-scopes/` — **shipped on `master`** (pull request #473,
`78b93a44d`). This feature reverses parts of it; see *Amendments to 163*. 163 requirements not listed there
stand and are referenced by id.

## Clarifications

### Owner decisions before specification (2026-10-29)

- **F1 / F2 inside 165.** The data-loss defects found by the audit — F1 (the editor keeps only `en-US` and
  `pl-PL` for name and description; any other language is dropped) and F2 (a language-scoped user attribute
  is likely rendered as `[object Object]` and a save may overwrite its translations) — are fixed inside this
  feature, as the P1 story US1. This settles audit Q14 against its own recommendation.

### Session 2026-10-29

- Q: (FR-010, audit Q1) Which scope levels does the switcher offer? → A: **Three — Global → Sales channel →
  Sales channel × Language. The Language-only (L) scope is removed from the model, not just from the
  switcher.** Owner: "a translation of a field is simply our value in the given language × channel scope".
  Confirmed by example: a product in channels B2B PL and Sklep PL, both Polish; typing the name "Wiertarka
  X" at B2B PL × Polish leaves Sklep PL × Polish showing the Global "Drill X" — a translation does not cross
  channels (Magento store-view semantics). The audit's four-level recommendation is dropped.
- Q: What is the Global value of translatable text (name, description, alt text, attachment and
  packaging-unit names, language-scoped attributes, URL key, SEO)? → A: **One string**, not a per-language
  map. Translations exist only at Sales channel × Language.
- Q: Does each field family keep its own way of scoping? → A: Owner: **"one way on the backend; complex types
  like images, packaging or attachments keep their own models, but scopes must work the same (unless
  something is genuinely specific and you think it should have different scopes)"**. Every scopable field
  family supports the same scope set {Global, Channel, Channel × language} with one fallback chain
  C×L → C → G; complex types keep their own tables and gain the same scope dimensions. Where a field may
  genuinely need a narrower set, the spec raises it as a clarification (FR-012).
- Q: Spec boundary — is the model change a separate feature? → A: **Everything stays in spec 165**: model
  unification, data migration, reader-module adaptation, PIM / import mapping and the editor switcher,
  organised as staged user stories (model and migration first, editor after). F1 / F2 stay P1.
- Q: How is existing data migrated? → A: The **primary-language value → Global**. Every other language
  value → a Channel × language value **for every channel of the product that offers that language**. Values
  with no matching (channel, language) — product in no channel, or no channel offering that language — go to
  an **archive table** and are reported by the migration; **never deleted**. Existing C and C×L override rows
  stay. Existing Language-scoped rows (URL keys, SEO, alt text, attachment and packaging-unit translations)
  follow the same rule.
- Q: How do PIMs and imports, which send per-locale values, map onto the model? → A: **Explicit mapping
  only**: per PIM connection (in `pim_connector`) and for import, a configured mapping (source locale,
  optionally source channel) → a list of Endora (channel, language) targets. **Without a mapping, per-locale
  values are written nowhere and the run reports a warning.** (Context given to the owner: Magento's Akeneo
  connector maps a PIM channel to a website and derives the locale from each store view's locale setting; the
  owner chose explicit mapping instead.) Covers the CSV import adapter
  `packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`.
- Q: (former FR-045 / FR-047, audit Q2 / Q3 / Q7) Save model, save reach, switching with unsaved edits?
  → A: **B — one atomic Command per save, writing every staged change of the current scope only.** One audit
  entry, one undo per save. Switching scope with unsaved edits asks **Save / Discard / Stay**. *(The owner's
  "B" is the owner's own label; in the audit's §4.6 table this is option C, "one orchestrating Command".)*
- Q: (former FR-060, audit Q10) SEO in the editor? → A: **Inline** in the product editor, through a **write
  port published by the `seo` module that joins the catalog transaction** — atomic. With `seo` off the section
  is absent (Principle XVII). This reverses 163's "SEO tab is a link" decision (see *Amendments to 163*).
- Q: (former FR-003) How much of F2 is P1? → A: **Stop the corruption in P1** — a save never overwrites
  translations, and the value renders correctly, read-only. Full per-scope attribute inputs come with the
  attributes story (US9).

## Amendments to 163 (2026-10-29)

163 is shipped on `master`. The following parts of `specs/163-product-data-scopes/spec.md` are **reversed or
rewritten** by this feature from the release that ships 165; 163's text stays as the historical record:

1. **FR-009** (the per-field scope table) and its confirmation **D-2** (clarify 2026-10-21) — replaced by
   FR-011 / FR-012 here: every scopable field supports {G, C, C×L}; the Language column is gone.
2. **FR-008** fallback chain C×L → C → L → Global — replaced by **C×L → C → G** (FR-013). 163 *Terms* "Scope"
   and "Inheritance" lose the Language level.
3. **OV-1** (Session 2026-10-26: no overview reset for a product's own per-language text) — moot: a product no
   longer has "own text in a language"; every non-Global text is a C×L value with an ordinary "Use
   inherited". 163 FR-041's "every channel" (Language) row and US4 #4 ("offers only the global and language
   scopes") change accordingly: a product in no channel has the Global scope only.
4. **FR-060 completeness-gate rule** "for name and required language-scoped attributes a value counts only if
   it is set at (C, L), at C, or for L itself" — rewritten for C×L → C → G (FR-095); whether a Global value
   satisfies the gate for a language other than the Global language is open (FR-096).
5. **SEO as a link** — 163 Session 2026-10-26 "SEO stub" = A and UX-4 (the SEO tab is a link to `/seo`, shown
   only with `catalog:write`) — reversed: SEO is edited inline (FR-090).
6. **FR-070 URL-key uniqueness "per language across all channels"**, and the notion of a product's "keys in
   language L" built on language keys — restated without a Language-level key (FR-016, open).
7. **FR-075, FR-077, FR-078, FR-079** ("per language" / "translatable per language") — now per Channel ×
   language; FR-075's "existing per-language SEO overrides become language-scope values" is superseded by the
   migration of FR-020.
8. **FR-090** (user-attribute scope flags) and **FR-091** (connector scope statements) — superseded by FR-012
   and FR-040…FR-045.
9. ***Out of Scope* "cell-to-field link" (L7)** — delivered (US12).

## Corrections to the issue

1. **SEO is not edited in the product editor today.** The issue says SEO "has its own scope selector" in the
   editor; the SEO tab holds only a link to `/seo`
   (`packages/modules/seo/src/admin/zones/ProductSeoLink.tsx:27`). Inline SEO is new scope, decided by the
   owner in Session 2026-10-29.
2. **The editor holds five scope selectors**, not one: Details chips, gallery "Scope" select, gallery
   "Language" select, URL keys "Add override" select, `/seo` channel + locale (audit §1, F9).

## Current state (origin/master `1530b2b84`)

Paths are relative to `packages/modules/catalog/src/admin/` unless they start with `packages/`.

| Fact | Evidence |
| --- | --- |
| The editor hard-codes `LOCALES = ['en-US', 'pl-PL']`; on load it copies only those two keys of `name` / `description`, and on Save it trims to them | `pages/ProductEditor.tsx:59`, `:281-290`, `:344-347` |
| The product `PATCH` **replaces** the whole `name` / `description` map (bulk import merges); the contract accepts any language key | `packages/modules/catalog/src/backend/services/catalog-admin.service.ts:655-656` vs `catalog-bulk-import.service.ts:221`; `packages/contracts/src/common.ts:48` |
| Consequence (stronger than audit F1): a product whose name exists in a third language **loses it on any editor Save**, even if nobody touched the name | the two rows above |
| A language-scoped attribute's baseline is a `{language: value}` map; the attributes tab renders it with `String(value)` and writes the whole `attributeValues` object back | `packages/contracts/src/product-value-resolver.ts:79-83`; `components/ProductAttributesTab.tsx:19, 216, 277`; `pages/ProductEditor.tsx:354, 381` |
| Name, description and language-scoped attributes are per-language maps at Global; alt text, attachment and packaging-unit names are `{language: value}` maps; URL keys and SEO have Language-level rows | 163 FR-009; `packages/contracts/src/catalog.ts:1790, 1861` |
| Per-locale name / description maps are read in about ten modules (crm, orders, search, seo, comparisons, returns, pwa, projects, quote_requests, admin-kit); `nameTranslations` / `altText` in about twenty catalog files plus contracts, assets_library, page-builder-admin, quote_requests and platform; value overrides in catalog (16 files) and search | coordinator measurement 2026-10-29; the plan re-measures |
| The search index is one index per sales channel; a document carries one indexed locale | `packages/modules/search/src/backend/services/search-indexer.ts:86, 900` |
| PIM connectors share a field-protection path grammar owned by `pim_connector` | `packages/modules/pim_connector/src/manifest.ts:6, 14` |
| The API refuses a channel-only override of `name` / `description` though the resolver honours one | `packages/contracts/src/catalog.ts:3059-3062`; `packages/modules/catalog/src/backend/services/product-overrides.service.ts:194-201` (audit G1) |
| Clearing a C×L name override stages a write of `''` | audit F8 |
| Name / description overrides and attributes are editable without `catalog:write` | audit F4 |
| Switching tab discards staged override drafts | audit F5 |
| Seven save behaviours; five "inherit" idioms, one of opposite polarity | audit F6, F7 |
| `product_editor_preferences` remembers channel + language per (admin, product); `lastLanguageCode = NULL` means "primary admin language" | `packages/modules/catalog/src/backend/entities/product-editor-preference.entity.ts` (audit G3) |
| The SEO meta read is gated `catalog:write` | `packages/modules/seo/src/backend/routes.ts:349` (audit G4) |

## Terms used in this spec

- **Scope** — one of **Global (G)**, **Sales channel (C)** — every language of that channel — and **Sales
  channel × language (C×L)**. There is no Language-only scope. A scope is valid for a product only for
  channels it is a member of and languages that channel offers.
- **Global value** — the one value of a field at Global; for text, a single string (not a per-language map).
- **Global language** — the language a Global text string is understood to be written in (FR-015).
- **Override** — a value at C or C×L. **Translation** — a C×L value of a text field; it applies to that one
  channel only.
- **Inheritance** — the effective value at a scope is the nearest value along C×L → C → G, restricted to the
  scopes the field supports.
- **Use inherited** — removes the override at that scope; never stores an empty value (163 FR-012, kept).
- **Archived translation** — a pre-migration value that has no scope to go to, kept in the archive (FR-022).
  Not to be confused with an *archived product* (163 FR-019).
- **Locale mapping** — a configured rule (source locale, optionally source channel) → list of (channel,
  language) targets, per PIM connection and per import.
- **Editor scope** — the scope the product editor currently shows and edits. **Scope switcher** — the one
  control that sets it. **Scope banner** — the persistent "changes apply only to …" indication outside Global.
  **Staged change** — an edit not yet saved.
- **Global-only field** — a field 163 FR-009's closing paragraph keeps global: SKU, type, attribute set,
  categories, prices, variant / grouped / bundle structure, product links, stock, warehouses, fulfilment,
  channel membership, non-scopable attributes, the image set, attachment files and order, packaging-unit
  quantities and order.

## User Scenarios & Testing *(mandatory)*

Stories are staged: **P1** = data safety, the model and its migration, and every reader; **P2** = integrations
and the editor; **P3** = conveniences on top. Each story is testable on its own once the stories it depends
on (stated in its *Why this priority*) have shipped.

### User Story 1 - Saving a product never loses its text in any language (Priority: P1)

Before anything else changes, an operator who opens a product whose name, description or language-scoped
attribute exists in more languages than English and Polish (for example German, from a PIM) can save it
without losing any of them. A language-scoped attribute's values display correctly — read-only where the
editor cannot edit them yet — and a save never overwrites them.

**Why this priority**: The editor destroys data today (F1, likely F2). This ships first, on the current
model; after the migration (US2) the same guarantee is held by FR-004.

**Independent Test**: Seed name, description and a language-scoped string attribute in `en-US`, `pl-PL` and
`de-DE`; open the product, change an unrelated field, save; assert every language value is unchanged and no
control shows a serialised object.

**Acceptance Scenarios**:

1. **Given** a name in `en-US`, `pl-PL` and `de-DE`, **When** the operator changes an unrelated field and
   saves, **Then** the `de-DE` name is unchanged.
2. **Given** a language-scoped attribute with values in three languages, **When** the attributes section
   opens, **Then** no control shows `[object Object]` or a serialised map; each value is shown read-only with
   its language.
3. **Given** the same product, **When** the operator saves any change, **Then** the attribute's per-language
   values are unchanged.

---

### User Story 2 - One three-level scope model for every field, with existing data migrated (Priority: P1)

Every scopable product field — name, description, scopable attributes, status, audience, window, URL key,
SEO, gallery roles / hide / alt text, attachment name / description / hidden, packaging-unit name, minimum
order quantity, returnable — scopes the same way: a Global value, optionally overridden per sales channel
and per sales channel × language, resolved C×L → C → G. Existing per-language data moves into that model
without changing what any storefront shows, and nothing is deleted.

**Why this priority**: The owner's model; readers, PIM and the editor all depend on it.

**Independent Test**: Seed a product in B2B PL (pl) and Shop DE (de) with name `{en: "Drill X", pl:
"Wiertarka X", de: "Bohrer X", fr: "Perceuse X"}` (primary language `en`), a Language-level URL key in pl, an
alt text in pl and a C status override; run the migration; assert Global name = "Drill X", B2B PL × pl =
"Wiertarka X", Shop DE × de = "Bohrer X", the `fr` value in the archive and the report, the C status override
untouched, and the storefront answer at every valid (channel, language) identical before and after.

**Acceptance Scenarios**:

1. **Given** the example above, **When** the migration runs, **Then** the results are exactly those of the
   Independent Test.
2. **Given** a product in channels B2B PL and Sklep PL, both Polish, **When** an operator sets the name
   "Wiertarka X" at B2B PL × Polish, **Then** Sklep PL × Polish still resolves the Global "Drill X".
3. **Given** a product in no channel with a Polish name, **When** the migration runs, **Then** the Polish name
   is archived and reported, not deleted.
4. **Given** any write naming a Language-only scope, **Then** it is refused with a validation error.
5. **Given** a channel-only (C) value for any field whose scope set includes C, name included, **Then** it is
   accepted and resolves for every language of that channel without a C×L value (resolves audit G1).
6. **Given** the migration report, **Then** it lists per product every archived value and its reason.

---

### User Story 3 - Every reader shows the value of the buyer's channel and language (Priority: P1)

Everything that displays, searches, snapshots or exports product text — storefront pages, search, feeds,
sitemaps, comparisons, carts, orders, quotes, returns, documents, CRM, projects, PWA notifications, SEO,
admin pickers — reads the effective value at the relevant (channel, language) through catalog's exported
surface; no reader keeps reading a per-language map that no longer exists.

**Why this priority**: Without it the migration breaks every consumer of product text. Depends on US2.

**Independent Test**: For each reader module, seed a Global name and a C×L translation; read through the
module at that (C, L) and at another channel of the same language; assert the translation and the Global
value respectively.

**Acceptance Scenarios**:

1. **Given** a translation at B2B PL × Polish, **When** a buyer in Sklep PL × Polish views, searches,
   compares, orders or requests a quote, **Then** they see the Global value.
2. **Given** a (C, L) with no C×L and no C value, **Then** every reader shows the Global string (FR-015).
3. **Given** a snapshot for an order or quote, **Then** it keeps the effective value at the document's
   (channel, language) at snapshot time (163 FR-017 with the new chain).
4. **Given** the code base after this feature, **Then** a check proves no module reads the removed
   per-language structures.

---

### User Story 4 - PIM and import write translations only where they are mapped (Priority: P2)

An operator configures, per PIM connection and per import, which source locale (optionally from which source
channel) feeds which Endora (channel, language) scopes. Synchronisation and imports write per-locale values
to exactly those scopes; unmapped locales are written nowhere and the run reports a warning.

**Why this priority**: PIMs are the main source of translations; after the migration they would otherwise
write nowhere. Depends on US2.

**Independent Test**: Configure a connection mapping `pl_PL → [B2B PL × pl, Sklep PL × pl]`; sync a product
with Global, `pl_PL` and `de_DE` values; assert the Polish value at both targets, nothing for German, and a run
warning naming `de_DE`.

**Acceptance Scenarios**:

1. **Given** the mapping above, **When** a sync runs, **Then** the Polish value is written to both targets.
2. **Given** a source locale with no mapping, **Then** its values are written nowhere and the run warns,
   naming the locale and the number of affected products.
3. **Given** a mapping with a source channel, **Then** only that source channel's values feed the targets.
4. **Given** a CSV import with per-locale columns and a mapping, **Then** the same rules apply.
5. **Given** a target the product is not valid for, **Then** that target is skipped and reported for that
   product only.
6. **Given** an operator-set override, **Then** a connector writing only Global values does not remove it.

---

### User Story 5 - One switcher sets the scope of the whole editor (Priority: P2)

The operator picks Global, a sales channel, or a sales channel × language once, in the editor header; every
tab shows effective values at that scope with their source; outside Global a persistent banner says changes
apply only there. The per-tab selectors are gone.

**Why this priority**: The issue's core request (F9, F13, F15). Depends on US2.

**Independent Test**: Seed name at C×L, status at C, image roles at C and alt text at C×L; pick each scope and
assert every tab shows the matching value and source; assert no other scope selector exists.

**Acceptance Scenarios**:

1. **Given** Global, **When** the operator picks "B2B PL" and "Polish", **Then** every tab shows values at
   B2B PL × Polish and the banner reads that changes apply only to B2B PL × Polish.
2. **Given** "B2B PL" with "All languages", **Then** the editor is at the Channel scope.
3. **Given** any non-Global scope, **Then** the banner is on every tab, uses text and an icon, and is
   announced when the scope changes.
4. **Given** a channel change that leaves the chosen language unoffered, **Then** the language falls back to
   "All languages" and the fallback is announced.
5. **Given** a product in no channel, **Then** only Global is offered and the editor says why.
6. **Given** the header status indicator, **Then** it shows the effective status at the editor scope and its
   source.

---

### User Story 6 - Each scoped field says whether it inherits; "Use inherited" works one way (Priority: P2)

At any scope, every scoped field supported there shows whether its value is inherited (and from where) or set
here. Unticking "Use inherited" makes it editable, pre-filled with the inherited value; ticking it on an
override stages the override's removal. One control, one polarity, for text, select, date and list fields.

**Why this priority**: The issue's per-field model; removes five idioms (F7) and the empty-string inherit
(F8). Depends on US5.

**Independent Test**: At C×L untick "Use inherited" on name, enter a value, save; assert one override and one
audit entry; tick, save; assert the row is gone and the field shows the inherited value and source.

**Acceptance Scenarios**:

1. **Given** a field inheriting from Global at C×L, **Then** its control is read-only, shows the Global value
   and "Inherited from Global", and "Use inherited" is ticked.
2. **Given** that field, **When** "Use inherited" is unticked, **Then** the control is editable, pre-filled
   and focused.
3. **Given** an override, **When** "Use inherited" is ticked and the operator saves, **Then** the override is
   removed and no empty value is stored.
4. **Given** "Use inherited" ticked then unticked before saving, **Then** the original value returns and
   nothing is written.
5. **Given** a select field, **Then** it uses the same control and offers no "Inherit (…)" option.
6. **Given** a screen reader, **Then** every scoped control has an accessible name, its checkbox names its
   field, and the source line is its description.

---

### User Story 7 - One atomic Save of the current scope (Priority: P2)

The editor has one Save. It writes every staged change of the current scope in one atomic, audited Command —
SEO included — so a save fully applies or writes nothing, produces one audit entry, and can be undone as
one. Switching scope with unsaved changes asks Save / Discard / Stay.

**Why this priority**: Seven save behaviours today (F6); the owner chose atomicity. Depends on US5.

**Independent Test**: At B2B PL × Polish stage a name override, an alt-text override and an SEO title; save;
assert all three written and one audit entry with every before / after; inject a failure into the SEO write
and assert nothing was written.

**Acceptance Scenarios**:

1. **Given** staged changes at the current scope, **When** saved, **Then** all are written by one Command
   with one audit entry and nothing remains staged.
2. **Given** any part of the save fails (validation, gate refusal, conflict, SEO write), **Then** nothing is
   written, the reason is shown per field, and every staged change stays staged.
3. **Given** the gate in *warn* mode, **When** a save turns the product on at an incomplete pair, **Then** the
   save succeeds and the warnings are shown (163 G-2).
4. **Given** staged changes, **When** the operator switches scope, **Then** a dialog offers Save, Discard and
   Stay; Save switches only on success; Discard drops the staged changes and switches; Stay keeps everything.
5. **Given** a completed save, **When** it is undone as FR-074 defines, **Then** every field it wrote returns
   to its before-state.
6. **Given** `409 VERSION_CONFLICT`, **Then** nothing is written and the editor says to reload.

---

### User Story 8 - Read-only access and fields that cannot change at this scope (Priority: P2)

Without `catalog:write` the operator browses every scope but can change nothing. Outside Global, global-only
fields are read-only, labelled "Global only", with "Edit at Global"; scoped fields not supported at the scope
say why and offer a jump; staged work survives tab switches, and leaving the page prompts.

**Why this priority**: Closes F4 (permission leak, against 163 FR-042) and F5 (silent loss of drafts).
Depends on US5.

**Independent Test**: As `catalog:read`, switch through scopes and assert no editable control and no Save; as
`catalog:write`, at C assert SKU is read-only with "Global only"; stage a change, switch tab and back, assert
it is still staged; try to leave and assert the prompt.

**Acceptance Scenarios**:

1. **Given** no `catalog:write`, **Then** the switcher works, every control is read-only, "Use inherited" is
   replaced by the source text, and Save, Archive / Restore, Duplicate and Delete are absent.
2. **Given** a non-Global scope, **Then** global-only fields are read-only with "Global only" and "Edit at
   Global"; an all-global tab shows one notice.
3. **Given** a scoped field not supported at the editor scope (FR-012), **Then** it is read-only with the
   reason and a jump to a scope that supports it.
4. **Given** a staged change, **When** the operator switches tab and back, **Then** it is still staged.
5. **Given** staged changes, **When** the operator leaves the product, **Then** the unsaved-changes prompt
   appears.

---

### User Story 9 - Scopable user attributes per scope (Priority: P2)

The operator edits scopable user attributes at every scope the model allows, in the attributes section, with
the same inherited state as other fields — the full per-scope inputs deferred from US1.

**Why this priority**: 163 FR-040 is not met for attributes today (no C / C×L input). Depends on US6.

**Independent Test**: Define a scopable attribute; set it at C and override at C×L; save; assert the values
resolve on the storefront at the matching scopes and each save is one audited Command.

**Acceptance Scenarios**:

1. **Given** a scopable attribute at B2B PL, **When** "Use inherited" is unticked and a value entered,
   **Then** saving creates a channel value.
2. **Given** the same attribute at B2B PL × Polish, **Then** a C×L value can be set and removed.
3. **Given** a non-scopable attribute at a non-Global scope, **Then** it is read-only with "Global only".

---

### User Story 10 - SEO fields inline at the editor scope (Priority: P2)

The SEO tab shows SEO title, description and OG fields at the editor scope with the same inherited state,
contributed by `seo` and saved atomically with the rest through `seo`'s write port.

**Why this priority**: Owner decision; completes "the whole form at a scope". Depends on US7.

**Independent Test**: With `seo` on, at B2B PL × Polish stage an SEO title and a name override; save; assert
both written in one transaction and in the one audit entry; inject an SEO write failure and assert neither
was written; switch `seo` off and assert the SEO section is absent and the editor raises no error.

**Acceptance Scenarios**:

1. **Given** `seo` on, **Then** the SEO tab shows effective SEO values at the editor scope with their source.
2. **Given** a staged SEO change, **When** saved, **Then** it is written through `seo`'s write port inside the
   save's transaction.
3. **Given** `seo` off, **Then** the SEO section is absent and nothing else changes.

---

### User Story 11 - What is missing at the current scope (Priority: P3)

The editor names the values the completeness gate would report missing at the editor scope, each linked to
its field.

**Why this priority**: Avoids refused or warned status changes; a convenience over US5.

**Independent Test**: Seed a product missing its URL key at B2B PL × Polish; switch there; assert the missing
field is named and its link focuses it.

**Acceptance Scenarios**:

1. **Given** C×L with name and URL key missing, **Then** both are named, each linking to its field.
2. **Given** C or Global, **Then** missing values are summarised as FR-097 decides.
3. **Given** a complete scope, **Then** nothing is shown.

---

### User Story 12 - The scope map switches the editor scope (Priority: P3)

On the Scopes tab, each cell (C×L), "whole channel" entry (C) and the Global corner offer "Edit at <scope>";
each field named in a cell links to that field at that scope; the links are real, shareable links. Delivers
163 L7.

**Why this priority**: Makes the map actionable. Depends on US5.

**Independent Test**: Activate a cell's field link; assert the editor is at that C×L with the field's tab open
and the field focused; open it in a new tab with the same result.

**Acceptance Scenarios**:

1. **Given** the Scopes tab, **When** "Edit at B2B PL × Polish" is activated, **Then** the editor scope
   becomes B2B PL × Polish.
2. **Given** a cell naming "URL key", **When** activated, **Then** the URL-key field opens at that scope.
3. **Given** staged changes, **When** a map link is activated, **Then** the Save / Discard / Stay dialog
   appears first (FR-075).
4. **Given** the overview's resets and orphan deletion, **Then** they keep working.

---

### Edge Cases

- **Migration: product in no channel** — every non-primary-language value is archived and reported.
- **Migration: a (channel, language) that already has a C×L override** — the override stays and stays
  effective; the migrated value goes to the archive (FR-021).
- **Migration: a language value shadowed by a C override** — under 163 a C override beat the Language value;
  written as C×L it would now beat the C override and change the storefront (FR-021, open).
- **Migration: product with no primary-language value** — which value becomes Global is FR-015's question.
- **Migration: URL-key collisions** under the restated uniqueness rule (FR-016) — reported, never silently
  dropped.
- **A language removed from a channel after migration** — its C×L values become orphaned (163 FR-015,
  unchanged).
- **PIM run with no mapping at all** — Global values still sync; every per-locale value is reported unmapped.
- **Mapping target the product is not valid for** — skipped for that product and reported.
- **Remembered or linked editor scope no longer valid** — the editor opens at the nearest valid scope (Global
  if none) and says so.
- **Archived product** — the archived notice wins; the switcher still works.
- **Gate refusal on save** — the whole save is refused; missing fields named per (C, L) pair.
- **`seo` switched off while SEO changes are staged** — the save is refused with an explanation and nothing is
  written; the SEO section disappears on reload.
- **Permission lost mid-session** — a 403 refuses the whole save; nothing is claimed saved.
- **Many channels or many languages** — the selects stay usable (searchable past a threshold).
- **Clearing a text override's content** — an empty override is not a way to inherit; no `''` row is written.

## Requirements *(mandatory)*

### Functional Requirements

#### Data integrity (US1)

- **FR-001** *(F1)*: Until the migration ships, the product editor (create and edit) MUST NOT drop, trim or
  overwrite a product's name or description in any language it did not change; the languages offered MUST
  come from one shared source, never a hard-coded list (`ProductAttributesTab.tsx:19` included).
- **FR-002** *(F1 test)*: A regression test MUST seed name and description in a language other than `en-US`
  and `pl-PL`, perform an editor Save that does not touch them, and assert them unchanged.
- **FR-003** *(F2)*: The plan's first task for F2 MUST verify, on a seeded product, what the attributes
  section renders for a language-scoped attribute and what a Save writes to it, and record the result in the
  plan. Whatever it shows, the editor MUST render such a value correctly (read-only, per language) and MUST
  NOT replace its per-language values or drop one it did not change. Full per-scope inputs are FR-085.
- **FR-004**: After the migration, a save MUST NOT change any value at any scope other than the values staged
  at the current scope.

#### Scope model (US2)

- **FR-010**: The scope levels MUST be exactly Global, Sales channel and Sales channel × language. A
  Language-only scope MUST NOT exist in data, API, resolver or UI; a write naming one MUST be refused with a
  validation error.
- **FR-011**: Every scopable field family MUST support the scope set {G, C, C×L} through **one** resolver and
  fallback chain, unless FR-012 narrows it. Complex types (gallery, attachments, packaging units) keep their
  own models and gain the same scope dimensions. Name, description, status, URL key, SEO title / description
  / OG, image alt text, attachment name and description, and packaging-unit name MUST support {G, C, C×L}.
- **FR-012**: Fields that may need a narrower scope set — raised, not decided:
  - **Audience and publication window** (163: G, C). [NEEDS CLARIFICATION: Keep {G, C} or allow C×L?
    Recommendation: keep {G, C} — who may see a product and when it is published are not language decisions;
    a C×L audience would make a buyer's access depend on the page language they choose.]
  - **Minimum order quantity and returnable** (163: G, C). [NEEDS CLARIFICATION: Keep {G, C} or allow C×L?
    Recommendation: keep {G, C} — a basket's language can change mid-session; order rules changing with it
    would invalidate a valid basket by a language switch (feature 155 checks use the basket's channel).]
  - **Gallery roles, hide image, attachment hidden** (163: roles / hide G, C; attachment hidden C only).
    [NEEDS CLARIFICATION: Allow {G, C, C×L} for all three, with "hidden" also settable at G?
    Recommendation: yes, uniform — language-specific images (packaging with printed text) and documents (a
    manual only in Polish) are real cases, and uniformity is the owner's default.]
  - **Scopable user attributes**. [NEEDS CLARIFICATION: Do the flags `channelScoped` / `languageScoped`
    survive? (a) collapse into one "scopable" flag giving {G, C, C×L}, non-scopable = Global only; (b) keep
    both: channel-only → {G, C}, language-only → {G, C×L}, both → {G, C, C×L}. Recommendation: (a) — under
    the uniform model a "language-scoped" value is a C×L value anyway, and (a) removes a second scope
    vocabulary; 163 FR-090's previewable narrowing then applies only to scopable → non-scopable.]
- **FR-013**: The fallback chain MUST be C×L → C → G for every field (replaces 163 FR-008).
- **FR-014**: The Global value of every translatable text field (name, description, scopable text
  attributes, URL key, SEO fields, alt text, attachment name / description, packaging-unit name) MUST be one
  string, not a per-language map. Translations MUST exist only as C×L values.
- **FR-015**: [NEEDS CLARIFICATION: Which language does a Global string represent, and what does a buyer see at
  a (C, L) with no C×L and no C value? Recommendation: the Global string is by convention written in the
  platform's primary content language, which the editor labels at Global ("Global · English"); the storefront
  falls back to the Global string whatever its language — as 163's resolver already falls back to the primary
  language. For the migration, a product without a primary-language value takes the first non-empty value
  in the resolver's existing order as Global, and that language is also written as C×L for its channels so
  no channel's answer changes.]
- **FR-016**: URL keys MUST stay unique so that no two products resolve to the same key at one (C, L).
  [NEEDS CLARIFICATION: 163 FR-070 makes keys unique per language across all channels, built on Language-level
  keys that no longer exist. Recommendation: a product's key at (C, L) is its effective key (C×L → C → G); no
  two products MAY share an effective key at any one (C, L); a Global key MUST NOT equal any other product's
  key at any scope (as today); redirects (163 FR-072) are kept per (C, L). The migration reports every
  collision the rule finds rather than dropping a key.]
- **FR-017**: A channel-only value MUST be accepted for every field whose scope set includes C, name and
  description included (resolves audit G1).
- **FR-018**: A write for a scope invalid for the product MUST still be refused (163 FR-014), and invalidated
  values MUST still be retained as orphaned (163 FR-015).

#### Migration (US2)

- **FR-020**: A data migration MUST move every per-language value of every field in FR-014, and every existing
  Language-scoped row (URL keys, SEO, alt text, attachment and packaging-unit translations), as follows: the
  primary-language value → Global; every other language value → a C×L value for every channel of the product
  that offers that language. Existing C and C×L rows MUST stay unchanged.
- **FR-021**: The migration MUST preserve the effective value at every valid (C, L) of every product. Where a
  migrated value lands on a (C, L) that already has a C×L override, the override MUST stay and the migrated
  value MUST go to the archive. [NEEDS CLARIFICATION: Where 163 resolved a C override ahead of a Language
  value (chain C×L → C → L → G), writing that language value as C×L would now beat the C override and change
  the storefront. Recommendation: do not write it as C×L; archive it with the reason "shadowed by a channel
  value" — every effective value is preserved and nothing is deleted.]
- **FR-022**: Values with no matching (channel, language) — product in no channel, or no member channel
  offering that language — and values set aside by FR-021 MUST go to an archive table with product, field,
  language, value and reason, and MUST NOT be deleted.
- **FR-023**: The migration MUST produce a report: per product, every archived value with its reason and every
  URL-key collision (FR-016), plus totals.
- **FR-024**: [NEEDS CLARIFICATION: Is the migration reversible? Recommendation: yes within the release — a
  down migration rebuilds the per-language maps and Language rows from Global, the C×L rows the migration
  created (marked by origin) and the archive; operator edits made after the migration are reported as not
  reversible. Alternative: forward-only with a pre-migration backup.]
- **FR-025**: [NEEDS CLARIFICATION: Is the archive visible in the admin? Recommendation: yes — a read-only
  "Unplaced translations" list on the product's Scopes tab with an action to place a value at a (C, L)
  through the normal audited save, plus the platform-wide count in the migration report; otherwise the
  archive is reachable only through the database.]
- **FR-026**: The migration MUST be idempotent and MUST run as ordinary module migrations, each module
  migrating its own tables (catalog for catalog data, `seo` for SEO).

#### Readers (US3)

- **FR-030**: Every module that reads product name, description, attribute, URL-key, SEO, alt-text,
  attachment or packaging-unit text MUST read the effective value at (channel, language) through catalog's
  (or `seo`'s) exported surface (Constitution I). **No reader MAY keep reading a per-language map that no
  longer exists.** The measured population — crm, orders, search, seo, comparisons, returns, pwa, projects,
  quote_requests, admin-kit, assets_library, page-builder-admin, platform and catalog itself — is a starting
  list; the plan re-measures it.
- **FR-031**: A reader with no channel (e.g. an admin list) MUST use the Global value or name the channel it
  resolves for; it MUST NOT pick a language out of a map.
- **FR-032**: 163 FR-017 (effective (C, L) values everywhere; snapshots keep their value) MUST hold with the
  new chain.
- **FR-033**: [NEEDS CLARIFICATION: Search index shape. Today one index per channel with one indexed locale per
  document. Recommendation: keep one index per channel; a product document carries the effective text per
  language the channel offers (C×L → C → G), so B2B PL × Polish matches "Wiertarka X" and Sklep PL × Polish
  matches "Drill X"; alternative: one index per (channel, language). The plan measures index size either
  way.]
- **FR-034**: A static check or test MUST fail if any module reads the removed per-language structures after
  the migration.

#### PIM and import (US4)

- **FR-040**: Each PIM connection (mapping owned by `pim_connector`, shared by Ergonode, Akeneo, Pimcore and
  UnoPim) and each import MUST hold a locale mapping: (source locale, optional source channel) → list of
  (channel, language) targets.
- **FR-041**: A synchronisation or import MUST write a per-locale value only to its mapped targets; a value
  with no mapping MUST be written nowhere and the run MUST report a warning naming the locale and the
  affected products.
- **FR-042**: A mapped target invalid for a product MUST be skipped and reported for that product only.
- **FR-043**: The CSV product import adapter
  (`packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`) and the product export
  MUST follow the same mapping; export MUST round-trip Global, C and C×L values.
- **FR-044**: A connector writing only Global values MUST NOT remove operator overrides (163 FR-091's rule
  stands).
- **FR-045**: [NEEDS CLARIFICATION: Where is the mapping configured, and what happens to field protection?
  Recommendation: a shared mapping editor contributed by `pim_connector` to each connection's settings
  screen, and the same component on the import profile; existing per-locale field-protection paths are
  re-keyed to the mapping's targets, so protecting `name.pl_PL` protects every (channel, language) it maps to;
  the plan migrates existing protection rules and reports any it cannot map.]

#### Scope switcher (US5)

- **FR-050**: The editor header MUST hold one scope switcher, on every tab: a "Sales channel" select (All
  channels + member channels) and a "Language" select (All languages + the languages the chosen channel
  offers). All channels → Global (the Language select then shows "All languages" and is not editable); a
  channel with All languages → C; a channel with a language → C×L.
- **FR-051**: Only scopes valid for the product MUST be offered; orphaned scopes stay on the Scopes tab.
- **FR-052**: Every tab MUST show and edit values at the editor scope; the Details chips, the gallery "Scope"
  and "Language" selects, the URL-keys "Add override" select and every all-languages-at-once dialog MUST be
  replaced by the switcher. [NEEDS CLARIFICATION: Rollout — retire every per-tab selector in 165, or Details
  and Attributes first? Recommendation: all in 165 (audit Q13) — after the model change the old selectors
  address a Language scope that no longer exists, so keeping them is not an option for any field family the
  migration touches.]
- **FR-053**: Outside Global the scope banner MUST read "Changes apply only to <scope in words>" with an icon
  and the warning treatment, never colour alone (WCAG 1.4.1), announced through a live region present before
  its text is set (WCAG 4.1.3).
- **FR-054**: The switcher area MUST show the editor scope in words and a link to the Scopes tab; the header
  status indicator MUST show the effective status at the editor scope and its source (audit Q12, adopted).
- **FR-055**: The selects MUST be admin-kit primitives with visible labels, language names rather than codes,
  no hard-coded colours, and searchable past a threshold the plan sets (Constitution IX; WCAG 1.3.1, 4.1.2).
- **FR-056**: The editor scope MUST be expressible in the URL so a link opens the editor at a scope.
  [NEEDS CLARIFICATION: What is remembered when the URL names no scope? (a) the last scope per admin × product
  (`product_editor_preferences`); (b) per admin across products (feature 164's preferences); (c) nothing —
  start at Global. Recommendation: the URL as the source of truth, (a) as the seed. With three levels audit G3
  shrinks: `lastLanguageCode = NULL` with a channel can be redefined to mean "Channel scope", since its "primary
  admin language" meaning served the removed Language level — a semantic change of an existing column, no new
  column.]
- **FR-057**: During a scope switch, fields MUST keep their layout, the panel MUST signal it is busy, and stale
  values MUST NOT be shown as current.

#### Per-field inherited state (US6)

- **FR-060**: Every scoped field supported at the editor scope MUST show "inherited, from <source>" or "set at
  this scope" and, outside Global, a "Use inherited" checkbox whose ticked state means inherit — one polarity
  everywhere (163 UX-3 vocabulary).
- **FR-061**: Unticking MUST make the control editable, pre-filled with the inherited value, and focused.
- **FR-062**: Ticking on an existing override MUST stage its removal and the save MUST remove it (163 FR-012);
  no empty value MAY be stored to inherit (fixes F8). Unticking before Save MUST restore the value and write
  nothing.
- **FR-063**: Select fields (status, returnable, audience) MUST use the same control; "Inherit (…)" options and
  "Set a … for this channel" checkboxes MUST be retired (audit Q9, adopted).
- **FR-064**: Inheriting controls MUST be read-only (not disabled); the source line MUST be the control's
  accessible description; every control MUST have an accessible name from a visible label; every "Use
  inherited" checkbox's name MUST include its field name; overridden state MUST be shown by text or icon as
  well as colour (fixes F3; WCAG 1.3.1, 1.4.1, 2.4.6, 3.3.2, 4.1.2).
- **FR-065**: Errors MUST be associated with their control and stated in text; a field whose chain yields no
  value MUST say so in text.

#### Save (US7)

- **FR-070**: The editor MUST have exactly one Save, in the header; every per-section Save, auto-save on toggle
  and dialog Save that writes product data MUST be retired.
- **FR-071**: A save MUST write every staged change **of the current scope only**, in **one** atomic audited
  Command, across every field family of that scope — SEO included, through `seo`'s write port (FR-091). Either
  every change applies or none does.
- **FR-072**: A save MUST produce exactly one audit entry carrying, for every field it wrote, the field, the
  scope and the before / after values. (163 FR-080's "one entry per product per command" stands; what changes
  is that one Command now spans several field families.)
- **FR-073**: A completeness-gate refusal (*refuse* mode), a validation error, a version conflict or a failed
  SEO write MUST refuse the whole save, write nothing, keep every staged change, and name the reason per field
  (and per (C, L) pair for the gate).
- **FR-074**: Owner: "one undo per save". [NEEDS CLARIFICATION: Does this mean (a) the save's audit entry holds
  the complete before-state so the whole save is restorable as one, as 163 FR-081 provides for single writes
  (no new UI); or (b) a one-click "Undo" of a save — which 163 *Out of Scope* excluded as "a generic one-click
  undo of a single Command"? Recommendation: (a) now, (b) as a follow-up.]
- **FR-075**: Switching scope with staged changes MUST ask Save / Discard / Stay: Save runs FR-071 and switches
  only on success; Discard drops the staged changes and switches; Stay cancels the switch. The same dialog
  MUST guard any other change of editor scope (scope-map links, US12).
- **FR-076**: A save containing a status change MUST run the completeness gate (163 FR-060 as rewritten by
  FR-095) before anything is written; in *warn* mode it MUST save and show the warnings.
- **FR-077**: Bulk scoped writes stay on the existing bulk-operation path, audited per product and reversible
  as a whole (163 FR-052, FR-081).

#### Permissions, global-only fields, staged work (US8)

- **FR-080**: One `catalog:write` check MUST govern the whole editor; without it every control is read-only,
  "Use inherited" is replaced by the source text, and Save, Archive / Restore, Duplicate and Delete are absent;
  the switcher stays usable. This MUST cover name / description and attributes (fixes F4; 163 FR-042). No new
  permission code (163 FR-084).
- **FR-081**: Outside Global every global-only field MUST be read-only, labelled "Global only", with "Edit at
  Global", and not hidden (audit Q8, adopted); a tab whose fields are all global-only MUST show one notice
  instead.
- **FR-082**: A scoped field not supported at the editor scope (FR-012) MUST be read-only with its effective
  value, a reason naming its levels, and a jump to the nearest scope that supports it.
- **FR-083**: Staged changes MUST survive tab switches (fixes F5); the unsaved-changes prompt MUST consider
  every staged change on every tab.
- **FR-084**: Archive / Restore, Duplicate and Delete MUST stay global actions and say so.

#### User attributes and translation convenience (US9)

- **FR-085**: The attributes section MUST offer each scopable attribute at every scope FR-012 allows, with the
  inherited state of FR-060…FR-065; non-scopable attributes are global-only.
- **FR-086** *(candidate)*: [NEEDS CLARIFICATION: "Copy this value to other channels in the same language" —
  with per-channel translations, an operator with N Polish channels retypes a Polish text N times.
  Recommendation: offer it on every C×L text field as an explicit action that lists the target (channel,
  language) scopes, asks for confirmation and runs as its own audited Command (it writes scopes other than
  the current one, so it cannot be part of the current-scope save); alternative: defer to a follow-up. It is
  a UI convenience, not a scope level.]

#### SEO (US10)

- **FR-090**: SEO title, description and OG fields MUST be edited inline in the product editor's SEO tab at the
  editor scope, contributed by `seo` (reverses 163 "SEO stub" = A and UX-4).
- **FR-091**: `seo` MUST publish a write port that catalog's save Command calls inside its own transaction, so
  SEO changes commit or roll back with the rest of the save; catalog MUST NOT write SEO tables itself
  (Constitution I, XIII). The audit entry of FR-072 MUST include the SEO fields written.
- **FR-092**: With `seo` off the SEO section MUST be absent, the save MUST NOT call the port, and nothing else in
  the editor MUST change (Constitution XVII).
- **FR-093**: [NEEDS CLARIFICATION: SEO read without `catalog:write` — gated `catalog:write` today (audit G4), so
  a read-only operator sees no SEO. Recommendation: relax the read to `catalog:read` (a `seo`-owned change,
  security review), consistent with FR-080's read-only browsing of every scope; alternative: hide SEO from
  read-only operators with an explanation.]

#### Completeness (US11)

- **FR-095**: The completeness gate (163 FR-060) MUST check name, URL key and every required scopable
  attribute at (C, L) along C×L → C → G; the Language-level clause of 163 FR-060 is removed.
- **FR-096**: [NEEDS CLARIFICATION: Does a Global value satisfy the gate at (C, L) when L is not the Global
  language? 163 refused cross-language fallback so a missing German name would not pass as the Polish one;
  with a single Global string, "missing" can only mean "no C×L or C value". Recommendation: a Global value
  satisfies the gate only where L is the Global language (FR-015); for other languages a C×L or C value is
  required, keeping 163's intent. Alternative: any Global value satisfies the gate everywhere, which makes
  the gate meaningless for text in non-primary languages.]
- **FR-097**: The editor MUST name the values the gate would report missing at the editor scope, each linked to
  its field, as text with an icon. [NEEDS CLARIFICATION: How at coarser scopes? Recommendation: at C the union
  over the channel's languages; at Global a count of incomplete scopes linking to the Scopes tab; all in the
  switcher area (audit §4.7), read from the overview's existing missing-values data.]
- **FR-098**: After a *warn*-mode save the warnings MUST be shown and announced (163 G-2).

#### Scope map (US12; delivers 163 L7)

- **FR-100**: On the Scopes tab, each cell (C×L), each "whole channel" entry (C) and the Global corner MUST
  offer "Edit at <scope>"; each field named in a cell MUST link to that field at that scope; these MUST be real
  links. The overview's "every channel" (Language) row MUST be removed.
- **FR-101**: The overview's resets and orphan deletion MUST keep working.

#### Cross-cutting

- **FR-105**: Every new operator-facing text MUST exist in Polish and English (163 FR-043); the editor's literal
  English tab and header labels MUST be translated (audit N1).
- **FR-106**: The field zone `product.editor.field.after` MUST receive the editor scope as optional props;
  contributors ignoring them MUST keep working (audit G6, adopted).
- **FR-107**: The editor's tab list MUST meet the keyboard and naming rules of the WCAG 2.2 AA floor in
  `.claude/skills/ux-laws/SKILL.md` (audit N2).
- **FR-108**: The product editor MUST remain reachable from the command palette (Constitution XVI).
- **FR-109**: Effective values and their sources at a scope MUST come from the one resolver of FR-013, shared by
  server and editor. [NEEDS CLARIFICATION: One read endpoint returning effective value + source for every
  field at one scope (SEO through a `seo` read port), or shared pure functions over today's 6–8 reads?
  Recommendation: one read endpoint — with backend work now in scope it is cheap, and it makes a scope switch
  one request (audit G2).]

### Key Entities

- **Scoped value** — a field's value at G, C or C×L; one model for every field family, complex types keeping
  their own tables with the same scope dimensions.
- **Global value** — for text, one string; its language is FR-015's question.
- **Translation archive entry** — product, field, language, value, reason (no channel / shadowed /
  collision), migration origin; never deleted (FR-022).
- **Migration report** — per-product list of archived values and URL-key collisions, plus totals.
- **Locale mapping** — per PIM connection or import: (source locale, optional source channel) → list of
  (channel, language) targets.
- **Save Command** — one atomic audited write of every staged change at one scope; one audit entry with every
  field's before / after.
- **SEO write port** — published by `seo`, joined to catalog's transaction.
- **Editor scope** — G, C or C×L, carried in the URL and seeded per FR-056.
- **Product editor preference** — existing per-(admin, product) row; the meaning of `lastLanguageCode = NULL`
  may be redefined (FR-056).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero data loss — after US1, an editor save that does not touch a language value leaves 100% of
  them unchanged; after the migration, 100% of pre-migration language values are at a scope or in the
  archive, and 0 are deleted.
- **SC-002**: The migration changes the storefront effective value at **0** valid (channel, language) pairs,
  compared on a full snapshot of every product's effective text before and after.
- **SC-003**: After the migration 0 modules read a per-language product map (enforced by FR-034), and every
  reader module of FR-030 has a test reading a C×L value and the Global fallback.
- **SC-004**: A translation set at one channel × language changes the answer at that pair only; 0 other pairs
  change.
- **SC-005**: Every PIM / import run reports 100% of unmapped locale values; 0 are written without a mapping.
- **SC-006**: The editor has exactly one scope selection control and one Save (down from five and seven).
- **SC-007**: Every save is all-or-nothing: failure injection on each field family produces 0 partial writes.
- **SC-008**: Every save produces exactly one audit entry containing 100% of the fields it wrote.
- **SC-009**: "Use inherited" removes the override in 100% of cases; 0 empty overrides are stored.
- **SC-010**: An operator without the product-edit permission views every scope with 0 editable controls.
- **SC-011**: An operator sets a C×L name and a C attribute value and saves in under 1 minute from opening the
  product, without leaving the editor.
- **SC-012**: Switching scope shows the new values with no perceptible regression against a product page load,
  and no stale values are presented as current.
- **SC-013**: The editor at Global, C and C×L passes an automated accessibility check with 0 violations against
  the WCAG 2.2 AA floor of `.claude/skills/ux-laws/SKILL.md`.

## Assumptions

- **Backend work is in scope**: model unification, the migration, reader adaptation, the PIM / import mapping,
  the `seo` write port and the single save Command. The issue's "keep the 163 API; backend changes small or
  none" is superseded by clarify round 1.
- **Blast radius** (coordinator measurement, 2026-10-29; the plan re-measures): per-locale name / description
  maps read in about ten modules (crm, orders, search, seo, comparisons, returns, pwa, projects,
  quote_requests, admin-kit); `nameTranslations` / `altText` in about twenty catalog files plus contracts,
  assets_library, page-builder-admin, quote_requests and platform; value overrides in catalog (16 files) and
  search.
- **Adopted defaults** from the audit: global-only fields read-only, not hidden (Q8); one "Use inherited"
  control for select fields (Q9); header status at the editor scope (Q12); scope-aware zone props (G6); the
  overview needs no resets for SEO, hide, alt, attachment or packaging values because its cells now link into
  the editor (G9).
- **Void audit recommendations**: Q1 (four levels), Q4 (Language-level own text), Q5 / G1 (resolved by
  FR-017), Q14 (owner decided otherwise), §4.2's level table, §4.6's recommended option A.
- **Primary language** means the platform's primary content language as configured today.
- **No new permission code** (163 FR-084); **no new runtime dependency** (Constitution IV); the admin-kit
  primitives of audit §4.10 are reused.
- **Testing**: the F1 / F2 regression tests and the migration's effective-value-preservation test (SC-002) are
  written failing first (Constitution III).
- A designer review of a clickable prototype of the switcher area and the Save / Discard / Stay dialog is
  advisable before `/speckit.tasks`.

## Findings against 163 recorded by this specification

Code-versus-spec defects in shipped 163, resolved here:

- 163 FR-040 not met for user attributes at C / C×L (no admin input) and for name / description at C (API
  refusal) — US9, FR-017.
- 163 FR-042 not met for name / description overrides and attributes (F4) — FR-080.
- 163 FR-012 violated by the C×L name clear writing `''` (F8) — FR-062.
- 163 UX-3 not met: the channel window / audience checkboxes use the opposite polarity (F7) — FR-063.

## Out of Scope

- A Language-only scope, a "store view" entity, or any fallback other than C×L → C → G.
- Bulk editing of scoped fields other than status (163 FR-050 stands).
- Making any global-only field scoped.
- A one-click undo of a save, unless FR-074 decides (b).
- Moving the completeness-gate setting onto the product editor.
- Per-deployment overlays (Constitution XV).

## Constitution constraints

- **I** — catalog owns product data and the save Command; SEO is written only through `seo`'s published write
  port; every reader module reads through catalog's (or `seo`'s) exported surface, never another module's
  tables; each module migrates its own tables.
- **III** — failing tests first for F1 / F2, the migration invariant (SC-002) and every reader (SC-003).
- **IX** — admin-kit primitives before anything new.
- **XI** — scoped product data stays platform-global (163 FR-083).
- **XIII** — one save = one audited Command; bulk writes stay audited per product and reversible.
- **XVI** — the product editor stays in the command palette; scope links are plain URLs.
- **XVII** — `seo` off removes its SEO section and its port call, and nothing else breaks; PIM locale mappings
  belong to `pim_connector` and disappear with it.
- **WCAG 2.2 AA** — the floor in `.claude/skills/ux-laws/SKILL.md` (FR-053, FR-055, FR-064, FR-065, FR-107).
