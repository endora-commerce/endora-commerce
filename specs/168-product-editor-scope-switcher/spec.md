# Feature Specification: Three-level product scope model and one scope switcher for the product editor

**Feature Branch**: `feat/168-product-editor-scope-switcher`
**Created**: 2026-10-29
**Status**: Draft — clarify rounds 1–5 and round 6 (from the plan) recorded; no `[NEEDS CLARIFICATION]` marker remains in the
requirements; the five owner questions raised by `plan.md` are answered (round 6) (the speckit 3-marker cap is
lifted by owner instruction)
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
backend changes small or none" no longer holds. **Narrowed by clarify round 2 (2026-10-30)**: no live data
holds the 163 model, so the migration is a schema change that need not preserve data (FR-020).

**Primary evidence**: `specs/168-product-editor-scope-switcher/design-audit.md` (designer audit of
`origin/master` at `1530b2b84`; findings F1–F15, N1–N4, questions Q1–Q14, API gaps G1–G9). The audit was
written against 163's four-level model; its Language-level recommendations (Q1, Q4, §4.2) are **void** after
clarify round 1.

**Builds on and amends**: `specs/163-product-data-scopes/` — **shipped on `master`** (pull request #473,
`78b93a44d`). This feature reverses parts of it; see *Amendments to 163*. 163 requirements not listed there
stand and are referenced by id.

## Clarifications

### Owner decisions before specification (2026-10-29)

- **F1 / F2 inside 168.** The data-loss defects found by the audit — F1 (the editor keeps only `en-US` and
  `pl-PL` for name and description; any other language is dropped) and F2 (a language-scoped user attribute
  is likely rendered as `[object Object]` and a save may overwrite its translations) — are fixed inside this
  feature, as the P1 story US1. This settles audit Q14 against its own recommendation. *(Refined by Session
  2026-10-30 round 3: no patch to the old model; US1 keeps only the F1 / F2 regression tests, run against the
  new model.)*

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
- Q: Spec boundary — is the model change a separate feature? → A: **Everything stays in spec 168**: model
  unification, data migration, reader-module adaptation, PIM / import mapping and the editor switcher,
  organised as staged user stories (model and migration first, editor after). F1 / F2 stay P1.
- Q: How is existing data migrated? → A: The **primary-language value → Global**. Every other language
  value → a Channel × language value **for every channel of the product that offers that language**. Values
  with no matching (channel, language) — product in no channel, or no channel offering that language — go to
  an **archive table** and are reported by the migration; **never deleted**. Existing C and C×L override rows
  stay. Existing Language-scoped rows (URL keys, SEO, alt text, attachment and packaging-unit translations)
  follow the same rule. **Superseded by Session 2026-10-30 (no live data)**: the migration need not preserve
  data, and the archive is dropped (FR-020…FR-025).
- Q: How do PIMs and imports, which send per-locale values, map onto the model? → A: **Explicit mapping
  only**: per PIM connection (in `pim_connector`) and for import, a configured mapping (source locale,
  optionally source channel) → a list of Endora (channel, language) targets. **Without a mapping, per-locale
  values are written nowhere and the run reports a warning.** (Context given to the owner: Magento's Akeneo
  connector maps a PIM channel to a website and derives the locale from each store view's locale setting; the
  owner chose explicit mapping instead.) Covers the CSV import adapter
  `packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`. *(Where the mapping is
  configured is refined by Session 2026-10-30, FR-045: in every connector separately.)*
- Q: (former FR-045 / FR-047, audit Q2 / Q3 / Q7) Save model, save reach, switching with unsaved edits?
  → A: **B — one atomic Command per save, writing every staged change of the current scope only.** One audit
  entry, one undo per save. Switching scope with unsaved edits asks **Save / Discard / Stay**. *(The owner's
  "B" is the owner's own label; in the audit's §4.6 table this is option C, "one orchestrating Command".)*
- Q: (former FR-060, audit Q10) SEO in the editor? → A: **Inline** in the product editor, through a **write
  port published by the `seo` module that joins the catalog transaction** — atomic. With `seo` off the section
  is absent (Principle XVII). This reverses 163's "SEO tab is a link" decision (see *Amendments to 163*).
- Q: (former FR-003) How much of F2 is P1? → A: **Stop the corruption in P1** — a save never overwrites
  translations, and the value renders correctly, read-only. *(Superseded by round 3: no patch to the old
  model.)* Full per-scope attribute inputs come with the
  attributes story (US9).

### Session 2026-10-30 (round 2)

Answers given by the owner on 2026-10-29 / 2026-10-30.

- Q: (FR-012, audience and publication window) Keep {G, C} or allow C×L? → A: **{G, C}** — scopable at Global
  and Channel only, no C×L.
- Q: (FR-012, minimum order quantity and returnable) Keep {G, C} or allow C×L? → A: **{G, C}** — no C×L.
- Q: (FR-012, gallery roles, hide image, attachment hidden) → A: **Full {G, C, C×L}** for all three.
- Q: (FR-012, user attribute flags `channelScoped` / `languageScoped`) → A: **Replaced by one "scopable"
  flag** (option (a)).
