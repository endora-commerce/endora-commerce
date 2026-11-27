---
'@endora-commerce/test-kit': minor
---

`@endora-commerce/test-kit/forms` gains `expectFieldSetWriters(registration, commandsByAction)` (`specs/193-admin-form-extensions/` T028): every writer of a field set has a Command in the owner's tests (or `{ skip: '<reason>' }`), the Command is that action's and supplies `hookData`, and the writer's projection returns every key it lists in `writes` — in `after`, and in `before` or `changed` on an update; a scoped writer projects one entry per saved scope. `composeTestServer` builds and seals the form registry as `composeApp` does, and takes the deployment's `formOverrideGrants`.
