---
'@endora-commerce/admin-kit': minor
---

Declared forms (`specs/193-admin-form-extensions/` WP-E1).

- `DeclaredFormProvider` takes a **required** `form`: the declaration its controller was built for, named where the form renders (D-300.29). `check:admin-forms` and `endora generate` read it to know which forms a host renders (`unrendered-form`, `undeclared-form`). A `form` that is not the controller's throws in development and in tests, and logs a `console.error` in production, where the screen keeps working on the controller's form: `check:admin-forms` reads the provider's `form` but not the hook's, so it cannot catch every mismatch. The provider is unreleased (it shipped after 0.112.0), so no published caller has to change; a host written against the unreleased shape adds `form={…}`.
- `useDeclaredForm` renders without a `ModulePresenceProvider` above it. No module is then present: the declaration is laid out with no slot, no module control and no behaviour. Before this change it threw.
- `DeclaredFormController.check()` runs the browser-side field rules, shows them and returns them as field key → message. A host can return them from its save session's host part (`SavePart.validate`), so the session summary names them and "Show" opens the tab that holds the field.
- `OrganizationPicker` takes `describedBy` and `invalid`, which it forwards to its input. `FulfilmentStrategyPicker` takes the same two and puts them on its strategy select. A caller's hint and error can now be tied to the control.
