---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-price-lists': patch
---

The product editor has fewer tabs (issue #1510, UX audit CAT-10). Media and Attachments are one **Media & files** tab with the gallery and the attachments as its two sections, and the Scope map is no longer a tab: it opens as a side drawer from the Scope map link in the scope bar and from the completeness line, and its address is `?scopeMap=1`. Old addresses keep working — `?tab=scopes` opens the drawer and `?tab=attachments` the Media & files tab, each rewritten to the current address; the bulk-edit result links to `?scopeMap=1`. A simple product now has eight tabs at most. `ModalDialog` gains `placement="end"` (exported type `ModalDialogPlacement`), a full-height panel docked to the inline end of the viewport, with the same modal behaviour.

The Pricing tab's base-price panel (issue #1529, CAT-19) says "No base price in …" and "Not orderable below …" in the warning token with an icon instead of a hard-coded amber, so it reads in every theme, and it drops its own **Discard changes** button: the editor's one Save and its Save / Discard / Stay question are the one way to keep or drop the changes. The `basePrices.discard` string is removed.
