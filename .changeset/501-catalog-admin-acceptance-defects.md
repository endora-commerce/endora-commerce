---
'@endora-commerce/mod-catalog': patch
---

Issue #501 — three admin defects from the spec 163 acceptance walk. In ⌘K, `archived` (and the Polish `archiwum`) now ranks *Archived products* first: `open-products` no longer carries those words and keeps the verbs it runs (`archive`, `restore`; Polish `archiwizuj`, `przywróć`). On the product list, the Type and Visibility cells and the Type chip's value now use the product editor's translated labels (`productEditor.type.*`, `productEditor.visibility.*`), and the Updated cell uses the new bundle keys `productsList.updated.{justNow,minutesAgo,hoursAgo,yesterday,daysAgo}`, with dates older than a week formatted in the admin's language. These cells used to be English in every language. On the product editor's scope map, body cells and row headers now have vertical padding, so their content no longer touches the next row's border.
