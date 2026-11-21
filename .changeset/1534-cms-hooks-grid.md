---
'@endora-commerce/mod-cms': patch
---

The CMS hooks screen no longer keeps its two columns at every width (issue #1534): the hook list and the selected hook's blocks sit side by side from wide screens up and stack below. The hook whose blocks are shown is marked with a check beside its name and announced to screen readers as the current one.
