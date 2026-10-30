# Contract: the product editor at a scope (US5…US12)

Owner: `catalog` admin (`packages/modules/catalog/src/admin/`), primitives in `@endora-commerce/admin-kit`, the SEO
section in `seo`'s admin. Decision: research R17. UX floor: `.claude/skills/ux-laws/SKILL.md` (WCAG 2.2 AA).
Designer audit: `design-audit.md` §4 (Language-level recommendations void).

## 1. URL state (FR-056, FR-100)

`/catalog/products/:id?scope=global|channel|cl&channel=<uuid>&language=<code>&tab=<tab>&field=<fieldPath>`

- The URL is the source of truth. No `scope` → `GET …/editor-preference` seeds it (Global when none) and the editor
  `replace`s the URL. An invalid or no-longer-valid scope → the nearest valid scope (C×L → C → G) with a live-region
  announcement "Opened at <scope>: <reason>" (spec *Edge Cases*).
- Every scope change `push`es the URL and `PUT`s the preference (debounced 500 ms, best-effort).
- `field` focuses that field after load (scope-map links, completeness links); `tab` extends today's allow-list.

## 2. Header scope bar (FR-050…FR-055, FR-057)

| Part | Spec |
| --- | --- |
| "Sales channel" `Select` | "All channels" + member channels; `Combobox` (`ui/combobox`) when more than **8** options (FR-055 threshold) |
| "Language" `Select` | "All languages" + languages of the chosen channel, by **name** (`Intl.DisplayNames`, admin locale); not editable at "All channels" |
| Scope in words | "Global" · "B2B PL — all languages" · "B2B PL × Polish"; link "Scope map" → `?tab=scopes` |
| Banner (non-Global) | `Alert variant="warning"` with icon: "Changes apply only to <scope in words>". The `role="status"` region is rendered empty on mount and its text set after (WCAG 4.1.3) |
| Read-only line (no `catalog:write`) | "Read-only — you can view values at every scope" |
| Status pill | effective status at the scope + source (FR-054) |
| Busy | during a switch the tab panel has `aria-busy="true"`, fields keep layout (skeleton values), stale values are not shown as current (FR-057) |
| Product in no channel | Channel select shows only "All channels", with the text "This product is in no sales channel, so only Global can be edited" |
| Channel change leaving the language unoffered | language falls back to "All languages"; announced |

## 3. Staged changes, Save, switch guard (FR-070…FR-076, FR-083)

- `scoped-editor-store.ts`: `{ scope, view, staged: Map<FieldPath, ScopedWriteOp> }`, reducer + context; staged
  changes belong to the current scope and survive tab switches.
- One **Save** in the header (`StickyFormActions`), enabled when `staged.size > 0` and `catalog:write`. It sends
  `PUT …/scoped-values` (`scoped-values-api.md` §3); on success the view is replaced by the response and `staged`
  cleared; on failure every staged change stays and each field shows its error (`aria-invalid`,
  `aria-describedby`); `SCOPE_INCOMPLETE` lists per (C, L) pair; `409` → "This product was changed elsewhere.
  Reload to see the latest values." with a Reload button; `503 MODULE_DISABLED` for `seo` → "SEO is switched off;
  remove the SEO changes or switch SEO on" (spec *Edge Cases*).
- Switching scope (switcher, scope-map link, completeness link) with `staged.size > 0` → `ModalDialog` "Save /
  Discard / Stay" (FR-075). `useUnsavedChangesPrompt` reads `staged`.
