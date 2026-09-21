---
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-stripe': patch
'@endora-commerce/mod-tpay': patch
'@endora-commerce/mod-payu': patch
'@endora-commerce/mod-autopay': patch
'@endora-commerce/mod-paypal': patch
---

`payment_methods` publishes an install surface, and the five gateways seed themselves through it

`@endora-commerce/mod-payment-methods` gains two subpaths, both additive:

- **`@endora-commerce/mod-payment-methods/ports`** — a new type-only subpath declaring
  `PaymentMethodSeedApi`, `PaymentMethodSeedDefaults`, `PaymentMethodSeedRecord` and
  `PaymentMethodSeedOutcome`. Every method takes the caller's MikroORM `EntityManager` as a
  required first parameter, which is why the interface cannot live in
  `@endora-commerce/contracts`.
- **`@endora-commerce/mod-payment-methods/install`** — a new runtime subpath holding one
  re-export, `createPaymentMethodSeeder()`, the factory behind that interface.
  `ensureMethodForAdapter(em, adapterKey, defaults)` answers `{ row, created }`;
  `bindToDefaultChannel(em, id)` puts a method in the system-default channel and is meant to be
  called **only** when `created === true`; `removeMethodForAdapter(em, code)` is the
  hard-uninstall half. It is the delivery twin of
  `@endora-commerce/mod-delivery-methods/install`, admitted by the same criterion (D-251).

**`PaymentMethodReconciler` changed shape**, and a consumer that reached it did so by a relative
path into `src/` rather than through anything published — the class was exported from no subpath
at all before this change. It no longer takes an `emFactory` in its constructor: the
`EntityManager` is a required first parameter of every method, so the write lands in the
transaction the caller will commit or revert. `ensureMethodForAdapter` answers `{ row, created }`
rather than the managed entity, and the record it hands back cannot be persisted through.

`@endora-commerce/mod-stripe`, `@endora-commerce/mod-tpay`, `@endora-commerce/mod-payu`,
`@endora-commerce/mod-autopay` and `@endora-commerce/mod-paypal` now seed their `payment_methods`
rows from an `installHook` through that surface, bind each row to the system-default channel only
when the hook created it, and remove them from an `uninstallHook` behind `if (!ctx.hard) return;`.
Each also declares `@endora-commerce/mod-payment-methods` as a **required** peer, which is the
npm half of an edge their manifests already declared as a lifecycle dependency.

Two migrations per gateway keep their class names and are no-ops: the seed, whose rows the hook
now writes, and the `*_failure_status_on_hold` correction, whose only subject was rows the old
seed wrote with a terminal `status_on_failure` — the reconciler has defaulted that to `on_hold`
since feature 085, so a fresh install cannot produce one and there is nothing left to correct. A
class name is what `mikro_orm_migrations` stores in every database that already ran it, so none
may be renamed or deleted.

A consumer upgrading across this change sees no row change — the hook matches on `code`, finds
what the migration wrote and returns it untouched — and a fresh install reaches the same rows
through the hook alone. Two behaviour changes are worth naming: an operator who deletes a seeded
method and then soft-uninstalls and re-installs the gateway gets it back, which the old migration
would not have done; and `autopay`'s one-off retirement of four legacy inline method codes no
longer runs, because this module has not created those codes for some time and every database
that had them has already run the statement.

Nothing published is removed or narrowed, so this is a patch: a `^0.10.x` dependent of
`mod-payment-methods` resolves the surface without a range change, which is what the five
gateways need once they are published from another repository.
