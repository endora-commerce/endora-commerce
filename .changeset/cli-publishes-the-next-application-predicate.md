---
'@endora-commerce/cli': minor
---

Added `isNextApplication` to `@endora-commerce/cli/lib/workspace-packages.js`.

*"Which workspace member is the reference storefront?"* had one answer and one caller —
`new-storefront/reference.ts`, which resolves the application it copies. It now has two:
`check-release-intent.ts` derives the publication set from that same application's dependency
closure, so the packages this repository may publish are what a storefront actually resolves and
are written down nowhere.

The predicate is unchanged — a member declaring `next` as a dependency **and** a `build` script
that runs it — and it moves rather than being copied, because two implementations of it are two
answers waiting to disagree about which application they mean.