- Q: (FR-015; label superseded by round 3) Which language is a Global string, and what does a buyer see with no C×L and no C value? → A: The
  Global value is in the **primary content language** and is labelled as such in the switcher (e.g. "Global
  (en-US)"). The storefront falls back **C×L → C → Global even when Global is in another language**.
- Q: (FR-016) URL-key uniqueness without Language-level keys? → A: A URL key is **unique per effective
  (Channel, Language)**; a **Global key must not equal another product's key**.
- Q: (FR-020…FR-025, migration, reversibility, archive) → A: **There is no live data.** Only dev / demo / seed
  databases hold 163-model data. The schema migration MUST run cleanly on existing dev databases but **need not
  preserve data**; seeds and fixtures are rewritten to the new model. Therefore **dropped**: FR-021 (shadowed
  translations), FR-022 (the orphan archive), FR-023 (the migration report, including the URL-key collision
  report), FR-024 (down migration) and FR-025 (archive / "Unplaced translations" list). The owner had earlier
  answered yes to FR-024 and FR-025; that answer is **moot**, not reversed on its merits, because there is no
  data to preserve. Removed FRs keep their numbers, marked "Removed (round 2: no live data)", so citations
  stay stable.
- Q: (FR-096) Does a Global value satisfy the completeness gate at (C, L) when L is not the Global language?
  → A: **Yes, always** — an untranslated product may be published. The owner chose this **against the
  recommendation** (which was: Global satisfies the gate only where L is the Global language).
- Q: (FR-045) Where is the PIM locale mapping configured? → A: **In every connector separately**, against the
  recommendation (a shared mapping editor contributed by `pim_connector`). The connectors live outside this
  repository; 168 defines the mapping **contract** in `pim_connector` plus the CSV import mapping (the
  `import_export` products adapter). Per-connector configuration screens are an external dependency.
- Q: (FR-086) "Copy this value to other channels in the same language"? → A: **Yes, in 168**, as one audited
  Command.
- Q: (FR-093) SEO read without `catalog:write`? → A: **Relax the SEO read to `catalog:read`**; the plan MUST
  include a security review of that change.
- Q: (FR-052) Rollout of the per-tab selectors? → A: **Retire every per-tab scope selector in 168.**
- Q: (FR-056) What is remembered when the URL names no scope? → A: The **scope lives in the URL**; with no URL
  parameter the editor **restores the last scope from `product_editor_preferences`** (per admin × product).
- Q: (FR-074; corrected by round 6) What does "one undo per save" mean? → A: **(a)** — the existing audit-log undo restores the whole
  save; **no Undo button** in the editor.
- Q: (FR-097) Completeness display at coarser scopes? → A: **C×L**: per-field markers; **Channel**: a list of
  the fields missing across its languages; **Global**: "N incomplete scopes" with a link to the Scopes tab.
- Q: (FR-033) Search index shape? → A: **One search index per channel**; each product document carries the
  effective text (C×L → C → G) for **every language the channel offers**; storefront search matches **only the
  shopper's language** — a Polish shopper typing "drill" does not find "Wiertarka X" whose English name is
  "Drill X".
- Q: (FR-109) One read endpoint or shared pure functions? → A: **One read endpoint** returning effective value
  and source for every field at one scope (SEO through a `seo` read port); a scope switch is one request
  (audit G2).

### Session 2026-10-30 (round 3)

Answers given by the owner on 2026-10-30 to the follow-up questions raised by round 2.

- Q: (FR-045) What do per-locale field-protection paths protect under the per-connector mapping? → A:
  Protection is a **manual operator toggle** ("do not overwrite from PIM"); by default **nothing is protected**
  and the PIM overwrites everything it maps. Under 168 protection applies to the **whole field across all
  scopes** — "name" protected means no scope of name is overwritten by an import. Per-locale and per-channel
  protection paths (`name.pl_PL`, `attribute.<key>.<channel>.<locale>`, `seo.*.<locale>`) are **retired** and
  the `pim_connector` path grammar shrinks accordingly (no live data to migrate). The owner **rejected
  per-scope protection**.
- Q: (FR-016) Orphaned URL keys and redirects? → A: An **orphaned URL key keeps reserving its key**: P2 is
  refused `wiertarka` while P1's orphaned key holds it, so re-adding P1 to the channel causes no collision.
  **Redirects are keyed per (Channel, Language).**
- Q: (US1 / FR-001…FR-003) With no live data, is the F1 / F2 fix on the old model still shipped first? → A:
  **No patch to the old model.** Only the F1 / F2 regression tests (FR-002, FR-003) are kept, running against
  the new model; FR-004 carries the guarantee; **everything ships in one release**.
- Q: (FR-012) Does the "scopable" flag give C×L to non-text attributes? → A: **Text attributes get {G, C, C×L};
  numeric, boolean, date and other non-text types get {G, C}.**
- Q: (FR-096 / FR-097) Should values inherited from a higher scope be visible? → A: Owner: "values inherited
  from higher scopes should be visible/marked. We should generally give such fields a checkbox 'use value from
  the scope above', so that it is also possible to override a field with an empty value." Recorded as: every
  field at C or C×L shows a **"Use value from <parent scope>"** checkbox (Magento-style); checked = inherits,
  and the inherited value is visibly marked with its source; unchecked = an own value, which **MAY be empty**.
  An empty override is **deliberately empty**: the storefront shows nothing for that field at that scope; a
  **required field (e.g. name) refuses an empty override at save**; optional fields accept it. A Global value
  still satisfies the publish gate (**FR-096 unchanged**).
- Q: (FR-015) The Global label? → A: **Plain "Global"**, with no language suffix. The owner asked what a
  language at Global means; after the explanation (it is only a hint of the language editors write Global
  in) they chose **no hint**. The "primary content language" label of round 2 is dropped.

### Session 2026-10-30 (round 4)

Answers given by the owner on 2026-10-30 to the follow-up questions raised by round 3. The round-3 reading of
FR-060 (the parent scope is Global at C and the channel at C×L; the source line names where the value actually
comes from) and the checkbox applying to every scoped field, complex types included, stand — the owner did not
object.

- Q: Which PIM / CSV source feeds the Global value now that Global has no language? → A: Owner: "we set which
  language is our default language and it goes to Global (+ fields that have no language in the PIM, of
  course)". Set **per connector connection and per CSV import** ("source language for Global"), consistent with
  the per-connector locale mapping. Non-localizable PIM attributes also write Global. The editor label stays
  plain "Global": this is an import-source setting, not a property of Global.
- Q: What does an empty value from a PIM or a CSV cell mean? → A: **One write standard for every write path** —
  API, the PIM connector contract, CSV import, CSV export and the editor — standardised everywhere and easy to
  evolve (new tokens are additive; changing the meaning of an existing encoding is breaking):
  - field absent / empty CSV cell / `""` = **no change**;
  - `NULL` (JSON `null`) = **deliberately empty value** (empty override) — "null literally means null in the
    value";
  - `INHERIT` (JSON `{"inherit": true}`) = **remove the own value, use the value from the scope above**;
  - CSV tokens are the whole cell, exact uppercase; anything else (e.g. "null", "No NULL here") is ordinary
    text; a leading backslash escapes a literal (`\NULL` → text "NULL", `\INHERIT` → "INHERIT", `\\NULL` →
    "\NULL");
  - `NULL` on a required field and `INHERIT` at Global are row / field errors in the import report (API: a
    validation error);
  - export writes `INHERIT` for inherited and `NULL` for deliberately empty, so export → re-import is a no-op.
  Options considered and **rejected** by the owner: `""` = inherit; Magento-style `__EMPTY__VALUE__` only; a
  per-profile "empty cell means" option. This differs from JSON Merge Patch and Magento conventions, so the
  API documentation MUST state it explicitly.
- Q: Which fields are required (refuse an empty override), and which types can be empty? → A: **Required = the
  fields the publish completeness gate covers: name, URL key, attributes marked required.** Selects and
  booleans **cannot be empty** (`NULL` refused). An empty (`NULL`) date means **"no limit"** (e.g. no
  publication-window end).
- Q: Is a select / multiselect attribute text or non-text? → A: **Non-text → {G, C}**; option labels are
  translated by the option, not by the product value.
- Q: What does "Copy this value to other channels in the same language" do with existing target overrides and
  empty values? → A: It **overwrites the targets after a confirmation that lists the channels that will be
  overwritten**; copying an empty (`NULL`) value is allowed **only for optional fields**.

### Session 2026-10-30 (round 5)

Answers given by the owner on 2026-10-30 to the follow-up questions raised by round 4.

- Q: How is the change of `null` from "inherit" to "empty" versioned? → A: **In place**, in the release that
  ships 168, noted in the release notes and the changeset — no v2, no refusal period. Rationale: no live data;
  168 already reshapes the 163 API; FR-115 documents the encoding.
- Q: Does the write encoding reach inheritance that is not a product scope? → A: **Scoped product values only
  in 168.** Every other `null = inherit` field in the contracts (e.g. per-product stock mode,
  `catalog.ts:2112`) is a **named follow-up** listed in this spec, accepting that `null` temporarily has two
  meanings across contracts.
- Q: Where are a CSV import's locale mapping and source language for Global stored? → A: In a **new saved
  import profile owned by `import_export`** (new table and migration); the operator picks a profile on import.
- Q: What does `NULL` mean on a numeric field? → A: **Allowed on optional numerics, meaning "no value"** — for
  minimum order quantity, "no minimum in this channel" (like dates). Required numerics still refuse it.
- Q: Multiselect: is an empty list allowed? → A: **`NULL` is allowed on a multiselect and means "nothing
  selected"** (no extra token). A plain select and a boolean still refuse `NULL`.

### Session 2026-10-30 (round 6, from plan)

Answers given by the owner on 2026-10-30 to the five questions raised in `plan.md` (*Questions for the owner*),
plus one process decision.

- Q: (plan Q1) What does a deliberately empty override show for a field that has a derived value? → A: The
  **five SEO fields** (meta title, description, etc.) saved empty → the storefront uses the **derived value**
  (e.g. the title from the product name), as today when absent. **Image alt text** saved empty → literally
  **`alt=""`** (decorative image), **not** the asset library's own alt text.
- Q: (plan Q2, FR-070) Which product writes join the one Save? → A: The Save covers **the product row and every
  scoped field**. **Structural operations** — adding / removing / reordering variants, bundle slots, links,
  images, attachments, packaging units — plus **price-book rows, channel membership and warehouse stock** stay
  **immediate, individually audited actions**, labelled **"applies immediately"** in the editor.
- Q: (plan Q3, FR-043) Does the product export use the import profile? → A: **No.** The product CSV export writes
  **Global + per-scope columns** (e.g. `sklep_pl:pl`) and does not use an import profile, so re-importing an
  export through that layout is exact.
- Q: (plan Q4, FR-074) Is an operator-facing "Restore this save" expected? → A: **Correction of an earlier
  assumption**: the existing audit-log undo exists **only for bulk operations**, not for single Commands. The
  save's audit entry holds the **complete before-state, re-appliable through the API**; **no restore UI in
  168**; a **"Restore this save"** action on the audit entry is a **named follow-up**. (Round 2's "the existing
  audit-log undo restores the whole save" rested on that wrong assumption and is superseded.)
- Q: (plan Q5) Does the `/seo` screen keep editing product metadata? → A: `/seo` **keeps categories and CMS
  pages**; its **product mode is replaced by a link to the product editor's SEO tab** (one editing place).
- Process: a **designer builds a clickable prototype** of the editor (switcher, "Use value from …" checkbox,
  inheritance markers) **before the editor UI stream**; the **owner reviews it before that stream starts**;
  backend streams may start in parallel.

## Amendments to 163 (2026-10-29, extended 2026-10-30)

163 is shipped on `master`. The following parts of `specs/163-product-data-scopes/spec.md` are **reversed or
rewritten** by this feature from the release that ships 168; 163's text stays as the historical record:

1. **FR-009** (the per-field scope table) and its confirmation **D-2** (clarify 2026-10-21) — replaced by
   FR-011 / FR-012 here: the Language column is gone; audience, publication window, minimum order quantity
   and returnable keep {G, C}; every other scopable field supports {G, C, C×L}. In particular gallery roles and
   hide image (163: G, C) and attachment hidden (163: C only) gain C×L, and attachment hidden gains G (round 2).
2. **FR-008** fallback chain C×L → C → L → Global — replaced by **C×L → C → G** (FR-013). 163 *Terms* "Scope"
   and "Inheritance" lose the Language level.
3. **OV-1** (Session 2026-10-26: no overview reset for a product's own per-language text) — moot: a product no
   longer has "own text in a language"; every non-Global text is a C×L value with an ordinary "Use
   inherited". 163 FR-041's "every channel" (Language) row and US4 #4 ("offers only the global and language
   scopes") change accordingly: a product in no channel has the Global scope only.
4. **FR-060 completeness-gate rule** "for name and required language-scoped attributes a value counts only if
   it is set at (C, L), at C, or for L itself" — rewritten for C×L → C → G (FR-095). **163's refusal of
   cross-language fallback in the gate is reversed** (round 2, FR-096): a Global value satisfies the gate at
   every (C, L), whatever language it is written in, so an untranslated product may be published.
5. **SEO as a link** — 163 Session 2026-10-26 "SEO stub" = A and UX-4 (the SEO tab is a link to `/seo`, shown
   only with `catalog:write`) — reversed: SEO is edited inline (FR-090), and its read is relaxed to
   `catalog:read` (FR-093, round 2). The `/seo` screen's product mode is replaced by a link to the editor's SEO
   tab; categories and CMS pages stay on `/seo` (FR-094, round 6).
6. **FR-070 URL-key uniqueness "per language across all channels"**, and the notion of a product's "keys in
   language L" built on language keys — restated as uniqueness per effective (C, L) (FR-016, round 2).
7. **FR-075, FR-077, FR-078, FR-079** ("per language" / "translatable per language") — now per Channel ×
   language; FR-075's "existing per-language SEO overrides become language-scope values" is superseded by
   FR-020 (round 2: existing data need not be preserved).
8. **FR-090** (user-attribute scope flags `channelScoped` / `languageScoped`) — replaced by one "scopable" flag
   (FR-012, round 2); **FR-091** (connector scope statements) — superseded by FR-040…FR-045.
9. ***Out of Scope* "cell-to-field link" (L7)** — delivered (US12).
10. **FR-012** ("Use inherited … never stores an empty value") and **UX-3** (the "Use inherited" label) —
    rewritten (round 3, FR-060…FR-062): the checkbox reads "Use value from <parent scope>"; checking it still
    removes the override, but an unchecked field MAY hold a deliberately empty override, which stops the
    fallback; required fields refuse it.
11. **Per-locale field protection** of 163's connector rules (`pim_connector` path grammar) — replaced by
    whole-field protection across all scopes (round 3, FR-046).
12. **FR-072** redirects "in its language at every (C, L) of that language" — redirects are keyed per (Channel,
    Language) (round 3, FR-016).
13. **FR-092** (CSV scoped-status columns: an empty `status@…` cell = use inherited;
    `packages/contracts/src/catalog.ts:2784-2797`) and every other 163 write where `null` or an empty value
    means "inherit" (e.g. the gallery role `null` = use inherited, `catalog.ts:1683`) — replaced by the one write
    encoding of FR-110…FR-115 (round 4): empty = no change, `NULL` = empty, `INHERIT` = inherit. Changed in
    place, not versioned (round 5, FR-116). This includes 163's minimum order quantity encoding
    (`null` = inherit, `1` = no minimum; `packages/contracts/src/product-scopes.ts:62`): `NULL` now means no
    minimum in this channel.

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
- **Override** — a value at C or C×L. **Translation** — a C×L value of a text field; it applies to that one
  channel only.
- **Inheritance** — the effective value at a scope is the nearest value along C×L → C → G, restricted to the
  scopes the field supports. An **empty override** counts as a value: it stops the fallback (FR-013).
- **Use value from <parent scope>** — the per-field checkbox at C and C×L (round 3). Checked = the field
  inherits and shows the inherited value marked with its source; checking it removes the override. Unchecked =
  the field holds its own value at this scope, which MAY be empty (FR-060…FR-062). The parent scope is Global
  at C and the channel at C×L. Earlier text of this spec and of 163 calls the same checkbox "Use value from <parent scope>".
- **Empty override** — an override deliberately set to no value (`NULL`); the field shows nothing at that
  scope (for a date: no limit; for an optional number: no value, e.g. no minimum order quantity; for a
  multiselect: nothing selected; for an SEO field: the derived value, e.g. the title from the product name; for
  image alt text: `alt=""`, a decorative image). Refused for required fields and for single selects and
  booleans (FR-062). Distinct from *no override*, which inherits.
- **Immediate action** — a structural or cross-module product write that is not staged: it applies at once as
  its own audited Command and is labelled "applies immediately" (FR-070).
- **Write encoding** — the one way every write path says "no change" (absent / empty / `""`), "empty"
  (`NULL` / `null`) and "inherit" (`INHERIT` / `{"inherit": true}`) (FR-110…FR-115).
- **Source language for Global** — per PIM connection and per CSV import profile, the source locale whose
  values are written to Global (FR-047).
- **Import profile** — a saved CSV import configuration owned by `import_export`, holding the locale mapping
  and the source language for Global; the operator picks one on import (FR-048). A setting of the import source, not a language of Global.
- **Required field** — a field the publish completeness gate covers: name, URL key, attributes marked
  required (FR-062).
- **Field protection** — a manual operator toggle "do not overwrite from PIM" on a whole field, across all its
  scopes (FR-046).
- **Locale mapping** — a configured rule (source locale, optionally source channel) → list of (channel,
  language) targets, configured in each PIM connector separately and in each CSV import profile (FR-045, FR-048).
- **Scopable attribute** — a user attribute whose definition carries the one "scopable" flag; a text
  attribute then supports {G, C, C×L}, a numeric, boolean, date, select, multiselect or other non-text
  attribute {G, C}. A
  non-scopable attribute is Global only (FR-012).
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

An operator who opens a product whose name, description or scopable text attribute has values in more
languages than English and Polish (for example German, from a PIM) can save it without losing any of them,
and no attribute value is shown as a serialised object. There is no patch to the old model (round 3): the
F1 / F2 regression tests run against the new model, FR-004 carries the guarantee, and everything ships in one
release.

**Why this priority**: The editor destroys data today (F1, likely F2); the tests prove the new model and editor
do not. Depends on US2 and US5.

**Independent Test**: Seed name, description and a scopable text attribute at C×L values in `en-US`, `pl-PL`
and `de-DE`; open the product at another scope, change an unrelated field, save; assert every C×L value is
unchanged and no control shows a serialised object.

**Acceptance Scenarios**:

1. **Given** a name with C×L values in `en-US`, `pl-PL` and `de-DE`, **When** the operator changes an unrelated
   field and saves, **Then** the `de-DE` name is unchanged.
2. **Given** a scopable text attribute with C×L values in three languages, **When** the attributes section
   opens at any scope, **Then** no control shows `[object Object]` or a serialised map.
3. **Given** the same product, **When** the operator saves any change at one scope, **Then** the attribute's
   values at every other scope are unchanged.

---

### User Story 2 - One three-level scope model for every field (Priority: P1)

Every scopable product field — name, description, scopable attributes, status, audience, window, URL key,
SEO, gallery roles / hide / alt text, attachment name / description / hidden, packaging-unit name, minimum
order quantity, returnable — scopes the same way: a Global value, optionally overridden per sales channel
and, where the field's scope set allows (FR-012), per sales channel × language, resolved C×L → C → G. The
schema moves to that model; no live data exists, so existing dev / demo data need not be preserved and the
seeds and fixtures are rewritten to the new model (clarify round 2).

**Why this priority**: The owner's model; readers, PIM and the editor all depend on it.

**Independent Test**: Run the schema migration on a dev database holding 163-model data and assert it
completes without error; load the rewritten seed; for a product in B2B PL (pl) and Sklep PL (pl) with Global
name "Drill X" and B2B PL × pl name "Wiertarka X", assert the effective name is "Wiertarka X" at B2B PL × pl and
"Drill X" at Sklep PL × pl.

**Acceptance Scenarios**:

1. **Removed (round 2: no live data)** — was: the migration's exact data outcome.
2. **Given** a product in channels B2B PL and Sklep PL, both Polish, **When** an operator sets the name
   "Wiertarka X" at B2B PL × Polish, **Then** Sklep PL × Polish still resolves the Global "Drill X".
3. **Removed (round 2: no live data)** — was: archiving a no-channel product's Polish name.
4. **Given** any write naming a Language-only scope, **Then** it is refused with a validation error.
5. **Given** a channel-only (C) value for any field whose scope set includes C, name included, **Then** it is
   accepted and resolves for every language of that channel without a C×L value (resolves audit G1).
6. **Removed (round 2: no live data)** — was: the migration report.
7. **Given** a dev database holding 163-model data, **When** the schema migration runs, **Then** it completes
   without error, and the seeds load in the new model.
8. **Given** a C×L write for audience, publication window, minimum order quantity, returnable or a non-text
   scopable attribute, **Then** it is refused with a validation error (FR-012).
9. **Given** an empty override of description at B2B PL × Polish, **Then** that scope resolves no description,
   while Sklep PL × Polish still resolves the Global description (FR-013).

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

An operator configures, in each PIM connector (FR-045) and in each CSV import profile (FR-048), which source locale (optionally from which source
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
7. **Given** "name" marked "do not overwrite from PIM", **When** a sync maps `pl_PL` to B2B PL × pl, **Then** no
   scope of name is written; **given** no protection, **Then** the mapped scopes are overwritten (FR-044,
   FR-046).
8. **Given** a connection whose source language for Global is `en_US`, **When** a sync runs, **Then** the
   `en_US` name and every non-localizable attribute are written to Global (FR-047).
9. **Given** a CSV import whose description cell is empty, `NULL` or `INHERIT` at B2B PL × pl, **Then** the
   override is left unchanged, set to a deliberately empty value, or removed, respectively (FR-110).

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

### User Story 6 - Each scoped field says whether it inherits; "Use value from <parent scope>" works one way (Priority: P2)

At any scope, every scoped field supported there shows whether its value is inherited (and from where) or set
here; an inherited value is visibly marked. Unticking "Use value from <parent scope>" makes it editable,
pre-filled with the inherited value — the operator may also clear it to a deliberately empty override where the
field is optional; ticking it on an override stages the override's removal. One control, one polarity, for
text, select, date and list fields.

**Why this priority**: The issue's per-field model; removes five idioms (F7) and the empty-string inherit
(F8) — an empty value is now only ever a deliberate override, never a way to inherit. Depends on US5.

**Independent Test**: At C×L untick "Use value from <parent scope>" on name, enter a value, save; assert one override and one
audit entry; tick, save; assert the row is gone and the field shows the inherited value and source.

**Acceptance Scenarios**:

1. **Given** a field inheriting from Global at C×L, **Then** its control is read-only, shows the Global value
   and "Inherited from Global", and "Use value from <parent scope>" is ticked.
2. **Given** that field, **When** "Use value from <parent scope>" is unticked, **Then** the control is editable, pre-filled
   and focused.
3. **Given** an override, **When** "Use value from <parent scope>" is ticked and the operator saves, **Then** the override is
   removed and no empty value is stored.
4. **Given** "Use value from <parent scope>" ticked then unticked before saving, **Then** the original value returns and
   nothing is written.
5. **Given** a select field, **Then** it uses the same control and offers no "Inherit (…)" option.
6. **Given** a screen reader, **Then** every scoped control has an accessible name, its checkbox names its
   field, and the source line is its description.
7. **Given** description at B2B PL × Polish, **When** the checkbox is unticked, the text cleared and the
   operator saves, **Then** an empty override is stored, the field shows "set at this scope" with no value, and
   the storefront shows no description at that scope.
8. **Given** name at B2B PL × Polish, **When** the checkbox is unticked, the text cleared and the operator
   saves, **Then** the save is refused, naming the field as required, and nothing is written.

---

### User Story 7 - One atomic Save of the current scope (Priority: P2)

The editor has one Save. It writes every staged change of the current scope in one atomic, audited Command —
SEO included — so a save fully applies or writes nothing and produces one audit entry whose complete
before-state can be re-applied through the API (FR-074). Structural operations, price-book rows, channel
membership and warehouse stock are not staged: they apply immediately, each as its own audited action. Switching scope with unsaved changes asks Save / Discard / Stay.

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
5. **Given** a completed save, **When** its audit entry's before-state is re-applied through the API (FR-074),
   **Then** every field it wrote returns to its before-state.
6. **Given** `409 VERSION_CONFLICT`, **Then** nothing is written and the editor says to reload.
7. **Given** the operator adds an image or a variant, changes a price-book row, channel membership or
   warehouse stock, **Then** the change applies immediately as its own audited action, the control is labelled
   "applies immediately", and it is neither staged nor part of the next Save.

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

1. **Given** no `catalog:write`, **Then** the switcher works, every control is read-only, "Use value from <parent scope>" is
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

1. **Given** a scopable attribute at B2B PL, **When** "Use value from <parent scope>" is unticked and a value entered,
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
4. **Given** the SEO title saved empty at B2B PL × Polish, **Then** the storefront page title at that scope is the
   derived one (from the effective product name), as when no SEO title exists (FR-013).
5. **Given** the `/seo` screen, **Then** categories and CMS pages are edited there, and a product offers a link
   to the product editor's SEO tab instead of a product editing mode (FR-094).

---

### User Story 11 - What is missing at the current scope (Priority: P3)

The editor names the values the completeness gate would report missing at the editor scope, each linked to
its field.

**Why this priority**: Avoids refused or warned status changes; a convenience over US5.

**Independent Test**: Seed a product missing its URL key at B2B PL × Polish; switch there; assert the missing
field is named and its link focuses it.

**Acceptance Scenarios**:

1. **Given** C×L with name and URL key missing, **Then** both are named, each linking to its field.
2. **Given** C, **Then** the fields missing across the channel's languages are listed; **given** Global,
   **Then** "N incomplete scopes" is shown with a link to the Scopes tab (FR-097).
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

- **Migration edge cases removed (round 2: no live data)** — product in no channel, an existing C×L override,
  a Language value shadowed by a C override, a product with no primary-language value, and URL-key
  collisions found by the migration no longer apply: existing data need not be preserved (FR-020).
- **A URL key that would collide** at some effective (C, L), or a Global key equal to another product's key —
  the write is refused, as under 163 FR-070 (FR-016).
- **A Global value written in another language than L** (e.g. English at a Polish (C, L)) — the buyer sees
  the Global value (FR-015), and the completeness gate counts it as present (FR-096).
- **An orphaned URL key** — keeps reserving its key; another product is refused it, so re-adding the first
  product to the channel causes no collision (FR-016).
- **An empty override of an optional field** — the field shows nothing at that scope; it does not fall back
  (FR-013). **Of a required field** — refused at save (FR-062).
- **A protected field** — an import or sync writes none of its scopes, whatever the mapping (FR-046).
- **A language removed from a channel after migration** — its C×L values become orphaned (163 FR-015,
  unchanged).
- **PIM run with no mapping at all** — non-localizable values and the values of the source language for Global
  (if set) still sync to Global; every other per-locale value is reported unmapped (FR-041, FR-047).
- **A CSV cell holding `null`, `Null` or `No NULL here`** — ordinary text; only the exact whole-cell `NULL` /
  `INHERIT` are tokens; `\NULL` imports the text "NULL" (FR-112).
- **`NULL` on name or a select, `INHERIT` at Global** — a field error in the import report or an API validation
  error; the rest follows FR-113.
- **Export then re-import unchanged** — writes nothing (FR-114); the export uses its own Global + per-scope
  column layout, never an import profile (FR-043).
- **Image alt text saved empty** — the storefront renders `alt=""` (decorative), not the asset library's alt
  text (FR-013).
- **Staged scoped edits plus an immediate action** — the immediate action applies at once; the staged edits stay
  staged for the next Save (FR-070).
- **Mapping target the product is not valid for** — skipped for that product and reported.
- **Remembered or linked editor scope no longer valid** — the editor opens at the nearest valid scope (Global
  if none) and says so.
- **Archived product** — the archived notice wins; the switcher still works.
- **Gate refusal on save** — the whole save is refused; missing fields named per (C, L) pair.
- **`seo` switched off while SEO changes are staged** — the save is refused with an explanation and nothing is
  written; the SEO section disappears on reload.
- **Permission lost mid-session** — a 403 refuses the whole save; nothing is claimed saved.
- **Many channels or many languages** — the selects stay usable (searchable past a threshold).
- **Clearing a text override's content** — produces a deliberately empty override (optional fields) or a
  refusal (required fields); it is never a way to inherit — inheriting is only the checkbox (FR-062).

## Requirements *(mandatory)*

### Functional Requirements

#### Data integrity (US1)

- **FR-001**: Removed (round 3: no patch to the old model) — was: an interim F1 fix on the per-language
  model. Its "no hard-coded language list" clause is carried by FR-050 (the languages the chosen channel
  offers).
- **FR-002** *(F1 test, round 3)*: A regression test, running against the new model, MUST seed name and
  description at C×L in a language other than `en-US` and `pl-PL`, perform an editor Save that does not touch
  them, and assert them unchanged.
- **FR-003** *(F2 test, round 3)*: A regression test, running against the new model, MUST seed a scopable text
  attribute with C×L values in several languages and assert that the attributes section never renders it as a
  serialised object and that a Save that does not touch it leaves every value unchanged. Per-scope inputs are
  FR-085.
- **FR-004**: A save MUST NOT change any value at any scope other than the values staged
  at the current scope.

#### Scope model (US2)

- **FR-010**: The scope levels MUST be exactly Global, Sales channel and Sales channel × language. A
  Language-only scope MUST NOT exist in data, API, resolver or UI; a write naming one MUST be refused with a
  validation error.
- **FR-011**: Every scopable field family MUST support the scope set {G, C, C×L} through **one** resolver and
  fallback chain, unless FR-012 narrows it. Complex types (gallery, attachments, packaging units) keep their
  own models and gain the same scope dimensions. Name, description, status, URL key, SEO title / description
  / OG, image alt text, attachment name and description, and packaging-unit name MUST support {G, C, C×L}.
- **FR-012** *(round 2)*: Scope sets that differ from FR-011's default:
  - **Audience and publication window** MUST support exactly {G, C} (as 163); a C×L write MUST be refused.
  - **Minimum order quantity and returnable** MUST support exactly {G, C} (as 163); a C×L write MUST be
    refused.
  - **Gallery roles, hide image and attachment hidden** MUST support {G, C, C×L} (163: roles / hide G, C;
    attachment hidden C only — attachment hidden gains G and C×L).
  - **User attributes**: the flags `channelScoped` / `languageScoped` MUST be replaced by **one "scopable"
    flag**. A scopable **text** attribute supports {G, C, C×L}; a scopable **numeric, boolean, date, select,
    multiselect or other non-text** attribute supports {G, C} (round 3; select / multiselect round 4 — option
    labels are translated by the option, not by the product value); a non-scopable attribute is Global only. 163 FR-090's
    previewable narrowing applies to a scopable → non-scopable change.
- **FR-013**: The fallback chain MUST be C×L → C → G for every field (replaces 163 FR-008). The model and the
  resolver MUST distinguish **no override** (the scope inherits) from an **empty override** (round 3): an
  empty override is the effective value at its scope and stops the fallback, so readers show nothing for that
  field there — except (round 6): an empty override of one of the **five SEO fields** makes the storefront use
  the field's **derived value** (e.g. the title from the product name), as when no SEO value exists; an empty
  **image alt text** renders literally `alt=""` (decorative image), never the asset library's own alt text.
- **FR-014**: The Global value of every translatable text field (name, description, scopable text
  attributes, URL key, SEO fields, alt text, attachment name / description, packaging-unit name) MUST be one
  string, not a per-language map. Translations MUST exist only as C×L values.
- **FR-015** *(round 2, label rewritten round 3)*: The scope switcher MUST label the Global scope plainly
  "Global", with no language suffix; a Global value carries no language. At a (C, L) with no C×L and no C
  value every reader, the storefront included, MUST fall back to the Global value **whatever language it is
  written in** (chain C×L → C → G, FR-013).
- **FR-016** *(round 2)*: A product's URL key at (C, L) is its effective key (C×L → C → G). No two products MAY
  share an effective URL key at any one (Channel, Language), and a product's Global key MUST NOT equal another
  product's key. Enforcement is unchanged from 163 FR-070: uniqueness is checked when a key is written, and a
  write that would break it is refused naming the product that holds the key. An **orphaned** URL key (163
  FR-015) MUST keep reserving its key, so re-adding its product to the channel never causes a collision
  (round 3). Redirects (163 FR-072) MUST be keyed per (Channel, Language) (round 3).
- **FR-017**: A channel-only value MUST be accepted for every field whose scope set includes C, name and
  description included (resolves audit G1).
- **FR-018**: A write for a scope invalid for the product MUST still be refused (163 FR-014), and invalidated
  values MUST still be retained as orphaned (163 FR-015).

#### Migration (US2)

No live data holds the 163 model (clarify round 2): only dev, demo and seed databases do. The migration is
therefore a schema change, not a data-preserving move.

- **FR-020** *(rewritten round 2)*: The schema migration to the three-level model MUST run cleanly on every
  existing dev / demo database holding 163-model data, but MUST NOT be required to preserve that data
  (per-language maps and Language-scoped rows of URL keys, SEO, alt text, attachment and packaging-unit
  translations included). Every seed and fixture MUST be rewritten to the new model.
- **FR-021**: Removed (round 2: no live data) — was: preserve every effective value; shadowed translations.
- **FR-022**: Removed (round 2: no live data) — was: the archive table for values with no scope to go to.
- **FR-023**: Removed (round 2: no live data) — was: the migration report of archived values and URL-key
  collisions.
- **FR-024**: Removed (round 2: no live data) — was: a down migration. The owner's earlier "yes" is moot.
- **FR-025**: Removed (round 2: no live data) — was: the "Unplaced translations" archive list. The owner's
  earlier "yes" is moot.
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
- **FR-033** *(round 2)*: Search MUST keep one index per sales channel. Each product document MUST carry the
  effective text (C×L → C → G) for **every language the channel offers**. Storefront search MUST match only the
  shopper's language: a Polish shopper typing "drill" MUST NOT find "Wiertarka X" whose English name is
  "Drill X". The plan measures the index size.
- **FR-034**: A static check or test MUST fail if any module reads the removed per-language structures after
  the migration.

#### PIM and import (US4)

- **FR-040**: Each PIM connection and each CSV import profile (FR-048) MUST hold a locale mapping: (source locale, optional source
  channel) → list of (channel, language) targets. The mapping's contract is owned by `pim_connector` and
  shared by every connector (Ergonode, Akeneo, Pimcore, UnoPim); where it is configured is FR-045.
- **FR-041**: A synchronisation or import MUST write a per-locale value only to its mapped targets (and to Global
  for the source language for Global, FR-047); a value
  with no mapping MUST be written nowhere and the run MUST report a warning naming the locale and the
  affected products.
- **FR-042**: A mapped target invalid for a product MUST be skipped and reported for that product only.
- **FR-043** *(round 6)*: The CSV product import adapter
  (`packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`) MUST follow the locale
  mapping of the chosen import profile (FR-048). The product **export MUST NOT use an import profile**: it writes
  Global plus per-scope columns (e.g. `sklep_pl:pl`), using the write encoding of FR-110…FR-115, and importing
  that layout MUST reproduce Global, C and C×L values exactly. The column naming is a plan decision.
- **FR-044**: A connector writing only Global values MUST NOT remove operator overrides (163 FR-091's rule
  stands). Unless a field is protected (FR-046), a sync or import overwrites every scope its mapping targets,
  operator overrides there included (round 3).
- **FR-045** *(round 2)*: The PIM locale mapping MUST be configured **in every connector separately** (the owner
  chose this against the recommendation of one shared mapping editor contributed by `pim_connector`). The
  connectors live outside this repository; 168 delivers the mapping **contract** in `pim_connector` and the CSV
  import mapping in the `import_export` products adapter. Each connector's configuration screen is an
  external dependency (see *Assumptions*).
- **FR-046** *(round 3)*: Field protection MUST be a manual operator toggle ("do not overwrite from PIM") per
  field; by default nothing is protected. A protected field MUST NOT be overwritten by any sync or import at
  **any** of its scopes. Per-locale and per-channel protection paths (`name.pl_PL`,
  `attribute.<key>.<channel>.<locale>`, `seo.*.<locale>`) MUST be retired and the `pim_connector` path grammar
  reduced to whole fields; per-scope protection is out of scope (owner rejected it). No existing protection
  rule is migrated (no live data).
- **FR-047** *(round 4)*: Each PIM connection and each CSV import profile (FR-048) MUST hold a **source language for Global**: the
  values of that source locale are written to Global. Non-localizable source values MUST also be written to
  Global. The setting belongs to the import source (configured with the locale mapping, FR-045); the editor's
  Global label stays plain "Global" (FR-015).
- **FR-048** *(round 5)*: `import_export` MUST own a new **saved import profile** (new table and migration,
  `import_export`'s own) holding the locale mapping (FR-040) and the source language for Global (FR-047). The
  operator MUST pick a profile when importing products; the CSV import applies that profile's mapping.

#### Scope switcher (US5)

- **FR-050**: The editor header MUST hold one scope switcher, on every tab: a "Sales channel" select (All
  channels + member channels) and a "Language" select (All languages + the languages the chosen channel
  offers). All channels → Global (the Language select then shows "All languages" and is not editable); a
  channel with All languages → C; a channel with a language → C×L.
- **FR-051**: Only scopes valid for the product MUST be offered; orphaned scopes stay on the Scopes tab.
- **FR-052**: Every tab MUST show and edit values at the editor scope; the Details chips, the gallery "Scope"
  and "Language" selects, the URL-keys "Add override" select and every all-languages-at-once dialog MUST be
  replaced by the switcher. Every per-tab scope selector MUST be retired in 168 (round 2; audit Q13).
- **FR-053**: Outside Global the scope banner MUST read "Changes apply only to <scope in words>" with an icon
  and the warning treatment, never colour alone (WCAG 1.4.1), announced through a live region present before
  its text is set (WCAG 4.1.3).
- **FR-054**: The switcher area MUST show the editor scope in words and a link to the Scopes tab; the header
  status indicator MUST show the effective status at the editor scope and its source (audit Q12, adopted).
- **FR-055**: The selects MUST be admin-kit primitives with visible labels, language names rather than codes,
  no hard-coded colours, and searchable past a threshold the plan sets (Constitution IX; WCAG 1.3.1, 4.1.2).
- **FR-056** *(round 2)*: The editor scope MUST live in the URL, which is the source of truth, so a link opens
  the editor at a scope. When the URL names no scope, the editor MUST restore the last scope of that admin
  for that product from `product_editor_preferences` (Global when none is remembered; the nearest valid scope
  when the remembered one is no longer valid, see *Edge Cases*). How the existing columns represent Global, C and C×L — e.g. redefining `lastLanguageCode = NULL`
  with a channel to mean the Channel scope (audit G3) — is a plan decision.
- **FR-057**: During a scope switch, fields MUST keep their layout, the panel MUST signal it is busy, and stale
  values MUST NOT be shown as current.

#### Per-field inherited state (US6)

- **FR-060** *(round 3)*: Every scoped field supported at the editor scope MUST show "inherited, from <source>"
  or "set at this scope" and, at C and C×L, a **"Use value from <parent scope>"** checkbox (parent = Global at
  C, the channel at C×L) whose ticked state means inherit — one polarity everywhere. An inherited value MUST
  be visibly marked with its source.
- **FR-061**: Unticking MUST make the control editable, pre-filled with the inherited value, and focused.
- **FR-062** *(round 3)*: Ticking on an existing override MUST stage its removal and the save MUST remove it;
  an empty value MUST NOT be used to inherit (fixes F8). Unticking before Save MUST restore the value and write
  nothing. An unticked field MAY be saved empty as a **deliberately empty override** (FR-013) when the field is
  optional; a save that would store an empty override of a **required** field — name, URL key, an attribute
  marked required (the fields the gate of FR-095 covers; round 4) — or of a **single select or boolean** MUST
  be refused, naming the field (FR-073). An empty **date** means "no limit" (e.g. no publication-window end);
  an empty **optional number** means "no value" — for minimum order quantity, "no minimum in this channel";
  an empty **multiselect** means "nothing selected" (round 5).
- **FR-063**: Select fields (status, returnable, audience) MUST use the same control; "Inherit (…)" options and
  "Set a … for this channel" checkboxes MUST be retired (audit Q9, adopted).
- **FR-064**: Inheriting controls MUST be read-only (not disabled); the source line MUST be the control's
  accessible description; every control MUST have an accessible name from a visible label; every "Use
  inherited" checkbox's name MUST include its field name; overridden state MUST be shown by text or icon as
  well as colour (fixes F3; WCAG 1.3.1, 1.4.1, 2.4.6, 3.3.2, 4.1.2).
- **FR-065**: Errors MUST be associated with their control and stated in text; a field whose chain yields no
  value MUST say so in text.

#### Save (US7)

- **FR-070** *(round 6)*: The editor MUST have exactly one Save, in the header, covering **the product row and
  every scoped field**; every per-section Save, auto-save on toggle and dialog Save that writes those MUST be
  retired. **Structural operations** — adding / removing / reordering variants, bundle slots, links, images,
  attachments and packaging units — and **price-book rows, channel membership and warehouse stock** MUST stay
  **immediate, individually audited actions**, not staged and not part of the Save, each labelled **"applies
  immediately"** in the editor.
- **FR-071**: A save MUST write every staged change **of the current scope only**, in **one** atomic audited
  Command, across every field family of that scope — SEO included, through `seo`'s write port (FR-091). Either
  every change applies or none does.
- **FR-072**: A save MUST produce exactly one audit entry carrying, for every field it wrote, the field, the
  scope and the before / after values. (163 FR-080's "one entry per product per command" stands; what changes
  is that one Command now spans several field families.)
- **FR-073**: A completeness-gate refusal (*refuse* mode), a validation error, a version conflict or a failed
  SEO write MUST refuse the whole save, write nothing, keep every staged change, and name the reason per field
  (and per (C, L) pair for the gate).
- **FR-074** *(round 2, corrected round 6)*: The save's audit entry MUST hold the **complete before-state**,
  re-appliable through the API (163 FR-081). No audit-log undo exists for single Commands today (only bulk
  operations have one), so 168 ships **no restore UI**; the editor MUST NOT gain an Undo button. A "Restore this
  save" action on the audit entry is a named follow-up (*Out of Scope*).
- **FR-075**: Switching scope with staged changes MUST ask Save / Discard / Stay: Save runs FR-071 and switches
  only on success; Discard drops the staged changes and switches; Stay cancels the switch. The same dialog
  MUST guard any other change of editor scope (scope-map links, US12).
- **FR-076**: A save containing a status change MUST run the completeness gate (163 FR-060 as rewritten by
  FR-095) before anything is written; in *warn* mode it MUST save and show the warnings.
- **FR-077**: Bulk scoped writes stay on the existing bulk-operation path, audited per product and reversible
  as a whole (163 FR-052, FR-081).

#### Permissions, global-only fields, staged work (US8)

- **FR-080**: One `catalog:write` check MUST govern the whole editor; without it every control is read-only,
  "Use value from <parent scope>" is replaced by the source text, and Save, Archive / Restore, Duplicate and Delete are absent;
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
- **FR-086** *(round 2)*: The editor MUST offer "Copy this value to other channels in the same language" in 168,
  run as **one audited Command** — with per-channel translations, an operator with N Polish channels would
  otherwise retype a Polish text N times. Because it writes scopes other than the editor scope, it is its own
  Command, separate from the current-scope save of FR-071 (FR-004 governs the save, not this action). It is a
  UI convenience, not a scope level. It MUST overwrite the target scopes' values after a confirmation that
  lists the channels whose values will be overwritten; copying an empty (`NULL`) value MUST be allowed only
  for optional fields (round 4).

#### SEO (US10)

- **FR-090**: SEO title, description and OG fields MUST be edited inline in the product editor's SEO tab at the
  editor scope, contributed by `seo` (reverses 163 "SEO stub" = A and UX-4).
- **FR-091**: `seo` MUST publish a write port that catalog's save Command calls inside its own transaction, so
  SEO changes commit or roll back with the rest of the save; catalog MUST NOT write SEO tables itself
  (Constitution I, XIII). The audit entry of FR-072 MUST include the SEO fields written.
- **FR-092**: With `seo` off the SEO section MUST be absent, the save MUST NOT call the port, and nothing else in
  the editor MUST change (Constitution XVII).
- **FR-093** *(round 2)*: The SEO read used by the editor, gated `catalog:write` today (audit G4), MUST be
  relaxed to `catalog:read` (a `seo`-owned change), so a read-only operator sees SEO at every scope, consistent
  with FR-080. The plan MUST include a security review of this relaxation.
- **FR-094** *(round 6)*: The `/seo` screen MUST keep editing categories and CMS pages; its **product mode MUST be
  replaced by a link to the product editor's SEO tab**, so product SEO has one editing place.

#### Completeness (US11)

- **FR-095**: The completeness gate (163 FR-060) MUST check name, URL key and every required scopable
  attribute at (C, L) along C×L → C → G; the Language-level clause of 163 FR-060 is removed.
- **FR-096** *(round 2; unchanged by round 3)*: A Global value MUST **always** satisfy the gate at every (C, L),
  whatever language it is written in — an untranslated product may be published. The owner chose this
  **against the recommendation** (Global satisfies the gate only where L is the Global language), knowingly
  reversing 163's refusal of
  cross-language fallback; consequently the gate reports a field missing at (C, L) only when no value exists
  anywhere along C×L → C → G.
- **FR-097** *(round 2)*: The editor MUST name the values the gate would report missing at the editor scope, as
  text with an icon: at **C×L**, a marker on each missing field, linked to it; at **Channel**, a list of the
  fields missing across the channel's languages; at **Global**, "N incomplete scopes" with a link to the
  Scopes tab.
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
  server and editor. **One read endpoint** MUST return the effective value and its source for every field at
  one scope, SEO included through a read port published by `seo`, so a scope switch is one request (round 2;
  audit G2). The source MUST distinguish "inherited from <scope>", "set at this scope" and "set at this scope,
  empty" (round 3).

#### One write encoding for every write path (round 4)

- **FR-110**: Every write path for scoped product values — the admin API, the `pim_connector` contract, CSV
  import, CSV export and the editor — MUST use one encoding: field absent, empty CSV cell or `""` = **no
  change**; `NULL` (JSON `null`) = **deliberately empty value** (empty override, FR-013); `INHERIT` (JSON
  `{"inherit": true}`) = **remove the own value and use the value from the scope above**.
- **FR-111**: The encoding MUST be evolvable additively: a new token MAY be added; after 168 ships, the meaning
  of an existing encoding MUST NOT change without a breaking, versioned contract change (Constitution II).
- **FR-112**: In CSV a token MUST be the whole cell in exact uppercase; anything else (e.g. `null`, `No NULL
  here`) is ordinary text. A leading backslash MUST escape a literal: `\NULL` → the text "NULL", `\INHERIT` →
  "INHERIT", `\\NULL` → "\NULL".
- **FR-113**: `NULL` on a required field or on a single select / boolean (FR-062), and `INHERIT` at Global, MUST be a
  row / field error reported in the import report, and a validation error in the API.
- **FR-114**: Export MUST write `INHERIT` for an inherited value and `NULL` for a deliberately empty one, so that
  export followed by re-import of the unchanged file writes nothing.
- **FR-115**: The API documentation (contracts in `packages/contracts/` and the engineer docs) MUST state the
  encoding explicitly, noting that it differs from JSON Merge Patch and from Magento's conventions. The owner
  rejected `""` = inherit, a Magento-style `__EMPTY__VALUE__`-only token and a per-profile "empty cell means"
  option.
- **FR-116** *(round 5)*: The change of `null` (and of an empty CSV cell) from "use inherited" under 163 to the
  FR-110 meanings MUST ship **in place** in the release that ships 168 — no versioned v2 contract and no
  refusal period — and MUST be stated in the release notes and the changeset.
- **FR-117** *(round 5)*: FR-110…FR-116 apply to **scoped product values only**. Other contract fields where
  `null` means "inherit" keep that meaning in 168 and are named follow-ups (*Out of Scope*); `null` therefore
  temporarily has two meanings across the contracts.

### Key Entities

- **Scoped value** — a field's value at G, C or C×L; one model for every field family, complex types keeping
  their own tables with the same scope dimensions. An override is either a value or a deliberately empty
  value; its absence means inherit (FR-013, round 3).
- **Global value** — for text, one string, carrying no language (FR-015).
- **Field protection** — per product field, a manual "do not overwrite from PIM" toggle covering every scope
  of the field (FR-046).
- *Translation archive entry* and *Migration report* — removed (round 2: no live data).
- **Locale mapping** — per PIM connection or CSV import profile: (source locale, optional source channel) → list of
  (channel, language) targets; contract owned by `pim_connector`, configured in each connector (FR-045).
- **URL-key redirect** — keyed per (Channel, Language) (FR-016).
- **Source language for Global** — per PIM connection and per CSV import profile (FR-047).
- **Import profile** — saved CSV import configuration owned by `import_export`: locale mapping and source
  language for Global (FR-048).
- **Write encoding** — no change / `NULL` / `INHERIT`, shared by every write path (FR-110).
- **Scopable flag** — the one flag on a user-attribute definition that replaces `channelScoped` /
  `languageScoped` (FR-012).
- **Immediate action** — a structural, price-book, channel-membership or stock write from the editor, applied
  at once as its own audited Command (FR-070).
- **Save Command** — one atomic audited write of every staged change at one scope; one audit entry with every
  field's before / after.
- **SEO write port** — published by `seo`, joined to catalog's transaction.
- **Editor scope** — G, C or C×L, carried in the URL and seeded per FR-056.
- **Product editor preference** — existing per-(admin, product) row; seeds the editor scope when the URL names
  none; the meaning of `lastLanguageCode = NULL` may be redefined by the plan (FR-056).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero data loss in the editor — an editor save changes 0 values outside the staged changes of
  the scope it saved, values in every language included (FR-002…FR-004). *(The migration half of this criterion is removed — round 2: no live data.)*
- **SC-002**: Removed (round 2: no live data) — was: the migration changes 0 storefront effective values. In
  its place: the schema migration completes without error on 100% of the existing dev / demo databases it is
  run against, and every seed and fixture loads in the new model (FR-020).
- **SC-003**: After the migration 0 modules read a per-language product map (enforced by FR-034), and every
  reader module of FR-030 has a test reading a C×L value and the Global fallback.
- **SC-004**: A translation set at one channel × language changes the answer at that pair only; 0 other pairs
  change.
- **SC-005**: Every PIM / import run reports 100% of unmapped locale values; 0 are written without a mapping.
- **SC-014** *(round 4)*: Export followed by re-import of the unchanged file writes 0 values, and every write
  path interprets absent / `""`, `NULL` and `INHERIT` identically, proven by one shared test table run against
  the API, the CSV import and the `pim_connector` contract.
- **SC-006**: The editor has exactly one scope selection control and one Save (down from five and seven).
- **SC-007**: Every save is all-or-nothing: failure injection on each field family produces 0 partial writes.
- **SC-008**: Every save produces exactly one audit entry containing 100% of the fields it wrote, and
  re-applying its before-state through the API restores 100% of them (FR-074).
- **SC-009**: Ticking "Use value from <parent scope>" removes the override in 100% of cases; 0 empty overrides
  are stored except those deliberately saved on optional fields, and 0 on required fields.
- **SC-010**: An operator without the product-edit permission views every scope with 0 editable controls.
- **SC-011**: An operator sets a C×L name and a C attribute value and saves in under 1 minute from opening the
  product, without leaving the editor.
- **SC-012**: Switching scope shows the new values with no perceptible regression against a product page load,
  and no stale values are presented as current.
- **SC-013**: The editor at Global, C and C×L passes an automated accessibility check with 0 violations against
  the WCAG 2.2 AA floor of `.claude/skills/ux-laws/SKILL.md`.

## Assumptions

- **Backend work is in scope**: model unification, the schema migration, reader adaptation, the PIM / import
  mapping contract, the `seo` write and read ports, the single read endpoint and the single save Command. The
  issue's "keep the 163 API; backend changes small or none" is superseded by clarify round 1.
- **No live data** (owner, round 2): no production installation holds 163-model data; only dev, demo and seed
  databases do. The migration need not preserve data, and seeds and fixtures are rewritten (FR-020).
- **External dependency — PIM connectors** (owner, round 2): the connectors (Ergonode, Akeneo, Pimcore,
  UnoPim) live outside this repository. 168 delivers the locale-mapping contract in `pim_connector` and the
  CSV import mapping; each connector's own mapping configuration screen is built in that connector's
  repository and is not delivered by 168 (FR-045); the same holds for its source language for Global (FR-047,
  round 4). Until a connector ships its screen, its per-locale values are unmapped and written nowhere, with a
  warning (FR-041), and only its non-localizable values reach Global.
- **Write-encoding change** (round 4): today's contracts use `null` or an empty CSV cell to mean "use
  inherited" (e.g. `packages/contracts/src/catalog.ts:1683, 2784-2797`); FR-110 gives `null` the meaning
  "empty" instead. The owner decided to make that change in place, without versioning (round 5, FR-116).
- **Blast radius** (coordinator measurement, 2026-10-29; the plan re-measures): per-locale name / description
  maps read in about ten modules (crm, orders, search, seo, comparisons, returns, pwa, projects,
  quote_requests, admin-kit); `nameTranslations` / `altText` in about twenty catalog files plus contracts,
  assets_library, page-builder-admin, quote_requests and platform; value overrides in catalog (16 files) and
  search.
- **Adopted defaults** from the audit: global-only fields read-only, not hidden (Q8); one "Use value from
  <parent scope>" control for select fields (Q9); header status at the editor scope (Q12); scope-aware zone props (G6); the
  overview needs no resets for SEO, hide, alt, attachment or packaging values because its cells now link into
  the editor (G9).
- **Void audit recommendations**: Q1 (four levels), Q4 (Language-level own text), Q5 / G1 (resolved by
  FR-017), Q14 (owner decided otherwise), §4.2's level table, §4.6's recommended option A.
- **No new permission code** (163 FR-084); **no new runtime dependency** (Constitution IV); the admin-kit
  primitives of audit §4.10 are reused.
- **One release** (round 3): every story ships together; there is no interim fix to the old model.
- **Testing**: the F1 / F2 regression tests (against the new model), the schema migration's clean-run test (SC-002 as rewritten) and
  the resolver's C×L → C → G tests are written failing first (Constitution III).
- **Security review**: the plan carries a security review of relaxing the SEO read to `catalog:read` (FR-093).
- **Prototype gate** (owner, round 6): a designer builds a clickable prototype of the editor — the scope
  switcher, the "Use value from <parent scope>" checkbox and the inheritance markers — before the editor UI
  stream; the owner reviews it **before that stream starts**. Backend streams may start in parallel.

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
- A one-click undo of a save, or any Undo button in the editor (FR-074, round 2).
- **Named follow-up — "Restore this save"**: an action on a save's audit entry that re-applies its
  before-state (FR-074, round 6). 168 ships the before-state and its API re-application only.
- Staging structural operations, price-book rows, channel membership or warehouse stock into the one Save
  (FR-070, round 6).
- A product editing mode on the `/seo` screen (FR-094, round 6).
- Preserving existing 163-model data through the migration: the archive, the migration report and a down
  migration (FR-021…FR-025, removed round 2: no live data).
- Each PIM connector's own locale-mapping configuration screen (external dependency, FR-045).
- Per-scope (per-channel or per-language) field protection (FR-046, round 3).
- An interim fix of F1 / F2 on the old per-language model (FR-001, removed round 3).
- Moving the completeness-gate setting onto the product editor.
- **Named follow-ups — `null = inherit` outside scoped product values** (FR-117, round 5; measured 2026-10-30
  by grepping `packages/contracts/src`, the plan re-measures): the per-product stock mode override
  (`catalog.ts:2112`, inherits the global stock mode); the organisation's stock-reservation setting
  (`organizations.ts:75`, inherits the sales channel's); a variant's base price per currency
  (`price-books.ts:971`, inherits the product's). Each keeps `null` = inherit until its follow-up adopts the
  FR-110 encoding.
- Per-deployment overlays (Constitution XV).

## Constitution constraints

- **I** — catalog owns product data and the save Command; SEO is written only through `seo`'s published write
  port; every reader module reads through catalog's (or `seo`'s) exported surface, never another module's
  tables; each module migrates its own tables.
- **III** — failing tests first for F1 / F2, the schema migration's clean run (SC-002) and every reader
  (SC-003).
- **IX** — admin-kit primitives before anything new.
- **XI** — scoped product data stays platform-global (163 FR-083).
- **XIII** — one save = one audited Command; bulk writes stay audited per product and reversible.
- **XVI** — the product editor stays in the command palette; scope links are plain URLs.
- **XVII** — `seo` off removes its SEO section and its port calls (read and write), and nothing else breaks;
  the PIM locale-mapping contract belongs to `pim_connector` and disappears with it.
- **WCAG 2.2 AA** — the floor in `.claude/skills/ux-laws/SKILL.md` (FR-053, FR-055, FR-064, FR-065, FR-107).
