---
'@endora-commerce/mod-delivery-methods': minor
---

The module declares its demo data: `manifest.demo` creates the free `in_person_pickup` method
the demo shop checks out with, and withdraws it again.

`endora demo seed` now reports `delivery_methods` by name with the method it created, and
`endora demo reset` removes it. Both bodies are reached by a relative `await import()` from the
manifest, so nothing is loaded by the processes that merely compose the platform, and the
module gained no `exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The withdrawal changed, and it is a repair.** The host's demo reset used to clear this table
with a `truncate … cascade`, which took every operator-created method with it and, through the
cascade, the sales-channel and organisation bindings that pointed at them. It now deletes only
the code `seed` assigns.

Seeding twice creates nothing the second time and reports the same count.
