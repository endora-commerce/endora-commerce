---
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-inpost': patch
'@endora-commerce/mod-dhl-parcel': patch
---

`delivery_methods` publishes an install surface, and the two carriers seed themselves through it

`@endora-commerce/mod-delivery-methods` gains two things, both additive:

- **`@endora-commerce/mod-delivery-methods/ports`** — a new type-only subpath declaring
  `DeliveryMethodSeedApi`, `DeliveryMethodSeedDefaults`, `DeliveryMethodSeedRecord` and
  `DeliveryMethodSeedOutcome`. Every method takes the caller's MikroORM `EntityManager` as a
  required first parameter, which is why the interface cannot live in
  `@endora-commerce/contracts`.
- **`createDeliveryMethodSeeder()` on `@endora-commerce/mod-delivery-methods/backend`** — the
  runtime factory behind that interface. `ensureMethodForAdapter(em, adapterKey, defaults)`
  answers `{ row, created }`; `bindToDefaultChannel(em, id)` puts a method in the system-default
  channel and is meant to be called **only** when `created === true`; `removeMethodForAdapter(em,
  code)` is the hard-uninstall half.

`@endora-commerce/mod-inpost` and `@endora-commerce/mod-dhl-parcel` now seed their two delivery
methods each from an `installHook` through that surface, and remove them from an `uninstallHook`
behind `if (!ctx.hard) return;`. Both seed migrations keep their class names and are no-ops: the
class name is what `mikro_orm_migrations` stores in every database that already ran them, so
neither may be renamed or deleted. A consumer upgrading across this change sees no row change —
the hook matches on `code`, finds what the migration wrote and returns it untouched — and a fresh
install reaches the same rows through the hook alone.

Nothing published is removed or narrowed, so this is a patch: a `^0.10.x` dependent of
`mod-delivery-methods` resolves the surface without a range change, which is what the carriers
need once they are published from another repository.
