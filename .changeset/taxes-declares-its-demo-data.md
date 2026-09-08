---
'@endora-commerce/mod-taxes': minor
---

The module declares its demo data: `manifest.demo` creates the Polish standard VAT rule and
withdraws it again.

`endora demo seed` now reports `taxes` by name with the rule it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest,
so nothing is loaded by the processes that merely compose the platform, and the module gained
no `exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The withdrawal changed, and it is a repair.** The host's demo reset used to clear this table
with a `truncate … cascade`, which cannot tell a demo rule from one an operator wrote. It now
deletes only the code `seed` assigns (`pl_vat_23`), so an operator's own rules — and the
sales-channel bindings that pointed at them — survive a demo reset.

Seeding twice creates nothing the second time and reports the same count.
