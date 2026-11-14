---
'@endora-commerce/mod-catalog': patch
---

The product editor's Save now sits in the sticky scope bar (issue #717). At 1024 px and wider it
stays in view while an operator scrolls a long product, beside the channel and language it applies
to, instead of scrolling away with the page head; below 1024 px it is still the fixed bottom bar.
The editor renders exactly one Save at every width, carrying the staged-changes count as before,
and keyboard focus now reaches it after the scope controls and before the tabs. No export, route,
permission, API shape or translation key changed.
