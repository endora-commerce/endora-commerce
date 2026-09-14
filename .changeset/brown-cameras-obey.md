---
'@endora-commerce/platform': minor
'@endora-commerce/cli': patch
---

An instance's five `module:*` entry points share a fourteen-line `runtime.ts`
instead of a ninety-line one. `instanceOperatorRuntime` and
`runInstanceOperatorCommand` are new on `@endora-commerce/platform/lifecycle`
and hold the manifest resolution, the lazily opened `MikroORM` + `Redis` and
the system scope that `endora new instance` used to render into a client's
tree; the instance supplies the directory holding `apps/` and its own
`mikro-orm.config.js`, and nothing else. `instanceManifestEntries` is exported
with them and `cli/dispatch.ts` now reads it instead of carrying a second copy
of the same three suppliers.

R1.4's wiring budget goes from 248 lines over thirteen files to 176, which is
what takes A14 of the instance acceptance criterion under the 250-line bound in
`registry` mode, where the `.npmrc` puts eleven more lines in the count.