- **Immediate actions (FR-070, owner round 6).** Structural operations (variants, bundle slots, grouped items,
  links, images, attachments, packaging units: add / remove / reorder / replace asset), price-book rows, channel
  membership and warehouse stock run at once as their own audited Commands. Each such control carries the visible
  label "Applies immediately" (text, not only an icon). They never enter `staged`, never clear it and do not change
  the version the Save sends (R7). After one, the editor refreshes only the affected family's list and keeps every
  staged change; staged cells of a subject the action removed are dropped with a live-region notice ("Unsaved
  change to the removed image was discarded"). A membership change that makes the current scope invalid moves the
  editor to the nearest valid scope through the Save / Discard / Stay guard.
- Warn-mode warnings after a save: the existing `product-gate-warning` live region (FR-098).
- Retired: `ProductScopeEditor` chips, `ProductScopeControls`'s "Save availability", `ProductOrderRulesCard`'s two
  Saves and the returnable auto-save, `ProductUrlKeysPanel`'s "Add override" and its Save, the gallery "Scope" and
  "Language" selects and Save flush, `AttachmentScopesDialog`, `PackagingUnitsEditor`'s translations dialog.

## 4. `ScopedField` (admin-kit, FR-060…FR-065, FR-081, FR-082)

`packages/admin-kit/src/components/scoped-field/ScopedField.tsx`, exported from the kit barrel:

```ts
type ScopedFieldProps<T> = {
  id: string; label: string; fieldPath: string;
  view: ScopedFieldView<T>;                  // from the read endpoint
  scope: ScopeRef; scopeLabel: string; parentScopeLabel: string;  // "Global" at C, "<channel>" at C×L
  staged: ScopedWriteOp<T> | undefined;
  onStage(op: ScopedWriteOp<T> | undefined): void;               // undefined = unstage
  readOnly: boolean;                         // no catalog:write
  globalOnly?: boolean; onJumpToScope?(scope: ScopeRef): void;
  renderControl(p: { value: T | null; readOnly: boolean; onChange(v: T | null): void;
                     inputProps: { id; 'aria-describedby'; 'aria-invalid' } }): ReactNode;
  error?: string;
};
```

| State | Render |
| --- | --- |
| G | control editable (or read-only without `catalog:write`); no checkbox |
| C / C×L, inheriting | checkbox "Use value from <parent scope>" **checked**, its accessible name "Use value from <parent scope> for <label>"; control `readOnly` (not `disabled`) showing the inherited value; source line "Inherited from <scope>" as the control's `aria-describedby`; an "Inherited" text badge with icon |
| untick | stage nothing yet; control editable, pre-filled with the inherited value, focused (FR-061); typing stages `set` |
| own value | checkbox unchecked; source "Set at this scope"; "Overridden" badge with icon |
| own empty | source "Set at this scope, empty"; the control empty |
| tick on an own value | stages `inherit`; untick before Save restores and unstages (FR-062) |
| clear an optional field | stages `empty`; a required field (view.required) or a select / boolean shows the error on Save attempt and Save is refused client-side too |
| no `catalog:write` | no checkbox; the source text only (FR-080) |
| global-only outside G | read-only, "Global only" + "Edit at Global" (FR-081); a tab of global-only fields shows one notice instead |
| not supported at this scope (FR-082) | read-only effective value, "Set per <levels in words>", button "Edit at <nearest supporting scope>" |

## 5. Zones

| Zone (contracts `admin-contributions.ts`) | Change |
| --- | --- |
| `product.editor.field.after` | `ProductEditorFieldZoneProps` gains optional `scope?: ScopeRef` (FR-106; audit G6); `languageCodes` is passed `null` (protection is whole-field, FR-046) — contributors that ignore `scope` keep working |
| `product.editor.seo` | **new**, mounted once in the SEO tab; props `ProductEditorSeoZoneProps = { productId; scope: ScopeRef; scopeLabel; parentScopeLabel; view: ScopedValuesResponse['data']['seo']; staged: ReadonlyMap<string, ScopedWriteOp<string>>; onStage(field, op); readOnly: boolean; errors: Record<string, string> }` |
| `product.editor.seo.after` | **removed** with `seo`'s `ProductSeoLink` contribution (the zone list is closed and two-way checked) |
| `product.editor.details.before`, `pricing.*`, `channels` | unchanged |

The editor renders the SEO tab iff `useAdminZone('product.editor.seo')` has a contributor.

## 6. Tabs (FR-052, FR-107)

Every tab renders at the editor scope. Global-only tabs (Pricing, Variants, Composite, Related, Channels, Inventory
stock) show the "Global only" notice outside G. Tab labels move into `catalog/i18n` (FR-105, audit N1); the tab
list follows the WAI-ARIA tabs pattern (arrow keys, `aria-selected`, `aria-controls`; FR-107).

## 7. Scope map links (US12, FR-100, FR-101)

`ProductScopeOverview`: the Language row is removed; each cell, each "whole channel" header and the Global corner
render a real `<Link>` "Edit at <scope>" to the §1 URL; each field named in a cell links with `&field=`. Activation
goes through the switch guard (§3). Resets and orphan deletion keep their confirmed Commands.

## 8. Copy to other channels (FR-086)

On a {G,C,CL} text field at C×L with an own value and no staged change: a menu action "Copy to other channels in
<language>…" opens a dialog listing member channels offering L (checkboxes), runs `dryRun`, and lists the channels
whose own value will be overwritten before the confirm button; copying an empty value is offered only on optional
fields.

## 9. Completeness (US11, FR-097)

From `view.completeness`: at C×L a marker with icon and text on each missing field, plus a summary "Missing here:
Name, URL key" whose items link `&field=`; at C a list "Missing in this channel: Name (Polish, German)"; at G
"N incomplete scopes — Scope map". Nothing when complete.

## 10. i18n

Every string in `catalog/i18n/{en,pl}.json` (and `seo/i18n`, `import_export/i18n`, `admin-kit` kit strings through
the kit's i18n surface) — keys under `productEditor.scope.*`, `productEditor.scopedField.*`,
`productEditor.save.*`, `productEditor.copy.*`, `productEditor.completeness.*`, `productEditor.tab.*`.
