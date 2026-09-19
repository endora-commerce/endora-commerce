---
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-inpost': patch
'@endora-commerce/mod-dhl-parcel': patch
---

`delivery_methods` publishes an install surface, and the two carriers seed themselves through it

`@endora-commerce/mod-delivery-methods` gains two subpaths, both additive:

- **`@endora-commerce/mod-delivery-methods/ports`** — type-only, declaring `DeliveryMethodSeedApi`,
  `DeliveryMethodSeedDefaults`, `DeliveryMethodSeedRecord` and `DeliveryMethodSeedOutcome`. Every
  method takes the caller's MikroORM `EntityManager` as a required first parameter, which is why the
  interface cannot live in `@endora-commerce/contracts`.
- **`@endora-commerce/mod-delivery-methods/install`** — the runtime half:
  `createDeliveryMethodSeeder()`, on a pure re-export layer (`module-package-layout.md` R11, ruled as
  D-251). `ensureMethodForAdapter(em, adapterKey, defaults)` answers `{ row, created }`;
  `bindToDefaultChannel(em, id)` puts a method in the system-default channel, answers `false` when it
  is already there **or** when the platform has no default channel yet, and is meant to be called
  only when `created === true`; `removeMethodForAdapter(em, code)` is the hard-uninstall half.
  **Not on `./backend`**: a factory there would make one subpath mean either "wiring this module" or
  "seeding a row through the sanctioned surface", and it would hand every consumer most of an import
  graph it never calls — 12 emitted files and 7 external specifiers including the HTTP layer, against
  3 and 4 without it.

`@endora-commerce/mod-inpost` and `@endora-commerce/mod-dhl-parcel` now seed their two delivery
methods each from an `installHook` through that surface, and remove them from an `uninstallHook`
behind `if (!ctx.hard) return;`. Both seed migrations keep their class names and are no-ops: the class
name is what `mikro_orm_migrations` stores in every database that already ran them, so neither may be
renamed or deleted. A consumer upgrading across this change sees no row change — the hook matches on
`code`, finds what the migration wrote and returns it untouched — and a fresh install reaches the
same rows through the hook alone.

**Both carriers gain `@endora-commerce/mod-delivery-methods` as a required peer**, and it is a patch
rather than a minor deliberately: every instance that installs a carrier already installs
`delivery_methods`, because each carrier's module manifest has declared it in `dependencies` since
feature 068 and the lifecycle refuses the install without it. The peer states in npm's vocabulary
what the manifest already required, and pnpm and npm provide a missing peer automatically. Read it
the other way and the level is a minor.

Nothing published is removed or narrowed, so `mod-delivery-methods` is a patch too: a `^0.10.x`
dependent resolves the new surface without a range change, which is what the carriers need once they
are published from another repository.

**One condition ships open, and it is not in this surface.** A database that is migrated and then
**booted** without `module:install` running marks every module installed and never fires an install
hook, so the seeded rows do not appear — where the old seed migration wrote them regardless. A
generated instance is unaffected (`migrate` then `module:install --all`); this repository's dev flow
is. It is written up in `specs/deferred-defects.md` and sequenced for repair before the same seam is
adopted for `payment_methods`.
