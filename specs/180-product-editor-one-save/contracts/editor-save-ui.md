# Contract: the product editor's one Save with participants

Owner: `catalog` admin (`packages/modules/catalog/src/admin/`). Extends
`specs/174-product-editor-scope-switcher/contracts/editor-ui.md` §3 and §11 and PR #1217's
`components/ProductEditorSaveAction.tsx`. UX floor: `.claude/skills/ux-laws/SKILL.md`.
Requirements: FR-010…FR-035, FR-040, FR-041.

## 1. Wiring

- `ScopedProductEditor` is wrapped in `SaveSessionProvider resetKey={scopeKey(state.scope)}`.
- Every `<AdminZone name="product.editor.*">` except `product.editor.seo` passes
  `saveSession: session.handle`.
- `ProductEditorSaveAction.stagedCount` = `state.staged.size + session.dirtyCount`.
- `ProductEditorSaveAction` renders when `canWrite || session.hasWritableParticipant` (OQ-6 A).
- `save()` becomes `session.run(hostPart)`, where `hostPart` (`id: 'host'`, label "Product
  fields", `blocking: true`) wraps today's body: the required-empty checks as `validate`, the
  `PUT …/scoped-values` as `save`, and today's error handling (`handleSaveError`) unchanged. With
  no staged scoped change, or without `catalog:write`, `hostPart` is `null`.
- `useUnsavedChangesPrompt(state.staged.size + session.dirtyCount > 0)`.

## 2. Summary

Rendered in the existing form-error area, under the scope bar, as admin-kit `Alert`:

| Outcome | Variant | Text (en) |
| --- | --- | --- |
| `refused` | destructive | "Nothing was saved. Fix the problems below." + one item per part: "<label> — <n> problems" with a button "Show" that switches to the part's tab and focuses its first error |
| `failed` (host refused) | as 174 §3 | unchanged messages (conflict, gate, takeover, SEO off) |
| `partial` | warning | "Some changes were saved." + "Saved: <labels>." + "Not saved: <label> — <reason>" per failed part, each with "Show" |
| `saved` | — | live region only: "Saved <n> changes at <scope>" (174 key, count = total) |

Zone → tab map for "Show": `pricing.*` → `pricing`, `channels` → `channels`, `details.before` →
`details`, `field.after` → the field's tab (`tabOfField`).

The summary takes `role="alert"` for `refused` and `partial` and moves focus to its heading when
Save was pressed; it is cleared by the next edit.

## 3. Guard

The *Save / Discard / Stay* `ModalDialog` (174 FR-075) opens when `state.staged.size +
session.dirtyCount > 0` on: scope switch, scope-map link, Back, browser Back, in-app link. *Save*
runs `session.run`; the navigation proceeds only on outcome `saved`. *Discard* calls
`session.discardAll()` and drops staged cells. Tab switches never open it.

The `409` "Reload (discards your unsaved changes)" also calls `session.discardAll()`.

## 4. Pricing tab

- `SectionHeading` for the Pricing tab drops `immediate` (FR-024).
- `ProductBasePrices`: *Save prices* button, its status line "Saved" and its
  `useUnsavedChangesPrompt` are removed; drafts move to `useSaveParticipant(props.saveSession,
  { key: 'base-prices', label: t('basePrices.partLabel'), writable, loaded })`; `validate` runs
  the panel's existing planning (`Planned.errors`) then the dry run; `save` sends the existing
  `PUT` of the changed currencies and returns the new baseline.

## 5. i18n keys

- `core` (`packages/modules/_i18n/i18n/{en,pl}.json`): `saveSession.summary.refused`,
  `saveSession.summary.partial`, `saveSession.summary.saved`, `saveSession.summary.notSaved`,
  `saveSession.summary.problems.{one,few,many,other}`, `saveSession.summary.show`,
  `saveSession.notice.moduleOff`, `saveSession.notice.crashed`, `saveSession.error.moduleOff`.
- `catalog`: `productEditor.save.hostPartLabel` ("Product fields" / "Pola produktu").
- `price_lists`: `basePrices.partLabel` ("Base prices" / "Ceny bazowe").
