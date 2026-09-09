---
'@endora-commerce/mod-credit-limits': patch
---

The module declares `demo: false` — a decision recorded rather than a field filled in.

The demo shop does have a granted credit limit and it is not this module's demo data: a grant's
whole content is a reference to an `organizations` row, so it is two modules' rows in one
statement and belongs to whoever owns the instance. It is a step of that composition, guarded on
both modules, and this module does not declare `organizations` — `demo` may not become a way of
acquiring a dependency.

Absent and `false` are different states, so this changes no behaviour: it says the module owes
nothing rather than leaving it undecided.
