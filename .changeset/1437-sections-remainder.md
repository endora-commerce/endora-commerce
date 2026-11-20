---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-forms': patch
---

More admin screens follow the DS-03 rule that a frame inside a card is a defect unless it is a field (issue #1437, UX audit 2026-11-17).

- **My profile** is one form card with three sections (identity, author profile, password) under the one Save, and the language preference, which is saved on its own, is the one card beside it. The language Save's result is a status line beside its button, with an icon, in place of a red or green box inside the card. The language select is named by its heading. The screen is on the kit's primitives.
- **Organization detail, price display mode** (`price_lists`, `organization.detail.after`): the panel has a heading (*Pricing*) and renders as an `EditorSection`, so it follows the mount — one titled card at page level, a section inside a host card. It was a card without a heading.
- **Return detail** (`returns`): comments and the accepted clauses are rows divided by a rule, not a bordered box each.
- **Settings** (`settings`): a group's settings are rows divided by a rule inside the group card, not a bordered box each; a changed row keeps its tint and its *Unsaved* badge.
- **Form entry notes** (`forms`): notes are rows divided by a rule, not a bordered box each.
