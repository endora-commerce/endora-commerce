# Design audit — one scope switcher for the product editor (issue #523)

Input for `/speckit.specify` of `specs/168-product-editor-scope-switcher/`. Static reading of
`origin/master` at `1530b2b84`, against `.claude/skills/ux-laws/SKILL.md` and
`specs/163-product-data-scopes/` (FR-008…FR-015, FR-040…FR-043, FR-060, FR-075…FR-080, FR-100, L7).
No code was run. Paths below are relative to `packages/modules/catalog/src/admin/` unless they start
with `packages/` or `specs/`.

Scope vocabulary used here: **G** = Global, **L** = language only, **C** = sales channel (all its
languages), **C×L** = channel × language. Inheritance chain C×L → C → L → G (FR-008), restricted per
field by FR-009.

---

## 1. Inventory — every scopable field

"Editor today" lists every place the field can be edited; "Write" is the endpoint the editor uses.
"Reset" is what the Scopes tab's "Use inherited" calls (`lib/scope-overview.ts:62-102`).

| # | Field | Scopes (FR-009) | Editor today (file:line) | Write | Gap |
|---|---|---|---|---|---|
| 1 | Name | G, L, C, C×L | Details → `ProductScopeEditor` chips + `ScopedField` (`components/ProductScopeEditor.tsx:519-601`). G/L = channel chip "Global" + language chip; C×L = channel + language chip. Create form: `pages/ProductEditor.tsx:990-1010` (en-US, pl-PL only) | G/L: product `PATCH /products/:id` (header Save, `pages/ProductEditor.tsx:393-405`). C×L: `PATCH …/value-overrides` (flushed by header Save, `ProductScopeEditor.tsx:378-445`) | **C unreachable**: editing needs a language (`ProductScopeEditor.tsx:295, 323`) and the API refuses `(C, null)` for `name` (`SYSTEM_ATTRIBUTE_SCOPES` `packages/contracts/src/catalog.ts:3060` languageScoped=true → `attribute_missing_language`, `packages/modules/catalog/src/backend/services/product-overrides.service.ts:194-201`), yet the resolver honours a `(C, null)` row (`packages/contracts/src/product-value-resolver.ts:127-134`). **L limited to en-US/pl-PL** (see F1). |
| 2 | Description | G, L, C, C×L | as Name (`ProductScopeEditor.tsx:602-639`) | as Name | as Name |
| 3 | User attribute, `channelScoped` | G, C (C×L if also `languageScoped`) | Attributes tab shows the **global value only** (`components/ProductAttributesTab.tsx:154-170`) | product `PATCH` (`attributeValues`) | **No admin input for C or C×L at all** — only `PATCH …/value-overrides`, import, PIM. |
| 4 | User attribute, `languageScoped` | G, L (+C×L if channel-scoped) | Same single control per attribute; no per-language input (`ProductAttributesTab.tsx:190-280`) | product `PATCH` | **No per-language input.** The baseline is a `{lang: value}` map (resolver `pickLang`, `product-value-resolver.ts:79-83`); a string control renders it via `String(value)` (`ProductAttributesTab.tsx:277`) → `[object Object]`, and a save would replace the map with a string. Verify with a seeded product. |
| 5 | Status | G, C, C×L (no L) | G: Details identity grid (`pages/ProductEditor.tsx:899`). C / C×L: `ProductScopeControls` under the channel chips (`components/ProductScopeControls.tsx:289-359`) | G: product `PATCH` (header Save, gate). C/C×L: `PATCH …/scopes` via the panel's own "Save availability" (`:714`) | Two Saves in one card (F6). |
| 6 | Publication window | G, C | G: Details (`pages/ProductEditor.tsx:931-980`). C: `ProductScopeControls.tsx:361-368` (override checkbox `:561`) | G: product `PATCH` (`publishFrom/Until`). C: `PATCH …/scopes` | Inherit idiom = checkbox here, select elsewhere (F5). |
| 7 | Audience (visibility + orgs) | G, C | G: "Visibility" select (`pages/ProductEditor.tsx:864`). C: `ProductScopeControls.tsx:370-402` (override checkbox `:372`) | G: product `PATCH`. C: `PATCH …/scopes` | G label "Visibility" vs C legend "Audience" — one concept, two names. |
| 8 | Minimum order quantity | G, C | Inventory → `ProductOrderRulesCard` global input + own Save (`components/ProductOrderRulesCard.tsx:268-276`); channel table (`:476-540`) | G: product `PATCH` (`:81`, immediate). C: `PATCH …/scopes`, "Save channel rules" (`:551`) | Empty = inherit via placeholder (`:497`). Three save behaviours in one card (F6). |
| 9 | Returnable | G, C | G: checkbox that **auto-saves on change** (`ProductOrderRulesCard.tsx:134-150, 210-222`). C: select with "Inherit (…)" (`:520-528`) | G: product `PATCH`. C: `PATCH …/scopes` | Auto-save vs staged in the same card. |
| 10 | URL key | G, L, C×L (no C) | SEO tab → `ProductUrlKeysPanel`: every scope listed at once, "Add override" select (`components/ProductUrlKeysPanel.tsx:298-432`) | `PUT …/url-keys`, own Save | No switcher — a different model from everything else (all scopes on one screen). |
| 11 | SEO title / description / OG | G, L, C, C×L | **Not in the product editor.** SEO tab shows a link to `/seo` (`packages/modules/seo/src/admin/zones/ProductSeoLink.tsx:27`); edited in `SeoMetaScopeEditor` (`packages/modules/seo/src/admin/pages/SeoMetaScopeEditor.tsx:30-44`) with its own channel + locale selectors | `PUT/DELETE /admin/seo/meta/product/:id` (`seo` module, Commands `seo_meta_override.*`) | The issue says SEO "has its own scope selector" — it is on another screen. GET is gated `catalog:write` (`packages/modules/seo/src/backend/routes.ts:349`), so a read-only operator cannot see SEO at all. Overview cannot reset SEO (`scope-overview.ts:101` returns `null`). |
| 12 | Gallery roles (base/small/thumb) | G, C | Media → `GallerySection`, its own "Scope" select, starts at Global every time (`components/ProductGallerySection.tsx:150, 495-510`) | G: `PATCH …/gallery/:itemId` labels. C: `PUT …/gallery/channel-roles`. Flushed by header Save (`:361`) | Its own channel state, not the Details chips' and not the remembered preference. |
| 13 | Hide image | C only (shown at G) | Media, per item, when a channel is selected (`ProductGallerySection.tsx:818`) | `PATCH …/gallery/:itemId` `hiddenInChannels` (replace set) | — |
| 14 | Image alt text | G, L | Media, separate "Language" select (`ProductGallerySection.tsx:518-530`) | `PATCH …/gallery/:itemId` `altText` | Third independent language selector. |
| 15 | Attachment name, description | G, L | Attachments → per-row dialog `AttachmentScopesDialog` (all languages inline, `InheritedHint`) | `PATCH …/attachments/:id` `nameTranslations`/`descriptionTranslations`, dialog Save | `''` = inherit. |
| 16 | Attachment hidden | C only | same dialog (`components/AttachmentScopesDialog.tsx:19-22`) | `PATCH …/attachments/:id` `hiddenInChannels` | — |
| 17 | Packaging-unit name | G, L | Inventory → `PackagingUnitsEditor` → translations dialog (`components/PackagingUnitsEditor.tsx:359-366, 374+`) | `PATCH …/packaging-units/:id` `nameTranslations`, dialog Save | — |
| 18 | Every field (reset only) | per row above | Scopes tab `ProductScopeOverview` — cells, "whole channel" column, "every channel" (= L) row, orphans (`components/ProductScopeOverview.tsx:25-42, 216-380`) | owning endpoint with `null` | No cell → field link (L7). SEO, hide, alt, attachments, packaging have no reset here (`resetRequestFor` returns `null`). |

