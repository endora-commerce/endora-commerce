---
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-cms': patch
---

More admin screens follow the DS-03 rule that a frame inside a card is a defect unless it is a field (issue #1437, UX audit 2026-11-17).

- **Form builder** (`forms`): the *Settings* and *Notifications* tabs and the field inspector are built on the kit's `EditorSection`, which draws the rule between groups, in place of a `Separator` between them. A notification channel list, an address field's parts and the published versions are rows divided by a rule, not a bordered box each; a form with no published version says so with the kit's empty state.
- **Account security** (`mfa`): with two-step verification on, the card holds two titled sections, *Recovery codes* first and *Switch off two-step verification* last, so the destructive form sits away from the routine one.
- **Asset detail** (`assets_library`): the drawer is one card of titled sections — *Links*, *Details*, *File* (with the previous version inside it) and *Referenced by* — in place of blocks fenced off by hand-drawn rules.
- **Order statuses** (`orders`): the new-status form is a titled section (*New status*) of the statuses card, and every field on the page is the kit's `Input` / `Checkbox`.
- **Tax ID scope** (`organizations`): each scope option is drawn as a choice field — the chosen one marked, keyboard focus ringed.
- **Page builder section presets** (`cms`): the presets list in the block drawer has no box around it; one rule sets it off from the blocks below.
