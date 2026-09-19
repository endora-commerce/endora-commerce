---
'@endora-commerce/mod-inpost': patch
---

The locker picker is a storefront fragment, not a path in the platform repository

`docs/inpost.md`'s *Storefront renderer* row named
`storefront/lib/shipping-renderers/inpost-locker.tsx`, a file that no longer exists: a carrier's
checkout UI is the carrier's own storefront code, and the storefront is a scaffolded instance the
shop owns (D-195). The row now says what a shop actually has to do — copy the fragment in, call
`registerShippingMethodRenderer('inpost_locker', …)`, and write the selected locker to
`shippingAdapterData.targetPoint`, which is the field name the reference storefront reads and this
module's `InpostLockerAdapter` validates.

`docs/` is in this package's `files`, so the correction ships in the tarball; nothing this package
exports changes.
