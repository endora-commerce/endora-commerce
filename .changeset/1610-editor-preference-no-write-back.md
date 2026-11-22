---
'@endora-commerce/mod-catalog': patch
---

The product editor no longer sends redundant writes of the operator's scope preference (issue #1610). It sent a `PUT …/editor-preference` 500 ms after every load, including the first load at the scope that preference already held and a reload after Save. Now it writes only when the opened scope differs from the one it knows is stored. A scope read that finished after the editor had closed also started that write. Now it starts no write. A scope switch is still remembered, and so is a scope named in the URL.
