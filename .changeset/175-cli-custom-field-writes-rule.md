---
'@endora-commerce/cli': minor
---

New rule `custom-field-writes` (`specs/175-buyer-input-custom-fields/`), exported from `./rules/custom-field-writes.js`: a custom-field host's literal `customFieldWrites` manifest export is read as source and held to the routes the module registers and to the built contracts' body schemas. Nine findings — `entity-type-undeclared`, `create-without-values`, `update-without-values`, `declared-route-missing`, `undeclared-write-route`, `exemption-without-reason`, `surface-without-contract`, `surface-without-test` and `computed-declaration`. `endora check` lists it as a `package`-scope rule whose package host is pending. The route reader of `./rules/action-route-permissions.js` gains an optional `pathPrefix` (default `/api/v1/admin`) and records each registration's `schema.body` identifier as `body`.
