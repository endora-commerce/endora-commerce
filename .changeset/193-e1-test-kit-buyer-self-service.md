---
'@endora-commerce/test-kit': minor
---

`@endora-commerce/test-kit/command-hooks`: `sealedCommandHookRegistry` takes an optional `buyerSelfServiceActions`, the owners' manifest lists (`specs/193-admin-form-extensions/` D-300.10). An owner whose Command sets `buyerSelfService` can then run it on a real `CommandBus` in a unit test, because the bus refuses the flag on an undeclared action. `@endora-commerce/test-kit/forms`: `expectFieldSetMatchesSchemas` reads a key a write schema refuses outright (`z.never()`, as a PATCH refusing a field only the create sets) as not carried by that schema. It no longer reports it as a type mismatch.
