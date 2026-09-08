---
'@endora-commerce/mod-inventory': minor
---

The module declares its demo data: `manifest.demo` creates the demo's second warehouse and
assigns it to every sales channel, and withdraws both again.

`endora demo seed` now reports `inventory` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
nothing is loaded by the processes that merely compose the platform, and the module gained no
`exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The demo warehouse is called `Krakow warehouse` rather than `Magazyn Kraków`.** `Warehouse.name`
and `.description` are scalar columns, so the per-language map the demo contract asks for has
nowhere to go, and a module's own sources are where `check:default-language-prose` refuses
non-English prose that carries no per-language structure — measured on the move, the two former
values were two findings. The code (`pl-krk`) and the fixed id are unchanged, so anything that
resolved the warehouse by either is unaffected.

**The withdrawal leaves the reconciler's assignments alone.** The demo's channel assignments and
the ones `WarehouseChannelReconciler` makes for the system warehouse share a table, and only the
first are the demo's: every active channel keeps a default warehouse across a demo reset.

The stock spread across the two warehouses is **not** this module's demo data — quantities per
product are `catalog`'s rows and this module's in one statement, so they stay with the instance
composition, which already degrades to a single-warehouse spread when this module is absent.
