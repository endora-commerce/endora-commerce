---
'@endora-commerce/cli': minor
---

`ESTATE` gains `check:test-ownership`, feature 106's ownership instrument
(`specs/106-module-owned-tests/contracts/module-test-ownership.md`).

For a consumer of this package the change is one new member of the exported
`ESTATE` array, so `ESTATE.length` moves and anything iterating it reports one
more rule. Its verdict is `scope: 'package'` with `host: pending(…)`: the rule's
subject is one module package's test tree, which is exactly the question a
package asks about itself, and what a lone package cannot supply is the
*application's* own `backend/test/**` — `misplaced-test`'s whole population.
That signal is declared in the entry's `partial` list rather than dropped, so
`endora check` will report it as unevaluated with a reason instead of leaving it
silently absent.

No exported type changes and no existing entry moves.
