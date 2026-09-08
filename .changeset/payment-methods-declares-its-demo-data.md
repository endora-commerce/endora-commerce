---
'@endora-commerce/mod-payment-methods': minor
---

The module declares its demo data: `manifest.demo` creates the `bank_transfer` and
`credit_limit` methods the demo shop is paid with, and withdraws them again.

`endora demo seed` now reports `payment_methods` by name with the methods it created, and
`endora demo reset` removes them. Both bodies are reached by a relative `await import()` from
the manifest, so nothing is loaded by the processes that merely compose the platform, and the
module gained no `exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The withdrawal changed, and it is the sharpest of the three repairs.** The host's demo reset
used to clear this table with a `truncate … cascade`. Five gateway modules seed their own
methods from migrations, so that statement destroyed fifteen rows nobody had asked to lose,
plus every adapter rule that referenced them through the cascade. It now deletes only the two
codes `seed` assigns.

The granted credit limit that makes the `credit_limit` method visible in checkout is **not**
this module's demo data: a grant is a row in `credit_limits` against a particular organisation,
which is two modules' rows and therefore a composition step.

Seeding twice creates nothing the second time and reports the same counts.
