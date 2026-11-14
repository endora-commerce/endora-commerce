---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-price-lists': minor
---

The category editor's Save now covers the panels contributed to `category.editor.after` (issue #407, `specs/180-one-save-zone-editors/` WP-6).

**mod-catalog:**
- The category editor runs a save session, one per open category, and passes it to `category.editor.after`.
- The zone is mounted above the Save / Cancel row instead of below it.
- Save reads "Save" or "Save n changes", counting the category's own field changes plus every panel's. It does nothing while there is nothing to save.
- Save writes the category first, then the panels. If the category write is refused (a slug that is taken, an invalid custom field), no panel is written. If a panel fails after the category saved, the editor stays open and reports what was saved and what was not; the next Save writes only what is left.
- Opening another category with unsaved changes asks *Save and continue / Discard changes / Stay here*. Cancel discards every change without asking, as before. Leaving the page or closing the browser tab with unsaved changes asks too.
- A refresh of the tree after a write no longer unmounts the open editor.
- New strings in English and Polish: `categories.save.hostPartLabel` and `categories.guard.*`.

**mod-price-lists:**
- `DisplayModeOverrideRow` takes an optional `saveSession`. With one, changing the select stages the mode as the part "Price display mode" (`displayModeRow.partLabel`, English and Polish) and the host's Save writes it through the same `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId`. There is no write on change and no "saved" suffix. Without `saveSession` the row saves on change as before.
- The category editor contribution passes the editor's session, so the category's display mode saves with the category. The organization detail is unchanged for now.
