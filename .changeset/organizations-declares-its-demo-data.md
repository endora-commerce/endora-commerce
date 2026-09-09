---
'@endora-commerce/mod-organizations': minor
---

The module declares its demo data: `manifest.demo` creates the buying organisation the demo shop
trades with, and withdraws it again.

`endora demo seed` now reports `organizations` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
nothing is loaded by the processes that merely compose the platform, and the module gained no
`exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The withdrawal changed, and on this table it is the sharpest repair in the batch.** The host's
demo reset cleared `organizations` with a `truncate … cascade`, and an organisation is the tenant
every buyer, address, cart, quote request and order hangs off — so one word took a developer's
entire test tenancy with it, silently, on every seed. The reset now deletes only the tax id
`seed` assigns.

**The demo buyer and the demo credit limit are not this module's demo data.** Each is another
module's row against this one's, so each stays with the instance composition.

Seeding twice creates nothing the second time and reports the same count.
