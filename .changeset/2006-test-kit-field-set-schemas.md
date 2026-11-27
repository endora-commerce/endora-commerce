---
'@endora-commerce/test-kit': minor
---

New subpath `@endora-commerce/test-kit/forms` with `expectFieldSetMatchesSchemas(set, { create, update })` (issue #2006, `specs/193-admin-form-extensions/` FR-003). It fails, listing every disagreement, unless each field of a `defineFieldSet` declaration is carried by the host's create or update Zod schema with the declared value type, core bounds and enum options, and is required in the create schema exactly when the declaration says so. The schemas are read structurally, so the kit takes no `zod` dependency.
