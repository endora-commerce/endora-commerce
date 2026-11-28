---
'@endora-commerce/admin-kit': minor
---

Declared forms (`specs/193-admin-form-extensions/` WP-E1). Both changes are additive.

- `DeclaredFormProvider` takes an optional `form`: the declaration its controller was built for, named where the form renders. `check:admin-forms` and `endora generate` read it to know which forms a host renders (`unrendered-form`, `undeclared-form`). A `form` that is not the controller's throws.
- `useDeclaredForm` renders without a `ModulePresenceProvider` above it. No module is then present: the declaration is laid out with no slot, no module control and no behaviour. Before this change it threw.