**Count of scope selectors in the editor today: 5** (Details chips; gallery Scope select; gallery
Language select; URL keys "Add override" select; `/seo` channel + locale) plus 3 dialogs that show
all languages at once. Each holds its own state.

## 2. Global-only fields (read-only outside G, labelled "Global only")

From FR-009's closing paragraph and the editor's tabs:

- **Details**: SKU (`pages/ProductEditor.tsx:831`), type (`:840`), attribute set (`:880`),
  categories (`:1036` zone + picker), Archive / Restore, Duplicate, Delete (header).
- **Attributes**: every user attribute with neither flag; the attribute set itself.
- **Pricing** tab (price books, feature 160), **Variants**, **Grouped items / Bundle slots**,
  **Related** (product links), **Inventory** stock / warehouses / fulfilment strategy
  (`ProductInventoryTab`), **Channels** (membership zone).
- **Media**: the image set (add, remove, replace asset, order). Only roles/hide (C) and alt (L) scope.
- **Attachments**: add / remove / file / type / position. Only name/description (L) and hidden (C) scope.
- **Packaging units**: base quantity, default flag, min order units, add / remove / order. Only the
  name (L) scopes.
- Platform completeness-gate setting (not on this screen; mention so nobody adds it).

Fields that are **scopable but not at every level** (render read-only *with the reason*, not "global
only"): status at L; window, audience, MOQ, returnable, roles, hide at L and C×L; alt, attachment
name, packaging name at C and C×L; URL key at C; attachment hidden at G/L (always "shown").

---

## 3. UX findings

Severity: **Must** = data loss, WCAG 2.2 AA failure, or permission leak. **Should** = misleads the
operator or breaks consistency. **Nice** = polish.

### Must fix

| # | Where | What is wrong | Law / criterion | Fix in 168 |
|---|---|---|---|---|
| F1 | `pages/ProductEditor.tsx:59, 810-820`; `ProductScopeEditor.tsx:547-553, 593` | The language chips come from the channels' languages (`languagesUnion`), but the parent's `onBaselineNameChange` / `…DescriptionChange` keep only `en-US` and `pl-PL`, and Save trims to `LOCALES` (`:344-347`). A name typed at Global × `de-DE` is **silently dropped**. Same hard-coded list in `ProductAttributesTab.tsx:19`. | Peak-End (silent loss), Tesler (derive languages, don't hard-code) | Derive the language list from scope-context / platform languages everywhere; one source. |
| F2 | `ProductAttributesTab.tsx:216, 277` | A language-scoped attribute's `{lang: value}` baseline is rendered with `String(value)`; editing would write a string over the map. Channel overrides of attributes have no input at all. | Mental Model; FR-040 not met for user attributes | Per-scope attribute inputs driven by the switcher (§4.4). |
| F3 | `ProductScopeEditor.tsx:724-749` | `ScopedField` renders its label as a `<span>`; the input has no `id`/`htmlFor`/`aria-labelledby` → **no accessible name** (only a placeholder). The source `Badge` (`:729`) is not referenced by `aria-describedby`. Absent source uses `destructive` colour as the main signal. | WCAG 1.3.1, 4.1.2, 3.3.2; 1.4.1 | Use the `StatusRow` template (`ProductScopeControls.tsx:455-474`: `Label htmlFor` + `aria-describedby` to the source). |
| F4 | `ProductScopeEditor.tsx` (no `canWrite` anywhere), `ProductAttributesTab.tsx` (none), header Save `pages/ProductEditor.tsx:652-661` | Name/description overrides and attribute values are editable for a `catalog:read` operator; the header Save is always shown. The failure arrives as a server 403 after the edit. Every other scoped surface (scope controls, order rules, URL keys, gallery, attachments, packaging, overview) already gates on `catalog:write`; the leak is exactly these three. | Disabled / no-permission state (skill §6.5); FR-042 | One `canWrite` at the page; read-only mode (§4.8). |
| F5 | `pages/ProductEditor.tsx:207-235, 769` | The unsaved-changes guard snapshots page fields + `galleryDirty` only. `hasPendingOverrideChanges` (`ProductScopeEditor.tsx:450`) is never read; drafts in `ProductScopeControls`, `ChannelOrderRules`, `ProductUrlKeysPanel` are invisible to it. Worse, the Details body is conditionally rendered (`activeTab === 'details' ? …`), so **switching tab unmounts the panel and discards override and availability drafts with no prompt**. | Peak-End, Zeigarnik (unfinished work must survive) | Lift scoped drafts to one editor-level store; the guard reads it (§4.5). |

### Should fix

| # | Where | What is wrong | Law | Fix |
|---|---|---|---|---|
| F6 | `ProductScopeControls.tsx:714` + header Save `pages/ProductEditor.tsx:652`; `ProductOrderRulesCard.tsx:134-150, 268-276, 551`; `ProductUrlKeysPanel.tsx:443+`; two dialogs | **Seven save behaviours**: header Save (product PATCH + override flush + gallery flush), "Save availability", global minimum Save, "Save channel rules", returnable auto-save on toggle, URL keys Save, dialog Saves. Two filled primary buttons in the Details card. Operators cannot predict what a Save writes. | Von Restorff (one primary per view), Jakob, Mental Model | One Save in the header, staged everything (§4.6). |
| F7 | Inherit idioms: empty input + placeholder/hint (`ProductUrlKeysPanel.tsx:322-331`, `ProductOrderRulesCard.tsx:497`, name override `ProductScopeEditor.tsx:577-583`); "Override" checkbox (`ProductScopeControls.tsx:372, 561`); select option "Inherit (value)" (`:465`, `ProductOrderRulesCard.tsx:520-528`); "Use inherited" button (`ProductScopeEditor.tsx:755-763`); `''` in dialogs | **Five idioms for one concept.** The checkbox reads "Set a window / an audience for this channel" (`packages/modules/catalog/i18n/en.json:1169, 1181`; checked = own value) where the issue's Magento model is "Use inherited" (checked = inherit) — opposite polarity. | Law of Similarity, Jakob | One `ScopedField` pattern, one polarity (§4.4). |
| F8 | `ProductScopeEditor.tsx:321-338` | Clearing a C×L name override queues an upsert of `''`, not a delete; the resolver skips empty values (`product-value-resolver.ts:116, 131`) so the storefront inherits while the overview still lists an override. | FR-012 ("storing an empty value MUST NOT be the way to inherit") | Clearing never writes `''`; inheriting is the checkbox. |
| F9 | Selectors listed in §1 | Five scope selectors with independent state; gallery always opens at Global (`ProductGallerySection.tsx:150`) even when Details remembers a channel. The operator can be at C on one tab and G on another. | Mental Model, Hick | One switcher, all tabs. |
| F10 | `ProductScopeEditor.tsx:519-559, 666-694` | Channel and language chips: `aria-pressed` toggle buttons for a single-select, inline styles with hex fallbacks (`#d4d4d8`, `#eef2ff`), raw codes as language labels, `(code)` + "• default" concatenated into the accessible name. The C-only level has no chip ("All languages" missing). | Jakob (native select / radiogroup), Constitution IX (tokens), WCAG 4.1.2 | Two admin-kit `Select`s (§4.1). |
| F11 | `ProductScopeEditor.tsx:471-477, 644-648` | The "language narrowed" notice is an `Alert` mounted with its text → not reliably announced; and it sits below the fields, far from the switcher. | WCAG 4.1.3; Proximity | Live region mounted empty in the scope bar. |
| F12 | `packages/modules/catalog/i18n/en.json:366-367` | Panel title "Scope: Sales Channel + Language" and help "Preview how this product resolves…" on a panel that edits. | Mental Model | New copy (pl + en). |
| F13 | `ProductScopeControls.tsx:248-256` | At Global the availability block says "choose a channel above"; the global status/window/audience are elsewhere on the same tab (`pages/ProductEditor.tsx:899, 931, 864`). The same field appears in two places depending on level. | Common Region, Proximity | Each field renders once and shows the current level's value. |
| F14 | `ProductSeoLink.tsx:27` | SEO is edited off-screen; the product tab is a link. Breaks "whole form at the chosen scope". | Flow / Cognitive Load | Bring SEO fields into the SEO tab as a `seo`-owned zone contribution that receives the editor scope (§6, G5). |
| F15 | `pages/ProductEditor.tsx:604, 618-620, 652-661` | The header carries a dead "Preview" button and no scope indicator; title/status pill reflect global values only. | Selective Attention; Von Restorff | Header slot for the scope bar; status pill shows effective status at scope with its source. |

### Nice to have

- N1 `pages/ProductEditor.tsx:557-591, 600-661`: literal English tab and header labels ("Details",
  "Media", "Save", "Duplicate", "Products") despite FR-043 and the i18n CI rule.
- N2 `pages/ProductEditor.tsx:750-765`: tablist without `aria-controls` / arrow-key roving focus.
- N3 Tab labels could carry a count of overrides at the current scope ("SEO · 2") so overrides are
  discoverable without opening the Scopes tab (Signal-to-Noise; keep it text, not a coloured dot).
- N4 Audience is "Visibility" at G and "Audience" at C (F-row 7): pick one word.

---

## 4. Target interaction model

### 4.1 Placement and control

- A **scope bar** directly under the page head (`b2b-page-head`), above the tabs, inside the same
  sticky header area as `StickyFormActions`, so it stays in view on long tabs (Fitts; Selective
  Attention). It replaces the Details-tab chips, the gallery Scope/Language selects and the `/seo`
  selectors.
- Two native **admin-kit `Select`s** with visible `Label`s: **Sales channel** = *All channels* +
  member channels (default channel marked in text); **Language** = *All languages* + the languages
  the chosen channel offers (all platform/channel languages under *All channels*). Reuse
  `computeLanguagePool` / `computeLanguageFallback` (`ProductScopeEditor.tsx:62-88`). Switch to
  `ui/combobox` only past ~7 channels (Miller). Two small selects beat one flattened N×M list (Hick).
- Beside them: the level in words ("Scope: Channel × language — B2B PL × Polish"), the count of
  overrides at this scope, and a link "Scope map" to the Scopes tab.
- Non-member channels are not offered (FR-014); orphans stay in the Scopes tab.

### 4.2 Levels — expose four, including language-only

| Channel select | Language select | Level |
|---|---|---|
| All channels | All languages | **G** |
| All channels | Polish | **L** |
| B2B PL | All languages | **C** |
| B2B PL | Polish | **C×L** |

Language-only **must** be exposed: FR-009 gives L to name, description, language-scoped attributes,
URL key, SEO, alt text, attachment name/description and packaging-unit names — it is the
*translation* scope, the one operators use most. The two-select model yields it for free and
mirrors the overview's own geometry (corner, "every channel" row, "whole channel" column, cells),
so the map and the switcher speak one language (Jakob, internal).

**Asymmetry the spec must state** (Q4): for name, description and language-scoped attributes the
L value *is* the product's own text in that language (the baseline map), not an override row — the
overview deliberately has no reset for it (OV-1). At L these fields show **no "Use inherited"
checkbox**; they show "Own text in Polish · falls back to <primary language> when empty". URL key
and SEO at L are real overrides and get the checkbox. At G, a language-scoped field shows the
primary-language value labelled with that language.

### 4.3 What each field shows at a level

1. **Supported here** → editable control + "Use inherited" (where an override row exists or can).
2. **Scopable, not at this level** → read-only effective value + reason + a one-click jump:
   "Status is set per channel or per channel × language. *Edit at B2B PL*". (Tesler: the system
   knows the right level.)
3. **Global only** → read-only + `Badge` "Global only" + "*Edit at Global*".
   Global-only tabs (Pricing, Variants, Composite, Related, Channels) show one notice at the top
   rather than greying every field (Signal-to-Noise).

### 4.4 Per-field inherited state (`ScopedField`)

One wrapper used by every scopable control (Similarity), built from `Label` + `Checkbox` + `Badge`
+ the field's own control; generalise `StatusRow` (`ProductScopeControls.tsx:433-478`) and
`InheritedHint` (`ScopedDialogParts.tsx:19-25`):

- Label row: field label (`<Label htmlFor>`), then a `Checkbox` wrapped in its own `<label>`
  (Fitts: whole row clickable) reading "Use inherited", with `aria-label` "Use inherited value for
  Name" so a list of twenty checkboxes is not twenty identical names in the AT form list (WCAG 2.4.6).
- **Checked (inheriting)**: the control is `readOnly` (not `disabled`: disabled text drops out of
  contrast rules and some AT skip it), shows the inherited value, and a source line
  "Inherited from Global" / "…from B2B PL" / "…from Polish" linked by `aria-describedby`.
- **Unchecked (override here)**: control editable, pre-filled with the inherited value (Tesler),
  focus moves into it; source line "Set here — B2B PL × Polish". `Badge` "Overridden" with an icon,
  never colour alone (WCAG 1.4.1).
- **Ticking an existing override** stages its removal (FR-012); no dialog, because nothing is
  written until Save and unticking restores it. The overview keeps its immediate, confirmed resets
  (UX-1).
- Select-type fields (status, returnable, visibility) use the same checkbox — retire the
  "Inherit (…)" option so there is one idiom (F7).
- Errors: `aria-invalid` + `aria-describedby` to the error, as `WindowFieldset` does
  (`ProductScopeControls.tsx:570-605`).
- The `product.editor.field.after` zone (PIM field protection) stays beside the label; its props
  gain the current scope (see G6).

### 4.5 Banner and dirty state on switch

- Outside G the scope bar switches to the **warning** treatment (`Alert variant="warning"` tokens)
  with an icon and the sentence "Changes apply only to B2B PL × Polish" — colour plus text plus
  icon. The sentence lives in a `role="status"` region mounted before it has text (the archived
  notice, `pages/ProductEditor.tsx` `product-archived-notice`, is the precedent).
- Switching scope with staged changes: recommended **keep drafts per scope** (they already are per
  channel in `ProductScopeControls`) and list them in the bar — "Unsaved: Global, B2B PL × Polish"
  (pattern of `ScopeSaveFooter`, `ProductScopeControls.tsx:706-710`). Alternative (Q7): block the
  switch with a `ModalDialog` *Save / Discard / Stay*.
- `useUnsavedChangesPrompt` reads the single draft store (fixes F5). Tab switches never unmount
  staged state.

### 4.6 Save model — options

Constraints from the code: (a) the product `PATCH` goes first and alone so a gate refusal writes
nothing (`pages/ProductEditor.tsx:385-411`); (b) `ProductScopeControls` refuses to join the page
Save for that reason (`ProductScopeControls.tsx:36-42`); (c) SEO is another module's Command
(Constitution I) — no catalog Command may write it; (d) FR-080 is one audit entry **per Command**.

| Option | How | + | − |
|---|---|---|---|
| **A. One header Save; per-endpoint Commands; fixed order** | Save writes every staged change (all scopes, or current scope only — Q7) in order: status-bearing writes first (`PATCH /products/:id`, `PATCH …/scopes`); stop on `SCOPE_INCOMPLETE`; then value-overrides, URL keys, gallery, attachments, packaging, SEO. Result per section; failed sections stay dirty. | No backend change; audit stays per field family (readable); precedent exists | Not atomic: a later failure leaves earlier writes committed — must be shown per section. There are **two** gate-bearing writes (global status via `PATCH /products/:id`, channel status via `PATCH …/scopes`): in refuse mode the first can commit while the second refuses. Mitigate by pre-checking `scope-overview` `cells[].missing` for the pairs a staged status change turns on, and showing the gaps before Save (Tesler) |
| B. Per-section Saves (today, unified look) | Keep each section's own Save | Nothing new | Fails F6; contradicts "whole form at a scope" |
| C. One orchestrating Command `product.scoped_values.save` | New catalog endpoint applying everything in one transaction | Atomic, one audit entry | Cannot include SEO (other module) without a write port; larger backend; one huge audit before/after is harder to read and to re-apply (FR-081) |

**Recommendation: A** for 168, with the order above and a per-section result list after Save
(Peak-End: say exactly what was and was not saved). Write a correlation id on the audit entries of
one Save if the CommandBus allows it (G7) so the history reads as one action. C only if the owner
wants atomicity enough to fund a SEO write port.

### 4.7 Completeness warnings at the current scope

Read `GET …/scope-overview` `cells[].missing` (already the gate's own vocabulary, FR-041) — no new
API. In the scope bar: at C×L "Missing here: Name, URL key" with each item a link that opens the
owning tab and focuses the field; at C, the union over the channel's languages; at L, the union
over channels offering it; at G, "3 scopes incomplete — Scope map". Text + icon, never colour
alone. After a Save that returns `warnings[].kind = 'completeness'`, keep the existing
`gateWarning` live region (`pages/ProductEditor.tsx` `product-gate-warning`).

### 4.8 Read-only mode (no `catalog:write`)

The switcher stays fully usable (reading effective values per scope is the point). Every control
`readOnly`; "Use inherited" checkboxes replaced by the source text only; header Save, Archive,
Delete hidden; one line in the scope bar: "Read-only — you can view values per scope." SEO needs G4.

### 4.9 Scopes tab → switch (L7)

Make the row header (channel → C), the "every channel" row (language → L), each cell (C×L) and the
corner (G) a link "Edit at <scope>" that sets the switcher and opens Details; each field name inside
a cell links to that field's tab at that scope. Keep the overview's own resets. Implement as
URL state (`?channel=&language=&tab=`), extending the `?tab=` allow-list at
`pages/ProductEditor.tsx:73-85`, so the links are plain links (keyboard, middle-click, shareable).

### 4.10 Admin-kit reuse

`Select`, `Label`, `Checkbox`, `Badge`, `Alert` (`variant="warning"`, `role="status"`), `Button`,
`ui/combobox` (many channels), `ui/section` for tab sections, `ModalDialog` (switch guard if Q7=B),
`StickyFormActions` (header Save), `useUnsavedChangesPrompt`, `ScopedDialogParts`
(`InheritedHint`, `DiscardChangesPrompt`), `StatusRow` as the `ScopedField` template,
`ContentLanguageTabs` only if Q4 chooses an all-languages-at-once view. `ScopePicker` is **not**
the right primitive (multi-select assignment, not a single current scope). No new dependency.

### 4.11 States to design

Loading (scope bar skeleton; fields keep layout while a switch re-reads — `aria-busy` on the tab
panel), product in no channel (only G and L offered; say so, US4 #4), channel offering one language,
language not offered after a channel switch (announce the fallback), orphaned override at current
scope (link to the map), gate refuse (nothing saved, per-pair message), partial save failure,
`409 VERSION_CONFLICT` ("reload and try again"), archived product (archived notice wins; scope bar
still works), `seo` module off (SEO section absent, no error), read-only.

---

## 5. Open questions for the owner (feed `/speckit.clarify`)

1. **Scope levels.** (a) G → C → C×L as in the issue; (b) all four incl. L. **Recommend (b)** —
   L is where translations live (FR-009); (a) would leave URL key / SEO / alt / attachment /
   packaging translations without a home.
2. **Save model.** (A) one header Save, per-endpoint Commands in a fixed gate-first order;
   (B) per-section saves; (C) one orchestrating Command. **Recommend A.**
3. **Save reach.** Does the header Save write (a) staged changes of **all** scopes, or (b) only the
   current scope's? **Recommend (a)** with the "Unsaved: …" list in the bar — matches
   `ProductScopeControls` today and avoids forced saves on every switch.
4. **L-level name/description/attributes.** Accept that at L these show "own text in <language>"
   without a "Use inherited" checkbox (OV-1), or (b) treat an empty language value as "inherit
   primary" with a checkbox that clears it? **Recommend (a)** — (b) re-creates the empty-means-
   inherit pattern FR-012 forbids.
5. **Channel-only (C) name/description.** FR-009 says yes; the API refuses `(C, null)` for `name`
   (G1). (a) Lift the refusal for system attributes, (b) amend FR-009 to C×L only and show name
   read-only at C. **Recommend (b)** — a channel-wide name across languages is rarely meaningful and
   (b) needs no backend change. Owner call.
6. **What the switcher remembers.** (a) per admin × product (today's table); (b) per admin across
   products (feature 164 preferences — a contract change); (c) URL state as source of truth, table
   only as seed. **Recommend (c)+(a)**: deep-linkable (L7, bulk result links), and a product never
   opened starts at G, which with the banner prevents editing a wrong scope unknowingly.
7. **Switching scope with unsaved edits.** (a) keep drafts per scope; (b) block with
   Save/Discard/Stay. **Recommend (a)** if Q3 = (a), else (b).
8. **Global-only fields outside G.** (a) read-only with "Global only" + "Edit at Global";
   (b) hidden. **Recommend (a)** — hiding makes the form shape jump per scope (Similarity).
9. **Inherit control for select fields** (status, returnable, visibility): (a) the same checkbox as
   text fields; (b) keep the "Inherit (…)" option. **Recommend (a)** (one idiom, F7).
10. **SEO in the editor.** (a) `seo` contributes an inline scoped SEO section to the SEO tab receiving
    the editor scope; (b) keep the link to `/seo`, pre-scoped. **Recommend (a)**; it needs G4/G5.
11. **SEO read for `catalog:read`.** (a) relax `GET /admin/seo/meta` to `catalog:read`; (b) hide SEO
    from read-only operators with an explanation. **Recommend (a)** (owned by `seo`; security review).
12. **Status pill in the header.** (a) effective status at the current scope with source; (b) global
    only. **Recommend (a)**.
13. **Rollout.** (a) retire every per-tab selector in 168; (b) Details + Attributes first, other tabs
    later. **Recommend (a)** — a half-migrated editor keeps F9 alive and doubles the mental model.
14. **Fix F1/F2 (data loss, language list) inside 168 or as an immediate bug fix.** **Recommend a
    separate bug fix now** — they lose data today, independent of the switcher.

---

## 6. Backend / API gaps the switcher needs

| # | Gap | Evidence | Proposal | Size |
|---|---|---|---|---|
| G1 | Channel-only override of name/description refused although FR-009 says C = yes and the resolver reads it | `packages/contracts/src/catalog.ts:3059-3062`; `packages/modules/catalog/src/backend/services/product-overrides.service.ts:194-201`; `product-value-resolver.ts:127-134` | Q5: amend FR-009 (no change) or relax the check for system attributes | none / small |
| G2 | No single read of effective value + source for every field at one scope. Today a switch needs `GET /products/:id?channelId&languageCode` (name, description, attributes), `GET …/scopes`, `GET …/url-keys`, `GET …/gallery/channel-roles` + gallery list, attachments, packaging units, `GET /admin/seo/meta…` — 6–8 requests (Doherty). Sources for window/audience/MOQ/roles/alt/attachments/packaging are computed client-side ad hoc (`lib/product-scope-drafts.ts:75-82`) | listed endpoints | Either a read-only `GET …/products/:id/scoped-values?channelId=&languageCode=` (catalog fields; SEO via its port) or pure "effective + source" functions in `packages/contracts` beside the resolver, one definition for client and server | small–medium |
| G3 | `product_editor_preferences` cannot express "channel, all languages": `lastLanguageCode = NULL` already means "primary admin language" | `packages/modules/catalog/src/backend/entities/product-editor-preference.entity.ts` (doc block), `ProductScopeEditor.tsx:212` | Add a `level` column or a sentinel; or use URL state (Q6) and keep the table as a seed | small (migration) |
| G4 | SEO meta GET gated `catalog:write` → read-only operators cannot see SEO at any scope | `packages/modules/seo/src/backend/routes.ts:349` | Q11 | small, `seo`-owned |
| G5 | SEO not available as an in-editor component; only a link | `ProductSeoLink.tsx:17-33` | `seo` contributes a scoped SEO section to `product.editor.seo.after` with `{ productId, channelId, languageCode }` props | medium, `seo`-owned |
| G6 | Zone props carry no scope: `product.editor.field.after` gets `languageCodes` and assumes a global field; contributors (PIM field protection) cannot tell which scope the field shows | `pages/ProductEditor.tsx:790-799`, `ProductAttributesTab.tsx:290-297` | Add optional `channelId`/`languageCode` to the zone props contract (feature 091); contributors that ignore them keep working | small |
| G7 | One Save → N audit entries with no link between them | FR-080; Option A in §4.6 | Correlation id on Commands run by one Save, if the CommandBus supports metadata; otherwise accept | small / none |
| G8 | No admin per-language write for language-scoped attribute baselines verified; current UI writes the whole `attributeValues` object | `ProductAttributesTab.tsx:277`, `pages/ProductEditor.tsx:354, 381` | Confirm the product `PATCH` accepts a `{lang: value}` map for language-scoped attributes and validates it; otherwise add it | verify |
| G9 | Overview cannot reset SEO, hide, alt, attachment or packaging values | `lib/scope-overview.ts:92-101` | Not needed if the cell links to the switcher (§4.9); note for the spec | none |

---

## Not done / needs a human decision

- No dev server, no screen reader or contrast measurement; F2 and G8 are from static reading and
  must be confirmed on a seeded product with a language-scoped string attribute.
- No wireframe; the model in §4 is textual. A designer review of a clickable prototype of the scope
  bar's warning treatment is advisable before tasks.
- Q1–Q14 are owner decisions; Q5, Q10 and Q11 cross into `seo` and the 163 spec (FR-009 amendment).
- F1/F2 are live data-loss risks today; whether they wait for 168 is Q14.
