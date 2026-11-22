---
'@endora-commerce/mod-catalog': patch
---

The product editor no longer writes the operator's scope preference back when it opens at the scope that preference already holds (issue #1610). It used to send a `PUT …/editor-preference` 500 ms after every load, including the first load at the remembered scope and a reload after Save. A scope switch is still remembered as before, and so is a scope named in the URL.
