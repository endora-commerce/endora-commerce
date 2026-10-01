---
"@endora-commerce/test-kit": minor
---

The `vitest` peer range moves from `^2` to `^4.1.11`. Install vitest 4 beside the kit:
`pnpm add -D vitest@^4.1.11`.

No `test-kit` export changes: `./server`, `./database` and `./support` keep their signatures and
behaviour, and the kit's runtime imports nothing from `vitest`. The range is still a break for a
project on vitest 2 or 3 — npm refuses an install whose peer is out of range, pnpm warns — so this
is a `minor` in the 0.x series (D-225: no `major` before the package leaves 0.x) rather than a
patch. The floor is 4.1.11 rather than 4.0.0 because every earlier vitest 4 release is inside the
advisories the upgrade exists to clear (GHSA ranges `< 3.2.6` and `>= 2.1.0, < 4.1.11`).

If you call the kit's database lease from a `globalSetup`, nothing changes. If your own test
configuration used `poolOptions.forks.singleFork`, vitest 4 removed it: `maxWorkers: 1` runs files
one at a time, each in a fork of its own.
