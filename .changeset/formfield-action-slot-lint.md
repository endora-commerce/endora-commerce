---
'@endora-commerce/admin-kit': patch
---

`FormField`'s `action` slot is marked as a ReactNode slot for the raw-enum lint rule from #1434, like `Section`'s. No behaviour change; it unblocks `pnpm -r run lint` on master, which turned red when #1432 and #1434 merged together.
