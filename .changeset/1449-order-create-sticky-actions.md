---
'@endora-commerce/mod-orders': patch
---

The order create screen ends with the kit's sticky save bar (issue #1449, DS-19). *Cancel* comes first and *Create order* last, and the bar stays in view while the form scrolls. A refused create is shown in the bar, beside the button, instead of at the top of the page.
